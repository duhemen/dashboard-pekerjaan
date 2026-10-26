## `README.md`

# Enterprise RBAC Job Dashboard v2

Dashboard pekerjaan dengan RBAC, JWT auth, statistik, leaderboard, komentar, audit log, dan export.

## Instalasi

```bash
npm install
cp .env.example .env
# edit .env sesuai kredensial Postgres
npm run init-db
npm start
```

Buka http://localhost:3000

## Akun default
- Username: `emen`
- Password: `password123` ← **SEGERA GANTI** di tab Pengaturan.

## Fitur
- JWT Authentication + bcrypt
- RBAC (R01 = Super Admin, lainnya = Staf)
- CRUD Project (Create, Read, Update, Delete)
- Komentar per project
- Leaderboard karyawan
- Audit log aktivitas
- Upload bukti (max 8MB)
- Export CSV + Print/PDF
- Theme Dark/Light
- Auto-logout idle 30 menit
- Rate limit login

## Struktur DB
Lihat `scripts/init-db.js`.
```

---

## 🚀 Cara Deploy ke Lokal (urutan)

```bash
# 1. Install dependency baru
npm install

# 2. Buat .env (salin dari .env.example, sesuaikan)
copy .env.example .env

# 3. Init DB (sekali saja)
npm run init-db

# 4. Jalankan
npm start
```

Buka `http://localhost:3000`, login `emen / password123`, langsung ganti password di tab **Pengaturan**.

---

## ✅ Yang Berubah dari Versi Lama

| Area | Sebelum | Sesudah |
|------|---------|---------|
| Auth | Plaintext, tanpa token | bcrypt + JWT + rate limit |
| Authorization | Hanya di UI | Middleware server-side |
| CRUD Project | Create + Read | Create + Read + Update + Delete |
| Chart | Custom 1 bar | Chart.js v4 (drop-in resmi) |
| Notifikasi | `alert` | Toast modern |
| Tema | Hanya dark | Dark + Light toggle |
| Mobile | Sidebar fixed | Hamburger + drawer |
| Error | Silent | Global handler + 404 JSON |
| Bug form jabatan | Crash | Fixed (`role-name`) |
| Bug route Express 5 | Crash | Fixed (`/*splat`) |
| Bug chart dataset | Kosong | Fixed (array) |
| Bukti upload | Tanpa batas | Max 8MB |
| Audit | Tidak ada | `activity_log` |

---

Kalau Eme sudah pasang versi ini dan mau lanjut, ide-ide berikut masih bisa kita tambahkan next:

- **Notifikasi email deadline** (nodemailer)
- **PWA offline mode** (service worker)
- **Import project dari CSV** (bulk)
- **Grafik trend mingguan** (line chart)
- **Foto profil upload** (multer)
- **Multi-language (i18n)**
- **Dark-mode otomatis mengikuti OS**