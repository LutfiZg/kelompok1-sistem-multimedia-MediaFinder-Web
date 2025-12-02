package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"math/bits"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// ========== Config =========
type Config struct {
	Listen     string
	DBPath     string
	APIKey     string
	CORSOrigin string
	CORSList   []string
	AllowEmpty bool
	UploadDir  string
	CacheTTL   time.Duration
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func loadConfig() Config {
	ttlStr := getenv("MF_CACHE_TTL", "10m")
	ttl, _ := time.ParseDuration(ttlStr)
	if ttl == 0 {
		ttl = 10 * time.Minute
	}
	return Config{
		Listen:     getenv("MF_LISTEN", ":8088"),
		DBPath:     getenv("MF_DB", "./data/mediafinder.db"),
		APIKey:     getenv("MF_APIKEY", ""),
		CORSOrigin: getenv("MF_CORS_ORIGIN", "http://localhost:3000"),
		CORSList:   parseOrigins(getenv("MF_CORS_ORIGIN", "http://localhost:3000")),
		AllowEmpty: strings.EqualFold(getenv("MF_ALLOW_ORIGIN_EMPTY", "false"), "true"),
		UploadDir:  getenv("MF_UPLOAD_DIR", "./data/uploads"),
		CacheTTL:   ttl,
	}
}

func parseOrigins(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" && p != "*" {
			out = append(out, p)
		}
	}
	return out
}

// ========== Models =========
type Item struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	Duration   int     `json:"duration"`
	FPS        float64 `json:"fps"`
	Bucket     int     `json:"bucket"`
	Created    string  `json:"created_at"`
	Hashes     int     `json:"hash_count,omitempty"`
	Chroma     int     `json:"chroma_count,omitempty"`
	HasPreview bool    `json:"has_preview,omitempty"`
}

type HashRow struct {
	T    int    `json:"t"`
	Hash string `json:"hash"` // hex string of uint64
}

// ========== Indexes =========
type BKNode struct {
	Hash     uint64
	Refs     []int64
	Children map[int]*BKNode
}
type BKTree struct {
	Root *BKNode
}

func hamming64(a, b uint64) int { return bits.OnesCount64(a ^ b) }
func (t *BKTree) Insert(hash uint64, itemID int64) {
	if t.Root == nil {
		t.Root = &BKNode{Hash: hash, Refs: []int64{itemID}, Children: map[int]*BKNode{}}
		return
	}
	cur := t.Root
	for {
		d := hamming64(hash, cur.Hash)
		if d == 0 {
			cur.Refs = append(cur.Refs, itemID)
			return
		}
		nxt, ok := cur.Children[d]
		if !ok {
			cur.Children[d] = &BKNode{Hash: hash, Refs: []int64{itemID}, Children: map[int]*BKNode{}}
			return
		}
		cur = nxt
	}
}
func (t *BKTree) Search(q uint64, maxD int, out map[int64]int) {
	var dfs func(n *BKNode)
	dfs = func(n *BKNode) {
		if n == nil {
			return
		}
		d := hamming64(q, n.Hash)
		if d <= maxD {
			for _, id := range n.Refs {
				out[id]++
			}
		}
		lo, hi := d-maxD, d+maxD
		for dist, child := range n.Children {
			if dist >= lo && dist <= hi {
				dfs(child)
			}
		}
	}
	dfs(t.Root)
}

type LSH struct {
	Bands [4]map[uint16]map[int64]struct{}
}

func NewLSH() *LSH {
	l := &LSH{}
	for i := 0; i < 4; i++ {
		l.Bands[i] = map[uint16]map[int64]struct{}{}
	}
	return l
}
func bandVal(u uint64, band int) uint16 {
	shift := uint(16 * band)
	return uint16((u >> shift) & 0xFFFF)
}
func (l *LSH) Insert(u uint64, itemID int64) {
	for b := 0; b < 4; b++ {
		val := bandVal(u, b)
		s, ok := l.Bands[b][val]
		if !ok {
			s = map[int64]struct{}{}
			l.Bands[b][val] = s
		}
		s[itemID] = struct{}{}
	}
}
func (l *LSH) Candidates(q uint64) map[int64]int {
	out := map[int64]int{}
	for b := 0; b < 4; b++ {
		val := bandVal(q, b)
		if s, ok := l.Bands[b][val]; ok {
			for id := range s {
				out[id]++
			}
		}
	}
	return out
}

