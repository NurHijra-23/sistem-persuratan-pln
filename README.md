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

## Stempel kantor dan penghapusan latar (v4)

**Stempel** (menu *Tanda Tangan*, kartu "Stempel kantor"): unggah PNG/JPG/JPEG. Stempel muncul di samping tanda
tangan manajer (default di kiri, bisa di kanan) dan sebagian menimpa ujung tanda tangan. Posisi, ukuran, dan
transparansi diatur di kartu (angka/slider) atau di editor posisi (seret, tarik handle, tombol Perbesar/Perkecil,
slider Transparansi). Tombol: Ganti gambar, Hapus, Sembunyikan/Tampilkan, Reset posisi. Dengan opsi
"Jaga agar tidak menutupi teks" aktif, stempel otomatis dijaga agar tidak menimpa judul "MANAGER ULTG PAREPARE"
dan nama manajer, tetap di dalam margin surat, dan di atas kaki surat. Gambar + pengaturan tersimpan di IndexedDB
(store `settings`, ikut ekspor/impor cadangan).

**Hapus latar** (tanda tangan manajer, paraf, stempel, tanda tangan karyawan): setelah memilih gambar muncul dialog
berisi gambar asli dan hasil berdampingan (latar uji kotak-kotak/putih/gelap/merah muda), pilihan metode
(Otomatis, Latar polos/putih, Latar berwarna/tidak rata dari tepi, Jangan hapus), slider toleransi, pangkas tepi
kosong, statistik, dan peringatan. Pilihan: *Pakai hasil ini*, *Pakai gambar asli*, *Unggah ulang*, *Batal*.
Tombol *Hapus latar* juga tersedia untuk gambar yang sudah tersimpan.

Keterbatasan (diuji pada gambar sintetis dan fixture, bukan semua gambar nyata):
- Latar polos/putih (termasuk JPG berderau) ditangani dengan baik, garis tipis ~1 px dan warna tinta terjaga.
- Latar berwarna/bergradasi dihapus dari tepi; area tertutup (mis. bagian dalam lingkaran stempel) dipertahankan
  kecuali opsi "Hapus juga area tertutup" dinyalakan.
- Latar bertekstur kuat, foto, atau tinta yang warnanya mirip latar tidak dapat dijamin bersih. Periksa hasil di
  dialog; bila kurang baik pakai gambar asli atau ubah toleransi/metode.
- Toleransi tinggi dapat menghapus garis pensil yang sangat pucat.

Uji: `npm run test:dokumen` (dokumen) dan `npm run test:latar` (algoritma penghapusan latar).

## Ukuran tanda tangan, paraf, dan stempel: otomatis lalu manual (v5)

Awalnya setiap gambar berukuran **otomatis**: paraf dimuat dalam selnya di atas garis paraf, tanda tangan
dipotong tingginya agar tidak menutupi teks di atasnya, dan stempel diperkecil agar muat di area tanda tangan.
Begitu Anda mengatur lebar sendiri (kolom Lebar, menarik handle di editor posisi, atau tombol Perbesar/Perkecil
stempel), ukuran berubah menjadi **manual**: dipakai persis seperti yang Anda atur, tanpa pembatasan otomatis
(lebar 2-400 mm, geser ??300 mm). Tombol **Ukuran otomatis** pada tiap kartu mengembalikan ke ukuran awal.
Slot yang terakhir disentuh di editor naik ke lapisan atas sehingga handle-nya tetap bisa diraih saat tertutup slot lain.
Catatan: untuk stempel, opsi "Jaga agar tidak menutupi teks" tetap menggeser posisi menjauhi teks bila dinyalakan
(ukuran tidak diubah); matikan opsi itu untuk kebebasan penuh.
