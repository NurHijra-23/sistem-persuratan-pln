# Sistem Persuratan SPPD TAD ULTG Parepare (frontend-only)

Aplikasi React + Vite tanpa backend. Semua proses berjalan di browser.

## Menjalankan
```
npm install
npm run dev      # pengembangan
npm run build    # hasil di dist/
```

## Arsitektur
- Data personel, perjalanan, dan draft: IndexedDB (`src/services/db.js`). Data hanya ada di browser ini.
- Personel awal diisi otomatis dari `public/seed/employees.json` saat database kosong.
- Template dokumen: `public/templates/` (`sppd-template-otomatis.docx`, `sppd-template.docx`, `Form Perhitungan SPPD TAD Har3.xlsx`).
- Pembuatan Word/Excel/ZIP: `src/services/sppd/`. Adapter pengganti API: `src/services/localApi.js`.
- Cadangan JSON: menu **Cadangan**. Berkas `data-awal/cadangan-awal-sppd.json` berisi personel dan draft lama untuk diimpor.
- `npm run test:dokumen` membuat dokumen contoh di Node (perlu `npm install`).

## Pratinjau
Pratinjau memakai `docx-preview` (dokumen Word dirender di browser). Tampilan bisa sedikit berbeda dari Microsoft Word; pratinjau Excel tampil sebagai tabel Word, bukan tata letak cetak Excel. PDF asli (LibreOffice) tidak lagi tersedia tanpa server.

## Catatan
- Data hilang bila data situs browser dihapus: unduh cadangan secara berkala.
- Dua unduhan berurutan bisa meminta izin browser; gunakan tombol ZIP sebagai alternatif.
- Belum diuji: `npm run build` Vite dan pustaka `docx-preview` asli.