// ========== App =========
type App struct {
	cfg     Config
	db      *sql.DB
	idxMu   sync.RWMutex
	trees   map[int]*BKTree
	lsh     *LSH
	cacheMu sync.Mutex
	cache   map[string]cacheEntry
}
type cacheEntry struct {
	exp     time.Time
	created time.Time
	value   []SearchRes
}

func (a *App) invalidateCache() {
	a.cacheMu.Lock()
	a.cache = map[string]cacheEntry{}
	a.cacheMu.Unlock()
}

// ========== DB =========
func (a *App) initDB() error {
	_, err := a.db.Exec(`PRAGMA journal_mode=WAL;`)
	if err != nil {
		return err
	}

	_, err = a.db.Exec(`
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  duration INTEGER NOT NULL,
  fps REAL NOT NULL,
  bucket INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS hashes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  t INTEGER NOT NULL,
  hash INTEGER NOT NULL,
  FOREIGN KEY(item_id) REFERENCES items(id)
);
CREATE TABLE IF NOT EXISTS chroma (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  t INTEGER NOT NULL,
  c0 REAL, c1 REAL, c2 REAL, c3 REAL, c4 REAL, c5 REAL, c6 REAL, c7 REAL, c8 REAL, c9 REAL, c10 REAL, c11 REAL,
  FOREIGN KEY(item_id) REFERENCES items(id)
);
CREATE INDEX IF NOT EXISTS idx_hashes_item ON hashes(item_id);
CREATE INDEX IF NOT EXISTS idx_hashes_hash ON hashes(hash);
`)
	if err != nil {
		return err
	}
	if err := ensureColumn(a.db, "items", "preview_path", "TEXT"); err != nil {
		return err
	}
	return nil
}

func ensureColumn(db *sql.DB, table, column, definition string) error {
	rows, err := db.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if strings.EqualFold(name, column) {
			return nil
		}
	}
	_, err = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, definition))
	return err
}
func bucketOf(duration int) int {
	if duration < 0 {
		duration = 0
	}
	return duration / 30
}

func (a *App) resolvePreviewPath(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		return "", nil
	}
	baseAbs, err := filepath.Abs(a.cfg.UploadDir)
	if err != nil {
		return "", err
	}
	cand, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(cand, baseAbs) {
		return "", errors.New("preview_path must reside in upload dir")
	}
	if _, err := os.Stat(cand); err != nil {
		return "", err
	}
	return cand, nil
}

// ========== Init/Rebuild indexes =========
func (a *App) rebuild(ctx context.Context) error {
	a.idxMu.Lock()
	defer a.idxMu.Unlock()

	trees := map[int]*BKTree{}
	lsh := NewLSH()
	rows, err := a.db.QueryContext(ctx, `SELECT i.bucket, h.item_id, h.hash FROM hashes h JOIN items i ON h.item_id = i.id`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var itemID int64
		var u uint64
		var b int
		if err := rows.Scan(&b, &itemID, &u); err != nil {
			return err
		}
		tr, ok := trees[b]
		if !ok {
			tr = &BKTree{}
			trees[b] = tr
		}
		tr.Insert(u, itemID)
		lsh.Insert(u, itemID)
	}

	a.trees = trees
	a.lsh = lsh
	a.cache = map[string]cacheEntry{}
	log.Printf("Rebuilt indexes: %d buckets, LSH ready", len(trees))
	return nil
}

// ========== Utils =========
func parseHex64(s string) (uint64, error) {
	s = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(s)), "0x")
	if len(s) == 0 {
		return 0, errors.New("empty hash")
	}
	return strconv.ParseUint(s, 16, 64)
}
func toHex64(u uint64) string { return fmt.Sprintf("%016x", u) }

// ========== Middleware =========
func (a *App) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowed := origin == "" && a.cfg.AllowEmpty
		if !allowed {
			for _, o := range a.cfg.CORSList {
				if strings.EqualFold(o, origin) {
					allowed = true
					break
				}
			}
		}
		if !allowed {
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func (a *App) apikey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.cfg.APIKey != "" && r.Header.Get("X-API-Key") != a.cfg.APIKey {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ========== Handlers =========
func (a *App) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"ok":        true,
		"db":        filepath.Base(a.cfg.DBPath),
		"cache_ttl": a.cfg.CacheTTL.String(),
	})
}

