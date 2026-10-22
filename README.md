# Sistem Persuratan SPPD TAD ULTG Parepare (frontend-only)

Aplikasi React + Vite tanpa backend. Semua proses (data, dokumen, PDF) berjalan di browser.

## Menjalankan
```
npm install
npm run dev      # pengembangan
npm run build    # hasil di dist/ (siap di-deploy ke Vercel)
```

## Fitur utama: Unduh Gabungan PDF
- Halaman **Input SPPD** -> tombol **Unduh Gabungan PDF**: satu PDF berisi surat lalu formulir perhitungan untuk setiap perjalanan yang dicentang (kotak "PDF" pada tiap perjalanan), berurutan: surat 1, formulir 1, surat 2, formulir 2, ...
- **Tinjau Gabungan** menampilkan halaman PDF yang sama dengan yang diunduh (termasuk tanda tangan/paraf). Tombol Unduh PDF di jendela itu menyimpan byte yang sama.
- **Tanggal surat** otomatis sama dengan tanggal berangkat tiap perjalanan (tidak ada input tanggal surat lagi).
- Unduh Word / Excel terpisah dan Gabungan Word tetap ada sebagai pilihan tambahan.

## Tanda tangan & paraf (menu "Tanda Tangan")
- **Atur Posisi Langsung:** halaman contoh (surat dan formulir) ditampilkan dengan gambar yang bisa digeser dan diubah ukurannya (tarik kotak di sudut kanan-bawah, atau pilih gambar lalu tombol panah: 0,5 mm, Shift = 2 mm). Posisi memakai perhitungan yang sama dengan PDF. Tersimpan otomatis di IndexedDB dan ikut cadangan JSON.
- **Tidak menutupi teks:** tanda tangan manajer berdiri tepat di atas nama (di bawah tulisan "MANAGER ULTG PAREPARE,"), paraf 1-3 dibagi rata di atas garis paraf di sebelah kanan kata "Paraf", dan tanda tangan karyawan di atas nama pada formulir. Opsi "Jaga agar tidak menutupi teks" (aktif secara bawaan) mengecilkan gambar yang terlalu besar; kotak oranye di editor menandakan ukuran sedang dibatasi.
- **Tanda tangan per karyawan:** semua karyawan tampil di daftar "Tanda Tangan Karyawan" dengan tempat unggah sendiri. Di **Input SPPD**, tanda tangan terpasang **otomatis** pada formulir setiap perjalanan sesuai nama karyawannya (dicocokkan lewat ID, nama, panggilan, atau alias). Pilihan per perjalanan "Tanda tangan karyawan di formulir" tetap bisa diganti ke "Tanpa tanda tangan" atau karyawan lain.
- Tiap slot dapat dinonaktifkan; gambar PNG/JPG (PNG transparan paling baik) dapat diganti atau dihapus. Aplikasi tidak membuat tanda tangan sendiri.

## Cara kerja PDF di browser dan keterbatasannya
Dokumen Word gabungan (surat + formulir) dirender oleh `docx-preview` menjadi halaman HTML, setiap halaman diubah menjadi gambar beresolusi tinggi (240 dpi, JPEG), lalu dikemas menjadi PDF dengan `pdf-lib`. Kop surat dan garis paraf yang tidak digambar `docx-preview` ditambahkan dari data template Word. Tanda tangan/paraf digambar di atas halaman sebagai gambar yang Anda unggah.
Keterbatasan:
- Halaman PDF berupa gambar: teks tidak bisa diseleksi/dicari dan ukuran file sekitar 0,5-0,8 MB per halaman.
- Tampilan mengikuti hasil render `docx-preview` (bukan Microsoft Word); jarak dan font bisa sedikit berbeda dari Word/LibreOffice. Font memakai font sistem (Arial -> Liberation Sans/Helvetica bila tidak ada).
- Memerlukan browser modern (Chrome/Edge/Firefox/Safari terbaru). Pembuatan PDF butuh beberapa detik per perjalanan.
- Gambar halaman dibuat lewat SVG `foreignObject`; bila suatu browser gagal, aplikasi menampilkan pesan kesalahan dan tidak mengunduh file.

## Arsitektur
- Data personel, perjalanan, draft: IndexedDB (`src/services/db.js`, versi 2). Cadangan JSON: menu **Cadangan**.
- Template: `public/templates/` (`sppd-template-otomatis.docx`, `sppd-template.docx`, `Form Perhitungan SPPD TAD Har3.xlsx`).
- Word/Excel: `src/services/sppd/`. PDF: `src/services/pdf/` (`rasterPages.js`, `letterDecor.js`, `combinedPdf.js`). Tanda tangan: `src/services/signatures.js`. Pratinjau PDF: `src/components/CombinedPreview.jsx` (pdf.js).
- Data hilang bila data situs browser dihapus: unduh cadangan secara berkala.
