# Insight Engine – Format & Ekstensibilitas

## Struktur Output

Setiap panggilan `InsightEngine.generate({ snapshot })` akan mengembalikan array objek dengan struktur konsisten berikut:

```jsonc
{
  "type": "timeline",              // kategori sumber insight
  "key": "timeline:0.82:10",       // kunci unik untuk feedback/pelacakan
  "severity": "critical",          // critical | high | success | warning | medium | low | info
  "title": "Skor global 0.820 (tinggi)",
  "summary": "Durasi 120s dengan skor puncak 0.93.",
  "supporting": { ... }            // data mentah pendukung (peaks, heatmap, dsb.)
}
```

- **type**: sumber atau kategori, mis. `timeline`, `gap`, `heatmap`, `robustness`, `evaluation`.
- **key**: string unik yang dipakai untuk caching feedback/user votes. Jika tidak disediakan saat membuat insight, UI akan membangunnya dari `type:title`.
- **severity**: menentukan warna badge & prioritas. Direkomendasikan konsisten dengan daftar di atas.
- **supporting**: data tambahan yang dapat dipakai UI, ekspor laporan, atau modul lain.

## Snapshot Input

`collectInsightSnapshot()` menghasilkan objek dengan beberapa bagian, antara lain:

- `timeline`: skor global, panjang fused timeline, daftar puncak `peaks`.
- `heatmap`: matriks kemiripan (avg, ukuran) serta metadata DTW.
- `robustness`: ringkasan hasil batch ffmpeg (best/worst variant).
- `evaluation`: precision/recall/F1 dari modul evaluasi.
- `shots`, `heatmap`, `evaluation` ... (lihat implementasi pada `app.js` untuk detail).

Modul insight bebas menggunakan subset manapun dari snapshot.

## Menambahkan Processor Baru

`insightEngine.js` menyediakan registri modular. Tambahkan heuristik/ML model baru via:

```js
import InsightEngine from './insightEngine.js';

InsightEngine.registerProcessor((snapshot) => {
  if (!snapshot.timeline?.available) return [];
  // hitung sesuatu...
  return [{
    type: 'custom',
    key: 'custom:foo',
    severity: 'high',
    title: 'Judul insight',
    summary: 'Penjelasan singkat',
    supporting: { ... }
  }];
});
```

Setiap processor harus mengembalikan:
- Array insight (atau single object), atau `[]` bila tidak ada insight untuk kondisi tersebut.
- Boleh mengakses service tambahan (mis. hasil ML dari backend) selama async diselesaikan sebelum pengembalian.

## Testing

Unit test contoh (`tests/insightEngine.test.js`) menunjukkan cara membuat snapshot dummy dan memeriksa severity/gap. Jalankan dengan:

```bash
cd MediaFinder_frontend_fixed_racecache
node tests/insightEngine.test.js
```

Tambahkan scenario test baru untuk kasus khusus (heatmap panjang, robustnes sensitif, dsb.) agar regresi mudah terdeteksi.

## Logging & Debug Mode

Set `localStorage.mf_insight_debug = '1'` di browser untuk mengaktifkan `console.table` insight terbaru. Nonaktifkan dengan menghapus key tersebut.
