# Absensi SMB Naga Putta

Sistem absensi untuk Sekolah Minggu Buddhis Naga Putta. Siswa punya kartu QR masing-masing,
pengurus scan pakai kamera HP, datanya tersimpan permanen di **Turso** (database SQLite di cloud, gratis),
dan aplikasinya bisa di-deploy gratis lewat **Render** supaya bisa diakses dari device mana pun lewat satu link.

## Fitur

- **Login 2 peran:** Admin (kelola akun) & Pengurus (kelola siswa, kelas, sesi, scan, kartu QR, rekap).
- **Scan pakai kamera HP** (`html5-qrcode`) + input kode manual sebagai cadangan.
- **Batas jam hadir** (default 10:00, bisa diubah) — dihitung pakai jam **server**, zona waktu Asia/Jakarta, supaya tidak bisa dicurangi lewat jam HP.
- **Rekap kehadiran** per siswa + unduh CSV.
- **Database Turso** — semua data (siswa, kelas, sesi, kehadiran, akun) tersimpan permanen di cloud, bisa dilihat langsung dari dashboard Turso.

---

## Langkah 1 — Buat database Turso (gratis, ± 5 menit)

1. Buka **[turso.tech](https://turso.tech)** → daftar (bisa langsung pakai akun GitHub, lebih cepat).
2. Di dashboard, klik **Create Database** (atau "New Database"). Kasih nama bebas, misalnya `smb-naga-putta`. Pilih lokasi server terdekat (mis. Singapore) lalu buat.
3. Setelah database jadi, buka halaman database tersebut. Cari dan salin dua hal berikut (biasanya ada tombol "Create Token" / "Generate Token" dan info "Database URL" atau "Connection String"):
   - **Database URL** — formatnya `libsql://nama-database-kamu.turso.io`
   - **Auth Token** — teks panjang acak
4. Simpan dua nilai ini, dipakai di Langkah 3.

> Kalau tampilan dashboard-nya beda dari yang dijelaskan di atas (Turso kadang update tampilan), cara paling stabil pakai CLI:
> ```bash
> curl -sSfL https://get.tur.so/install.sh | bash
> turso auth login
> turso db create smb-naga-putta
> turso db show smb-naga-putta --url
> turso db tokens create smb-naga-putta
> ```
> Dua perintah terakhir itu yang mengeluarkan Database URL dan Auth Token.

**Cara lihat isi database kapan saja:** buka dashboard Turso → pilih database kamu → biasanya ada tab **"Studio"** atau **"Data"** yang bisa langsung menampilkan isi tabel (`students`, `attendance`, dst) dan menjalankan query SQL lewat browser. Atau lewat CLI: `turso db shell smb-naga-putta` lalu ketik misalnya `SELECT * FROM students;`.

## Langkah 2 — Coba jalankan di komputer sendiri dulu (opsional tapi disarankan)

Butuh [Node.js](https://nodejs.org) 18+.

```bash
npm install
cp .env.example .env
```

Buka file `.env`, isi `TURSO_DATABASE_URL` dan `TURSO_AUTH_TOKEN` dengan nilai dari Langkah 1, lalu:

```bash
npm start
```

Buka `http://localhost:3000`. Login pakai akun default:
- **Username:** `admin`
- **Password:** `admin123`

⚠️ Segera buat akun pengurus & ganti password admin sebelum dipakai sungguhan (lewat tab "Kelola Akun").

## Langkah 3 — Push ke GitHub

1. Buat repository baru di [github.com](https://github.com/new) (boleh **private**), misalnya `smb-naga-putta`.
2. Di folder proyek ini, jalankan:
   ```bash
   git init
   git add .
   git commit -m "Absensi SMB Naga Putta"
   git branch -M main
   git remote add origin https://github.com/USERNAME-GITHUB-KAMU/smb-naga-putta.git
   git push -u origin main
   ```
   (Ganti `USERNAME-GITHUB-KAMU` sesuai akun GitHub kamu. File `.env` **tidak akan ikut ter-upload** karena sudah ada di `.gitignore` — aman, kredensial tidak bocor ke GitHub.)

## Langkah 4 — Deploy ke Render (gratis)

1. Buka **[render.com](https://render.com)** → daftar/login (bisa pakai akun GitHub).
2. Klik **New +** → **Web Service**.
3. Pilih **"Build and deploy from a Git repository"** → hubungkan akun GitHub kamu → pilih repo `smb-naga-putta` yang tadi di-push.
4. Isi konfigurasi:
   - **Name:** bebas, misalnya `absensi-smb-naga-putta`
   - **Region:** Singapore (paling dekat ke Indonesia)
   - **Branch:** `main`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
5. Buka bagian **Environment Variables**, tambahkan satu per satu:
   | Key | Value |
   |---|---|
   | `JWT_SECRET` | teks acak yang panjang & rahasia (ketik bebas, jangan dikosongkan) |
   | `TZ` | `Asia/Jakarta` |
   | `TURSO_DATABASE_URL` | dari Langkah 1 |
   | `TURSO_AUTH_TOKEN` | dari Langkah 1 |
6. Klik **Create Web Service**. Tunggu 2–5 menit sampai build selesai (statusnya jadi "Live").
7. Render akan kasih link publik, formatnya `https://absensi-smb-naga-putta.onrender.com` — **itu link yang dipakai semua pengurus** dari HP/laptop masing-masing.

### Catatan soal tier gratis Render

Layanan gratis Render akan "tidur" kalau tidak diakses selama 15 menit, dan butuh sekitar 30–60 detik untuk "bangun" lagi saat pertama kali diakses. Untuk absensi mingguan (dipakai tiap hari Minggu), ini biasanya tidak masalah — cukup buka linknya beberapa menit sebelum sekolah minggu dimulai supaya sudah "bangun".

### Kamera perlu HTTPS

Render otomatis kasih HTTPS, jadi begitu live, fitur scan kamera langsung bisa dipakai dari HP mana pun tanpa setting tambahan.

### Update aplikasi di kemudian hari

Setiap kali kamu `git push` perubahan ke branch `main`, Render otomatis build & deploy ulang. Database di Turso **tidak ikut ter-reset** karena terpisah dari Render — datanya tetap aman.

---

## Cara pakai singkat (setelah live)

1. Login sebagai **admin** → tab "Kelola Akun" → buat akun untuk tiap pengurus.
2. Logout, login sebagai **pengurus** pakai akun yang baru dibuat.
3. Cek/tambah **Kelas** (default: Belum Sekolah–Kelas 1, Kelas 2–4, Kelas 5–SMP).
4. Tambahkan **Data Siswa** — tiap siswa otomatis dapat kode unik.
5. Buka **Kartu Absen**, cetak kartu QR untuk dibagikan ke tiap siswa (disarankan dilaminating).
6. Tiap minggu: **Sesi Absen** → "Buka Sesi Hari Ini".
7. **Scan Absen** → izinkan akses kamera browser → arahkan ke kartu tiap siswa.
8. Cek **Rekap**, bisa diunduh sebagai CSV kapan saja.

## Catatan keamanan

- Password akun di-hash pakai bcrypt di database — bukan teks polos.
- Login pakai token (JWT) tersimpan di browser masing-masing device.
- Batas jam hadir dihitung dari jam **server**, bukan jam HP pengurus.
- Ganti `JWT_SECRET` dan jaga `TURSO_AUTH_TOKEN` tetap rahasia — jangan pernah commit file `.env` ke GitHub publik.

## Struktur folder

```
server.js   -> server Express + semua endpoint API
db.js       -> koneksi & skema database Turso + data awal (seed)
public/     -> frontend (HTML/CSS/JS statis)
  index.html
  style.css
  app.js
  assets/logo.png
.env.example -> contoh isi file .env (Turso, JWT secret, dll)
```