type IndexJSONReq struct {
	Item struct {
		Name        string  `json:"name"`
		Duration    int     `json:"duration"`
		FPS         float64 `json:"fps"`
		PreviewPath string  `json:"preview_path,omitempty"`
	} `json:"item"`
	Hashes []HashRow   `json:"hashes"`
	Chroma [][]float64 `json:"chroma,omitempty"`
}

func (a *App) handleIndexJSON(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20) // limit ~10MB
	var req IndexJSONReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if req.Item.Name == "" || req.Item.Duration <= 0 || req.Item.FPS <= 0 || len(req.Hashes) == 0 {
		http.Error(w, "invalid payload", 400)
		return
	}
	previewPath, err := a.resolvePreviewPath(req.Item.PreviewPath)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	var preview interface{}
	if previewPath != "" {
		preview = previewPath
	}
	res, err := tx.Exec(`INSERT INTO items(name,duration,fps,bucket,preview_path) VALUES(?,?,?,?,?)`,
		req.Item.Name, req.Item.Duration, req.Item.FPS, bucketOf(req.Item.Duration), preview)
	if err != nil {
		tx.Rollback()
		http.Error(w, err.Error(), 500)
		return
	}
	itemID, _ := res.LastInsertId()
	hStmt, _ := tx.Prepare(`INSERT INTO hashes(item_id,t,hash) VALUES(?,?,?)`)
	defer hStmt.Close()
	for _, hr := range req.Hashes {
		u, err := parseHex64(hr.Hash)
		if err != nil {
			tx.Rollback()
			http.Error(w, "bad hash: "+err.Error(), 400)
			return
		}
		if _, err := hStmt.Exec(itemID, hr.T, u); err != nil {
			tx.Rollback()
			http.Error(w, err.Error(), 500)
			return
		}
	}
	if len(req.Chroma) > 0 {
		cStmt, _ := tx.Prepare(`INSERT INTO chroma(item_id,t,c0,c1,c2,c3,c4,c5,c6,c7,c8,c9,c10,c11) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
		defer cStmt.Close()
		for t, vec := range req.Chroma {
			vals := make([]any, 0, 14)
			vals = append(vals, itemID, t)
			for i := 0; i < 12; i++ {
				if i < len(vec) {
					vals = append(vals, vec[i])
				} else {
					vals = append(vals, 0.0)
				}
			}
			if _, err := cStmt.Exec(vals...); err != nil {
				tx.Rollback()
				http.Error(w, err.Error(), 500)
				return
			}
		}
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	a.idxMu.Lock()
	defer a.idxMu.Unlock()
	b := bucketOf(req.Item.Duration)
	if a.trees[b] == nil {
		a.trees[b] = &BKTree{}
	}
	for _, hr := range req.Hashes {
		if u, err := parseHex64(hr.Hash); err == nil {
			a.trees[b].Insert(u, itemID)
			a.lsh.Insert(u, itemID)
		}
	}
	a.invalidateCache()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "id": itemID})
}

func (a *App) handleUpload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(100 << 20); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "file required", 400)
		return
	}
	defer file.Close()
	base := filepath.Base(header.Filename)
	dst := filepath.Join(a.cfg.UploadDir, fmt.Sprintf("%d_%s", time.Now().UnixNano(), base))
	os.MkdirAll(a.cfg.UploadDir, 0755)
	out, err := os.Create(dst)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer out.Close()
	n, _ := out.ReadFrom(file)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "path": dst, "size": n})
}

func parsePage(r *http.Request) (page, size int) {
	page, size = 1, 20
	if v := r.URL.Query().Get("page"); v != "" {
		if n, _ := strconv.Atoi(v); n > 0 {
			page = n
		}
	}
	if v := r.URL.Query().Get("page_size"); v != "" {
		if n, _ := strconv.Atoi(v); n > 0 && n <= 200 {
			size = n
		}
	}
	return
}

func (a *App) handleItems(w http.ResponseWriter, r *http.Request) {
	page, size := parsePage(r)
	offset := (page - 1) * size
	rows, err := a.db.Query(`
SELECT i.id,i.name,i.duration,i.fps,i.bucket,i.created_at,i.preview_path,
  (SELECT COUNT(*) FROM hashes WHERE item_id=i.id) AS hash_count,
  (SELECT COUNT(*) FROM chroma WHERE item_id=i.id) AS chroma_count
FROM items i
ORDER BY i.id DESC
LIMIT ? OFFSET ?`, size, offset)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	var items []Item
	for rows.Next() {
		var it Item
		var preview sql.NullString
		if err := rows.Scan(&it.ID, &it.Name, &it.Duration, &it.FPS, &it.Bucket, &it.Created, &preview, &it.Hashes, &it.Chroma); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		it.HasPreview = preview.Valid && strings.TrimSpace(preview.String) != ""
		items = append(items, it)
	}
	var total int
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM items`).Scan(&total)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"items": items, "page": page, "page_size": size, "total": total})
}

