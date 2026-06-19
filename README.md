# Sumber Rasa — Stok Gudang (v1)

Aplikasi web stok gudang dengan login multi-role, master data barang,
transaksi stok (masuk/keluar/opname), dan dashboard ringkasan.
Backend menggunakan Firebase (Authentication + Firestore) sehingga data
tersinkron real-time dan bisa diakses banyak user sekaligus dari device
berbeda.

## Status modul

✅ Sudah jadi (v1):
- Login & role (Admin, Supervisor, Staff, Viewer)
- Master Data Barang (search, filter kategori, autocomplete, slider A-Z)
- Transaksi Stok: Barang Masuk, Barang Keluar, Stock Opname (otomatis hitung selisih)
- Dashboard Ringkasan

🔜 Menyusul (fase berikutnya, dibangun di atas pondasi yang sama):
- Riwayat Pergerakan Barang (filter & lihat semua transaksi)
- Rekap Stok Gudang per kategori
- Log Aktivitas User (tampilan — datanya sudah dicatat sejak v1)
- Import barang via Excel
- Export laporan ke Excel/PDF
- Laporan & Analisis + grafik
- Backup data otomatis

---

## 1. Buat project Firebase

1. Buka https://console.firebase.google.com → **Add project**.
2. Beri nama, misalnya `sumber-rasa-stok-gudang`. Lanjutkan sampai selesai.

## 2. Aktifkan Authentication

1. Di sidebar Firebase Console → **Build > Authentication > Get started**.
2. Tab **Sign-in method** → aktifkan **Email/Password**.

> Catatan: Firebase Auth butuh format email. Tidak masalah kalau email-nya
> tidak benar-benar aktif menerima pesan — yang penting formatnya valid dan
> password-nya diingat. Contoh ID yang disarankan:
> `admin@sumberrasatungkal.id`, `staff1@sumberrasatungkal.id`, dst.

## 3. Aktifkan Firestore Database

1. **Build > Firestore Database > Create database**.
2. Pilih **Start in production mode**, pilih lokasi server (misalnya `asia-southeast2` / Jakarta).
3. Setelah dibuat, buka tab **Rules**, hapus isinya, lalu **copy-paste seluruh isi file `firestore.rules`** dari project ini, klik **Publish**.

## 4. Ambil konfigurasi project & isi ke aplikasi

1. **Project settings** (ikon gerigi di sidebar) → scroll ke **Your apps** → klik ikon `</>` (Web) → daftarkan app (nama bebas, tidak perlu centang Firebase Hosting).
2. Firebase akan menampilkan object `firebaseConfig`. Salin semua nilainya.
3. Buka file `js/firebase-config.js` di project ini, ganti semua nilai `GANTI_...` dengan nilai asli dari Firebase.
4. Simpan file.

## 5. Buat user pertama (Admin)

Karena aplikasi ini belum punya halaman "daftar akun sendiri" (sengaja,
demi keamanan — supaya tidak ada orang luar yang bisa mendaftar sendiri),
user dibuat manual oleh Anda lewat Firebase Console:

1. **Authentication > Users > Add user**. Isi email (misal `admin@sumberrasatungkal.id`) dan password.
2. Setelah dibuat, **salin UID** user tersebut (kolom paling kiri tabel user).
3. Buka **Firestore Database > Start collection** → nama collection: `users`.
4. **Document ID**: paste UID yang tadi disalin (jangan pakai auto-ID).
5. Tambahkan field-field berikut pada dokumen tersebut:
   | Field      | Tipe    | Nilai contoh                  |
   |------------|---------|--------------------------------|
   | `username` | string  | `admin`                        |
   | `name`     | string  | `Nama Anda`                    |
   | `role`     | string  | `admin`                        |
   | `active`   | boolean | `true`                         |
6. Klik **Save**. Sekarang Anda bisa login ke aplikasi dengan email & password tadi.

Ulangi langkah 1–6 untuk user lain, dengan `role` salah satu dari:
`admin`, `supervisor`, `staff`, atau `viewer`.

## 6. Jalankan / deploy aplikasi

**Coba lokal dulu (opsional):** buka folder ini dengan ekstensi "Live Server"
di VS Code, atau jalankan `npx serve` di folder ini, lalu buka di browser.
(Tidak bisa dibuka langsung dengan double-click file karena pakai ES Module.)

**Deploy ke GitHub Pages** (seperti app HR sebelumnya):
1. Buat repo baru di GitHub, misal `sumber-rasa-stok-gudang`.
2. Upload semua isi folder ini (termasuk file `js/firebase-config.js` yang sudah diisi) ke repo tersebut.
3. Settings repo → **Pages** → Source: pilih branch `main`, folder `/ (root)` → Save.
4. Tunggu 1–2 menit, aplikasi akan tersedia di
   `https://<username-github>.github.io/<nama-repo>/`.

## Catatan keamanan

- File `js/firebase-config.js` yang terisi nilai asli **boleh** diunggah ke
  GitHub publik — nilai-nilai itu memang dipakai di sisi browser dan bukan
  rahasia. Keamanan data sesungguhnya dijaga oleh **Firestore Security
  Rules** (file `firestore.rules`) yang membatasi siapa boleh baca/tulis apa.
- Pastikan rules sudah di-publish sebelum dipakai banyak user, supaya
  Staff/Viewer tidak bisa mengubah data yang bukan haknya.

## Struktur data Firestore

- `users/{uid}` → `{ username, name, role, active }`
- `items/{itemId}` → `{ name, category, unit, currentStock, minStock, createdAt, updatedAt, createdBy }`
- `transactions/{txId}` → `{ type: 'masuk'|'keluar'|'opname', itemId, itemName, qty, unit, userId, userName, timestamp, notes, stokSistem?, stokFisik?, selisih? }`
- `activityLogs/{logId}` → `{ uid, userName, action, detail, timestamp }`
