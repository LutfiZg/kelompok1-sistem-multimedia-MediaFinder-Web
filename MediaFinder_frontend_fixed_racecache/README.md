# MediaFinder Web — v1.8

Aplikasi web untuk pengindeksan dan pencarian kemiripan konten video menggunakan perceptual hashing (pHash) dan audio chroma fingerprinting. Semua pemrosesan dilakukan di sisi klien (dalam browser).

## Fitur Utama
- **Indeks Video**: Ekstraksi pHash visual dan chroma audio dari file video.
- **Pencarian Cepat**: Menemukan klip yang mirip secara visual dan audio.
- **Analisis Mendalam**:
  - Timeline kemiripan per detik.
  - Heatmap visual untuk melihat korelasi antar segmen.
  - Dynamic Time Warping (DTW) untuk melihat alur kemiripan.
- **Uji Robustness**: Menguji ketahanan pencocokan terhadap degradasi video (resolusi, kompresi).
- **Mode PWA**: Dapat diinstal sebagai aplikasi desktop/mobile.
- **Privasi Terjaga**: Semua file dan data diproses dan disimpan secara lokal di browser Anda menggunakan IndexedDB.
- **Insight Otomatis**: Mesin insight modular (lihat `docs/INSIGHTS.md`) yang menganalisis timeline, heatmap, robustness, dan evaluasi serta mendukung feedback pengguna.

## Cara Menjalankan
1. Pastikan Anda memiliki web server lokal. Contoh menggunakan `serve`:
   ```bash
   npx serve
2. Buka URL yang ditampilkan (misalnya http://localhost:3000).

Alur Penggunaan
Tab Indeks: Impor beberapa video referensi Anda.
Tab Pencarian: Unggah video kueri untuk dicari kemiripannya di dalam indeks.
Tab Analisis: Klik tombol "Analisis" pada hasil pencarian untuk melihat perbandingan detail antara kueri dan video target.

## Insight Engine & Ekstensi
- Lihat `docs/INSIGHTS.md` untuk format output, cara menambahkan processor baru, dan panduan testing.
- `insightEngine.js` mendukung registrasi processor tambahan (`registerProcessor`) sehingga heuristik/ML model baru dapat ditambahkan tanpa mengubah UI.