func (a *App) handleItem(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, "id required", 400)
		return
	}
	id, _ := strconv.ParseInt(idStr, 10, 64)
	row := a.db.QueryRow(`SELECT id,name,duration,fps,bucket,created_at,preview_path FROM items WHERE id=?`, id)
	var it Item
	var preview sql.NullString
	if err := row.Scan(&it.ID, &it.Name, &it.Duration, &it.FPS, &it.Bucket, &it.Created, &preview); err != nil {
		http.Error(w, "not found", 404)
		return
	}
	it.HasPreview = preview.Valid && strings.TrimSpace(preview.String) != ""
	resp := map[string]any{"item": it}
	inc := r.URL.Query().Get("include")
	if strings.Contains(inc, "hashes") {
		hrows, _ := a.db.Query(`SELECT t,hash FROM hashes WHERE item_id=? ORDER BY t ASC`, id)
		if hrows != nil {
			defer hrows.Close()
		}
		var hs []HashRow
		for hrows.Next() {
			var t int
			var u uint64
			hrows.Scan(&t, &u)
			hs = append(hs, HashRow{T: t, Hash: toHex64(u)})
		}
		resp["hashes"] = hs
	}
	if strings.Contains(inc, "chroma") {
		crows, _ := a.db.Query(`SELECT t,c0,c1,c2,c3,c4,c5,c6,c7,c8,c9,c10,c11 FROM chroma WHERE item_id=? ORDER BY t ASC`, id)
		if crows != nil {
			defer crows.Close()
		}
		var cs [][]float64
		for crows.Next() {
			var t int
			var v [12]sql.NullFloat64
			args := []any{&t, &v[0], &v[1], &v[2], &v[3], &v[4], &v[5], &v[6], &v[7], &v[8], &v[9], &v[10], &v[11]}
			crows.Scan(args...)
			vec := make([]float64, 12)
			for i := 0; i < 12; i++ {
				if v[i].Valid {
					vec[i] = v[i].Float64
				}
			}
			cs = append(cs, vec)
		}
		resp["chroma"] = cs
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (a *App) handleItemPreview(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, "id required", 400)
		return
	}
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		http.Error(w, "invalid id", 400)
		return
	}
	var preview sql.NullString
	if err := a.db.QueryRow(`SELECT preview_path FROM items WHERE id=?`, id).Scan(&preview); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "not found", 404)
			return
		}
		http.Error(w, err.Error(), 500)
		return
	}
	if !preview.Valid || strings.TrimSpace(preview.String) == "" {
		http.Error(w, "preview not available", 404)
		return
	}
	targetPath := strings.TrimSpace(preview.String)
	baseAbs, _ := filepath.Abs(a.cfg.UploadDir)
	abs, err := filepath.Abs(targetPath)
	if err != nil || !strings.HasPrefix(abs, baseAbs) {
		http.Error(w, "preview not available", 404)
		return
	}
	file, err := os.Open(abs)
	if err != nil {
		http.Error(w, "preview not available", 404)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.Error(w, "preview not available", 404)
		return
	}
	ext := strings.ToLower(filepath.Ext(abs))
	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		mimeType = "video/mp4"
	}
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, filepath.Base(abs), info.ModTime(), file)
}

