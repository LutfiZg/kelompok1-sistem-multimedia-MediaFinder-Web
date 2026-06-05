# MediaFinder Backend (Go + SQLite + BK-tree)

## Fitur
- REST API dengan **SQLite** dan **BK-tree (Hamming)** untuk pHash.
- **API Key** via header `X-API-Key` (opsional).
- **CORS**: default `*` (atur `MF_CORS_ORIGIN`).
- Upload file opsional (disimpan ke `./data/uploads`).

## Build & Run
```bash
cd mediafinder-backend-go-v1
go mod tidy
go run ./cmd/server

# ENV (opsional)
# MF_LISTEN=:8088
# MF_DB=./data/mediafinder.db
# MF_APIKEY=secret123
# MF_CORS_ORIGIN=http://localhost:8080
# MF_UPLOAD_DIR=./data/uploads
```
## Endpoint
- `GET /api/health`
- `GET /api/items`
- `GET /api/item?id=123&include=hashes,chroma`
- `GET /api/item/preview?id=123` (stream preview yang disimpan di `MF_UPLOAD_DIR`)
- `POST /api/index/json` (protected): 
```json
{
  "item": {
    "name":"Sample",
    "duration":42,
    "fps":1.0,
    "preview_path":"./data/uploads/1700000000_sample.mp4"
  },
  "hashes":[{"t":0,"hash":"a1b2..."}, ...],
  "chroma":[[0.1, ... 12 dim], ...] // opsional
}
```
- `POST /api/index/upload` (protected): multipart `file`
- `POST /api/search`:
```json
{"hashes":["a1b2...","..."], "duration":42, "k":10, "max_hamming":14, "bucket_tol":1}
```
- `POST /api/reset` (protected)

Field `preview_path` menunjuk ke file pada `MF_UPLOAD_DIR` (mis. hasil dari endpoint upload) dan akan dipakai oleh `/api/item/preview` untuk menyajikan cuplikan ke frontend.



## v2 (this folder)
- **BK-tree per bucket** + **LSH** (4 bands × 16-bit) untuk kandidat cepat.
- **Local alignment** per detik di server + opsi **fusion audio** (parameter `wv`/`wa`).
- **Pagination**: `/api/items?page=1&page_size=20`.
- **Export Corpus**: `GET /api/export/json` (JSONL).
- **Dockerfile & docker-compose** untuk deployment cepat.

> Catatan: untuk audio fusion yang akurat, kirimkan juga chroma kueri di masa depan (endpoint bisa diperluas). Saat ini server menggunakan skor visual lokal sebagai dasar utama.



## v3 (this folder)
- Endpoint `/api/search` kini menerima **`q_chroma`** (array `[ [12], [12], ... ]`) untuk **fusion audio** server-side yang akurat.
- Frontend v1.6 mengirim `q_chroma` saat tersedia.

## Identitas Karya
- **Nama Aplikasi**: MediaFinder Web
- **Kelompok**: Kelompok 1
- **Anggota Kelompok**:
  - Lutfi Ghifari Hibban
  - Ahid Novryan
- **Dosen Pengampu**: Wikky Fawwaz Al Maki