type SearchReq struct {
	Hashes    []string    `json:"hashes"`
	Duration  int         `json:"duration,omitempty"`
	K         int         `json:"k,omitempty"`
	MaxHam    int         `json:"max_hamming,omitempty"`
	BucketTol int         `json:"bucket_tol,omitempty"`
	MaxCand   int         `json:"max_candidates,omitempty"`
	WV        float64     `json:"wv,omitempty"`
	WA        float64     `json:"wa,omitempty"`
	UseAudio  bool        `json:"use_audio,omitempty"`
	QChroma   [][]float64 `json:"q_chroma,omitempty"`
}

type SearchRes struct {
	ID       int64   `json:"id"`
	Name     string  `json:"name"`
	Score    float64 `json:"score"`
	Offset   int     `json:"offset,omitempty"`
	ScoreVis float64 `json:"score_vis,omitempty"`
	ScoreAud float64 `json:"score_aud,omitempty"`
}

func (a *App) handleSearch(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 5<<20) // limit ~5MB
	var req SearchReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if len(req.Hashes) == 0 {
		http.Error(w, "hashes required", 400)
		return
	}
	if req.K <= 0 {
		req.K = 10
	}
	if req.MaxHam <= 0 {
		req.MaxHam = 14
	}
	if req.BucketTol <= 0 {
		req.BucketTol = 1
	}
	if req.MaxCand <= 0 {
		req.MaxCand = 50
	}
	if req.WV < 0 {
		req.WV = 0.5
	}
	if req.WA < 0 {
		req.WA = 0.5
	}

	qU := make([]uint64, 0, len(req.Hashes))
	for _, hs := range req.Hashes {
		if u, err := parseHex64(hs); err == nil {
			qU = append(qU, u)
		}
	}
	if len(qU) == 0 {
		http.Error(w, "invalid query hashes", 400)
		return
	}

	if req.UseAudio && len(req.QChroma) == 0 {
		req.UseAudio = false
	}
	if !req.UseAudio {
		req.WA = 0
		if req.WV <= 0 {
			req.WV = 1.0
		}
	}
	if total := req.WV + req.WA; total > 0 {
		req.WV = req.WV / total
		req.WA = req.WA / total
	}

	key := searchCacheKey(req, qU)
	a.cacheMu.Lock()
	entry, ok := a.cache[key]
	if ok && time.Now().Before(entry.exp) {
		a.cacheMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"results": entry.value, "cached": true})
		return
	}
	a.cacheMu.Unlock()

	var allow map[int]struct{}
	if req.Duration > 0 {
		b := bucketOf(req.Duration)
		allow = map[int]struct{}{b: {}}
		for i := 1; i <= req.BucketTol; i++ {
			allow[b-i] = struct{}{}
			allow[b+i] = struct{}{}
		}
	}

	a.idxMu.RLock()
	candCounts := map[int64]int{}
	for _, u := range qU {
		for id, c := range a.lsh.Candidates(u) {
			candCounts[id] += c
		}
	}

	for _, u := range qU {
		for b, tr := range a.trees {
			if allow != nil {
				if _, ok := allow[b]; !ok {
					continue
				}
			}
			if tr != nil {
				tr.Search(u, req.MaxHam, candCounts)
			}
		}
	}
	a.idxMu.RUnlock()

	type pair struct {
		id  int64
		cnt int
	}
	pairs := make([]pair, 0, len(candCounts))
	for id, cnt := range candCounts {
		pairs = append(pairs, pair{id, cnt})
	}

	sort.Slice(pairs, func(i, j int) bool {
		return pairs[i].cnt > pairs[j].cnt
	})

	if len(pairs) > req.MaxCand {
		pairs = pairs[:req.MaxCand]
	}

	out := make([]SearchRes, 0, len(pairs))
	for _, pr := range pairs {
		name := ""
		_ = a.db.QueryRow(`SELECT name FROM items WHERE id=?`, pr.id).Scan(&name)
		hr, _ := a.db.Query(`SELECT hash FROM hashes WHERE item_id=? ORDER BY t ASC`, pr.id)
		var tU []uint64
		if hr != nil {
			for hr.Next() {
				var u uint64
				hr.Scan(&u)
				tU = append(tU, u)
			}
			hr.Close()
		}
		if len(tU) == 0 {
			continue
		}

		best := -1.0
		bestOff := 0
		n := len(qU)
		m := len(tU)

		if n > m {
			continue
		}
		for off := 0; off <= m-n; off++ {
			var s float64
			for i := 0; i < n; i++ {
				ham := hamming64(qU[i], tU[off+i])
				s += 1 - float64(ham)/63.0
			}
			mean := s / float64(n)
			if mean > best {
				best = mean
				bestOff = off
			}
		}
		if best < 0 {
			continue
		}

		scoreVis := best
		scoreAud := 0.0

		if req.UseAudio && req.WA > 0 && len(req.QChroma) > 0 {
			crows, _ := a.db.Query(`SELECT c0,c1,c2,c3,c4,c5,c6,c7,c8,c9,c10,c11 FROM chroma WHERE item_id=? ORDER BY t ASC`, pr.id)
			var tA [][]float64
			if crows != nil {
				for crows.Next() {
					var v [12]sql.NullFloat64
					args := []any{&v[0], &v[1], &v[2], &v[3], &v[4], &v[5], &v[6], &v[7], &v[8], &v[9], &v[10], &v[11]}
					crows.Scan(args...)
					vec := make([]float64, 12)
					for i := 0; i < 12; i++ {
						if v[i].Valid {
							vec[i] = v[i].Float64
						}
					}
					tA = append(tA, vec)
				}
				crows.Close()
			}

			lenA := len(req.QChroma)
			if bestOff+lenA <= len(tA) {
				var sa float64
				for i := 0; i < lenA; i++ {
					qa := req.QChroma[i]
					ta := tA[bestOff+i]
					var dot, nq, nt float64
					for k := 0; k < 12; k++ {
						dot += qa[k] * ta[k]
						nq += qa[k] * qa[k]
						nt += ta[k] * ta[k]
					}
					cos := dot / (1e-9 + (math.Sqrt(nq) * math.Sqrt(nt)))
					val := (cos + 1) / 2.0
					sa += val
				}
				scoreAud = sa / float64(lenA)
			}
		}

		score := req.WV*scoreVis + req.WA*scoreAud
		out = append(out, SearchRes{ID: pr.id, Name: name, Score: score, Offset: bestOff, ScoreVis: scoreVis, ScoreAud: scoreAud})
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].Score > out[j].Score
	})

	if len(out) > req.K {
		out = out[:req.K]
	}

	// approx size guard to avoid caching huge payloads
	if est := len(out) * approxPerResult; est < maxCacheEntryBytes {
		a.cacheMu.Lock()
		defer a.cacheMu.Unlock()
		if a.cacheSizeLocked()+est <= maxCacheBytes {
			a.cache[key] = cacheEntry{
				exp:     time.Now().Add(a.cfg.CacheTTL),
				created: time.Now(),
				value:   out,
			}
			a.pruneCacheLocked()
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"results": out})
}

func searchCacheKey(req SearchReq, qU []uint64) string {
	h := sha256.New()
	fmt.Fprintf(h, "k:%d|max:%d|tol:%d|mc:%d|wv:%f|wa:%f|aud:%v|dur:%d|chroma:%d|hashes:",
		req.K, req.MaxHam, req.BucketTol, req.MaxCand, req.WV, req.WA, req.UseAudio, req.Duration, len(req.QChroma))
	for _, u := range qU {
		fmt.Fprintf(h, "%x,", u)
	}
	if len(req.QChroma) > 0 {
		for _, vec := range req.QChroma {
			for _, v := range vec {
				fmt.Fprintf(h, "%.6f,", v)
			}
			fmt.Fprint(h, "|")
		}
	}
	sum := h.Sum(nil)
	return "s:" + hex.EncodeToString(sum)[:16]
}

const (
	maxCacheEntries    = 200
	maxCacheBytes      = 512 * 1024
	maxCacheEntryBytes = 256 * 1024
	approxPerResult    = 128 // rough bytes per SearchRes
)

func (a *App) cacheSizeLocked() int {
	total := 0
	for _, v := range a.cache {
		total += len(v.value) * approxPerResult
	}
	return total
}

func (a *App) pruneCacheLocked() {
	// enforce entry count
	for len(a.cache) > maxCacheEntries || a.cacheSizeLocked() > maxCacheBytes {
		var oldestKey string
		var oldest time.Time
		first := true
		for k, v := range a.cache {
			if first || v.created.Before(oldest) {
				oldestKey = k
				oldest = v.created
				first = false
			}
		}
		if oldestKey != "" {
			delete(a.cache, oldestKey)
		} else {
			break
		}
	}
}

func (a *App) handleReset(w http.ResponseWriter, r *http.Request) {
	a.db.Exec(`DELETE FROM chroma`)
	a.db.Exec(`DELETE FROM hashes`)
	a.db.Exec(`DELETE FROM items`)

	a.idxMu.Lock()
	a.trees = map[int]*BKTree{}
	a.lsh = NewLSH()
	a.idxMu.Unlock()

	a.invalidateCache()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (a *App) handleExportJSON(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/jsonl")
	w.Header().Set("Content-Disposition", "attachment; filename=\"corpus.jsonl\"")
	rows, _ := a.db.Query(`SELECT id,name,duration,fps,bucket,created_at FROM items ORDER BY id ASC`)
	if rows != nil {
		defer rows.Close()
	}
	enc := json.NewEncoder(w)
	for rows.Next() {
		var it Item
		rows.Scan(&it.ID, &it.Name, &it.Duration, &it.FPS, &it.Bucket, &it.Created)
		hrows, _ := a.db.Query(`SELECT t,hash FROM hashes WHERE item_id=? ORDER BY t ASC`, it.ID)
		var hs []HashRow
		if hrows != nil {
			for hrows.Next() {
				var t int
				var u uint64
				hrows.Scan(&t, &u)
				hs = append(hs, HashRow{T: t, Hash: toHex64(u)})
			}
			hrows.Close()
		}
		crows, _ := a.db.Query(`SELECT t,c0,c1,c2,c3,c4,c5,c6,c7,c8,c9,c10,c11 FROM chroma WHERE item_id=? ORDER BY t ASC`, it.ID)
		var cs [][]float64
		if crows != nil {
			for crows.Next() {
				var t int
				var v [12]sql.NullFloat64
				args := []any{&t, &v[0], &v[1], &v[2], &v[3], &v[4], &v[5], &v[6], &v[7], &v[8], &v[9], &v[10], &v[11]}
				crows.Scan(args...)
				vec := make([]float64, 12)
				for i := 0; i < 12; i++ {
					if v[i].Valid {
						vec[i] = v[i].Float64
					}
				}
				cs = append(cs, vec)
			}
			crows.Close()
		}
		enc.Encode(map[string]any{"item": it, "hashes": hs, "chroma": cs})
	}
}

func main() {
	cfg := loadConfig()
	if strings.TrimSpace(cfg.APIKey) == "" {
		log.Fatal("MF_APIKEY harus diset untuk menjalankan server")
	}
	if len(cfg.CORSList) == 0 {
		log.Fatal("MF_CORS_ORIGIN harus diisi daftar origin yang diizinkan (pisahkan dengan koma). '*' tidak diperbolehkan.")
	}
	db, err := sql.Open("sqlite", cfg.DBPath+"?_busy_timeout=5000")
	if err != nil {
		log.Fatal(err)
	}

	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)

	app := &App{cfg: cfg, db: db}
	if err := app.initDB(); err != nil {
		log.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := app.rebuild(ctx); err != nil {
		log.Fatal(err)
	}

	publicMux := http.NewServeMux()
	publicMux.HandleFunc("/api/health", app.handleHealth)

	protected := http.NewServeMux()
	protected.HandleFunc("/api/items", app.handleItems)
	protected.HandleFunc("/api/item", app.handleItem)
	protected.HandleFunc("/api/search", app.handleSearch)
	protected.HandleFunc("/api/export/json", app.handleExportJSON)
	protected.HandleFunc("/api/index/json", app.handleIndexJSON)
	protected.HandleFunc("/api/index/upload", app.handleUpload)
	protected.HandleFunc("/api/reset", app.handleReset)
	protected.HandleFunc("/api/item/preview", app.handleItemPreview)

	h := app.cors(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" {
			publicMux.ServeHTTP(w, r)
			return
		}
		app.apikey(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			protected.ServeHTTP(w, r)
		})).ServeHTTP(w, r)
	}))

	log.Printf("MediaFinder backend v4 (Fixed) listening on %s\n", cfg.Listen)
	log.Fatal(http.ListenAndServe(cfg.Listen, h))
}
