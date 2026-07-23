require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const path = require("path");
const db = require("./db");

const app = express();
app.set("trust proxy", true);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-ganti-saat-production";
const TZ = process.env.TZ || "Asia/Jakarta";

app.use(cors());
app.use(express.json({ limit: "3mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- AUTH HELPERS ---------------- */
function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Belum login." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Sesi login tidak valid, silakan masuk kembali." });
  }
}
function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ error: "Tidak punya akses untuk aksi ini." });
    next();
  };
}
function requireAnyRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Tidak punya akses untuk aksi ini." });
    next();
  };
}
function wrap(fn) {
  // Bungkus handler async supaya error (termasuk error dari database) tidak membuat server crash,
  // tapi dikirim balik sebagai respons JSON 500 yang rapi.
  return (req, res) => fn(req, res).catch((e) => {
    console.error(e);
    res.status(500).json({ error: "Terjadi kesalahan di server." });
  });
}
function nowInTZ() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(new Date());
  const h = Number(parts.find(p => p.type === "hour").value);
  const m = Number(parts.find(p => p.type === "minute").value);
  return { h, m, minutes: h * 60 + m };
}
function todayInTZ() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}
function parseUserAgent(ua) {
  if (!ua) return "Tidak diketahui";
  let os = "Perangkat lain";
  if (/iPhone/i.test(ua)) os = "iPhone";
  else if (/iPad/i.test(ua)) os = "iPad";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows/i.test(ua)) os = "Windows PC";
  else if (/Macintosh|Mac OS/i.test(ua)) os = "Mac";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "browser lain";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\//i.test(ua)) browser = "Opera";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";

  return `${os} · ${browser}`;
}
async function lookupLocation(ip) {
  if (!ip) return "Tidak diketahui";
  const clean = ip.replace("::ffff:", "").split(",")[0].trim();
  if (!clean || clean === "::1" || clean === "127.0.0.1" || clean.startsWith("192.168.") || clean.startsWith("10.") || clean.startsWith("172.")) {
    return "Jaringan lokal (development)";
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const r = await fetch(`http://ip-api.com/json/${clean}?fields=status,city,regionName,country`, { signal: controller.signal });
    clearTimeout(timer);
    const data = await r.json();
    if (data.status === "success") {
      return [data.city, data.regionName, data.country].filter(Boolean).join(", ") || "Tidak diketahui";
    }
  } catch (e) { /* geolocation gagal/timeout, jangan sampai mengganggu proses login */ }
  return "Tidak diketahui";
}

/* ---------------- AUTH ROUTES ---------------- */
app.post("/api/auth/login", wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username dan password wajib diisi." });
  const user = await db.get("SELECT * FROM users WHERE username = ?", [username.trim()]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Username atau password salah." });
  }
  const payload = { id: user.id, username: user.username, nama: user.nama, role: user.role };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });

  // Catat riwayat login. Dibungkus try/catch supaya kalau pencatatan gagal
  // (mis. lookup lokasi timeout), proses login tetap berhasil.
  try {
    const ip = req.ip || (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
    const ua = req.headers["user-agent"] || "";
    const device = parseUserAgent(ua);
    const lokasi = await lookupLocation(ip);
    await db.run("INSERT INTO login_history (id, user_id, waktu, ip, user_agent, device, lokasi) VALUES (?,?,?,?,?,?,?)",
      [crypto.randomUUID(), user.id, new Date().toISOString(), ip, ua, device, lokasi]);
  } catch (e) { console.error("Gagal mencatat riwayat login:", e); }

  res.json({ token, user: payload });
}));

app.get("/api/auth/me", authRequired, wrap(async (req, res) => {
  const user = await db.get("SELECT id, nama, username, role FROM users WHERE id = ?", [req.user.id]);
  if (!user) return res.status(401).json({ error: "Akun tidak ditemukan." });
  res.json({ user });
}));

app.put("/api/auth/password", authRequired, requireRole("admin"), wrap(async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!bcrypt.compareSync(oldPassword || "", user.password_hash)) {
    return res.status(400).json({ error: "Password lama salah." });
  }
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: "Password baru minimal 4 karakter." });
  const hash = bcrypt.hashSync(newPassword, 10);
  await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, user.id]);
  res.json({ ok: true });
}));

/* ---------------- USERS (admin only) ---------------- */
app.get("/api/users", authRequired, requireRole("admin"), wrap(async (req, res) => {
  const users = await db.all("SELECT id, nama, username, role FROM users ORDER BY role, nama");
  res.json({ users });
}));
app.post("/api/users", authRequired, requireRole("admin"), wrap(async (req, res) => {
  const { nama, username, password, role } = req.body || {};
  if (!username || !password || !role) return res.status(400).json({ error: "Username, password, dan peran wajib diisi." });
  if (!["admin", "pengurus"].includes(role)) return res.status(400).json({ error: "Peran tidak valid." });
  const dupe = await db.get("SELECT 1 x FROM users WHERE username = ?", [username.trim()]);
  if (dupe) return res.status(400).json({ error: "Username sudah dipakai." });
  const id = crypto.randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  await db.run("INSERT INTO users (id, nama, username, password_hash, role) VALUES (?,?,?,?,?)",
    [id, nama || "", username.trim(), hash, role]);
  res.json({ ok: true, id });
}));
app.put("/api/users/:id", authRequired, requireRole("admin"), wrap(async (req, res) => {
  const { nama, username, password, role } = req.body || {};
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "Akun tidak ditemukan." });
  if (username) {
    const dupe = await db.get("SELECT 1 x FROM users WHERE username = ? AND id != ?", [username.trim(), req.params.id]);
    if (dupe) return res.status(400).json({ error: "Username sudah dipakai." });
  }
  const newRole = role && ["admin", "pengurus"].includes(role) ? role : user.role;
  if (user.role === "admin" && newRole !== "admin") {
    const adminCount = (await db.get("SELECT COUNT(*) c FROM users WHERE role='admin'")).c;
    if (adminCount <= 1) return res.status(400).json({ error: "Harus ada minimal satu akun admin." });
  }
  const hash = password ? bcrypt.hashSync(password, 10) : user.password_hash;
  await db.run("UPDATE users SET nama=?, username=?, password_hash=?, role=? WHERE id=?",
    [nama ?? user.nama, username ? username.trim() : user.username, hash, newRole, req.params.id]);
  res.json({ ok: true });
}));
app.delete("/api/users/:id", authRequired, requireRole("admin"), wrap(async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "Tidak bisa menghapus akun yang sedang digunakan." });
  const target = await db.get("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!target) return res.status(404).json({ error: "Akun tidak ditemukan." });
  if (target.role === "admin") {
    const adminCount = (await db.get("SELECT COUNT(*) c FROM users WHERE role='admin'")).c;
    if (adminCount <= 1) return res.status(400).json({ error: "Harus ada minimal satu akun admin." });
  }
  await db.run("DELETE FROM users WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

/* ---------------- CLASSES (pengurus) ---------------- */
app.get("/api/classes", authRequired, wrap(async (req, res) => {
  res.json({ classes: await db.all("SELECT * FROM classes ORDER BY nama") });
}));
app.post("/api/classes", authRequired, requireAnyRole("pengurus","admin"), wrap(async (req, res) => {
  const { nama, tipe } = req.body || {};
  if (!nama) return res.status(400).json({ error: "Nama kelas wajib diisi." });
  const finalTipe = ["siswa", "pengurus"].includes(tipe) ? tipe : "siswa";
  const id = crypto.randomUUID();
  await db.run("INSERT INTO classes (id, nama, tipe) VALUES (?,?,?)", [id, nama.trim(), finalTipe]);
  res.json({ ok: true, id });
}));
app.put("/api/classes/:id", authRequired, requireAnyRole("pengurus","admin"), wrap(async (req, res) => {
  const { nama, tipe } = req.body || {};
  if (!nama) return res.status(400).json({ error: "Nama kelas wajib diisi." });
  const c = await db.get("SELECT * FROM classes WHERE id=?", [req.params.id]);
  if (!c) return res.status(404).json({ error: "Kelas tidak ditemukan." });
  const finalTipe = ["siswa", "pengurus"].includes(tipe) ? tipe : c.tipe;
  await db.run("UPDATE classes SET nama=?, tipe=? WHERE id=?", [nama.trim(), finalTipe, req.params.id]);
  res.json({ ok: true });
}));
app.delete("/api/classes/:id", authRequired, requireAnyRole("pengurus","admin"), wrap(async (req, res) => {
  const inUse = (await db.get("SELECT COUNT(*) c FROM students WHERE kelas_id=?", [req.params.id])).c;
  if (inUse > 0) return res.status(400).json({ error: "Tidak bisa hapus, masih ada siswa di kelas ini." });
  const inUsePengurus = (await db.get("SELECT COUNT(*) c FROM pengurus WHERE kelas_id=?", [req.params.id])).c;
  if (inUsePengurus > 0) return res.status(400).json({ error: "Tidak bisa hapus, masih ada pengurus yang mengampu kelas ini." });
  await db.run("DELETE FROM classes WHERE id=?", [req.params.id]);
  res.json({ ok: true });
}));

/* ---------------- STUDENTS (pengurus) ---------------- */
app.get("/api/students", authRequired, wrap(async (req, res) => {
  res.json({ students: await db.all("SELECT * FROM students ORDER BY nama") });
}));
app.post("/api/students", authRequired, requireRole("pengurus"), wrap(async (req, res) => {
  const { nama, kelasId, ortu, tanggalLahir, gender, alamat, foto, fotoPosisi } = req.body || {};
  if (!nama) return res.status(400).json({ error: "Nama siswa wajib diisi." });
  if (gender && !["L", "P"].includes(gender)) return res.status(400).json({ error: "Gender tidak valid." });
  const dupe = await db.get("SELECT 1 x FROM students WHERE LOWER(TRIM(nama)) = LOWER(TRIM(?))", [nama]);
  if (dupe) return res.status(400).json({ error: `Nama "${nama.trim()}" sudah terdaftar. Kalau memang ada 2 anak dengan nama sama, tambahkan pembeda (mis. nama panggilan/inisial belakang).` });
  const id = crypto.randomUUID();
  const barcodeValue = "SMB-" + crypto.randomBytes(4).toString("hex").toUpperCase();
  await db.run("INSERT INTO students (id, nama, kelas_id, ortu, tanggal_lahir, gender, alamat, foto, foto_posisi, barcode_value) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, nama.trim(), kelasId || null, ortu || "", tanggalLahir || null, gender || null, alamat || "", foto || null, fotoPosisi || "center", barcodeValue]);
  res.json({ ok: true, id, barcodeValue });
}));
app.put("/api/students/:id", authRequired, requireRole("pengurus"), wrap(async (req, res) => {
  const { nama, kelasId, ortu, tanggalLahir, gender, alamat, foto, fotoPosisi } = req.body || {};
  const s = await db.get("SELECT * FROM students WHERE id=?", [req.params.id]);
  if (!s) return res.status(404).json({ error: "Siswa tidak ditemukan." });
  if (gender && !["L", "P"].includes(gender)) return res.status(400).json({ error: "Gender tidak valid." });
  if (nama) {
    const dupe = await db.get("SELECT 1 x FROM students WHERE LOWER(TRIM(nama)) = LOWER(TRIM(?)) AND id != ?", [nama, req.params.id]);
    if (dupe) return res.status(400).json({ error: `Nama "${nama.trim()}" sudah terdaftar. Kalau memang ada 2 anak dengan nama sama, tambahkan pembeda (mis. nama panggilan/inisial belakang).` });
  }
  await db.run("UPDATE students SET nama=?, kelas_id=?, ortu=?, tanggal_lahir=?, gender=?, alamat=?, foto=?, foto_posisi=? WHERE id=?",
    [nama ?? s.nama, kelasId ?? s.kelas_id, ortu ?? s.ortu, tanggalLahir ?? s.tanggal_lahir, gender ?? s.gender, alamat ?? s.alamat, foto !== undefined ? foto : s.foto, fotoPosisi ?? s.foto_posisi, req.params.id]);
  res.json({ ok: true });
}));
app.get("/api/students/csv", authRequired, wrap(async (req, res) => {
  const students = await db.all(`
    SELECT s.*, c.nama as kelas_nama FROM students s
    LEFT JOIN classes c ON c.id = s.kelas_id ORDER BY s.nama
  `);
  const rows = [["Nama", "Kelas", "Gender", "Tanggal Lahir", "Alamat", "Kontak Orang Tua", "Kode Unik"]];
  students.forEach(s => {
    rows.push([
      s.nama, s.kelas_nama || "-", s.gender === "L" ? "Laki-laki" : s.gender === "P" ? "Perempuan" : "-",
      s.tanggal_lahir || "-", s.alamat || "-", s.ortu || "-", s.barcode_value
    ]);
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=data-siswa.csv");
  res.send("\uFEFF" + csv);
}));
app.delete("/api/students/:id", authRequired, requireRole("pengurus"), wrap(async (req, res) => {
  await db.run("DELETE FROM students WHERE id=?", [req.params.id]);
  res.json({ ok: true });
}));

/* ---------------- SESSIONS (pengurus) ---------------- */
app.get("/api/sessions", authRequired, wrap(async (req, res) => {
  res.json({ sessions: await db.all("SELECT * FROM sessions ORDER BY tanggal DESC") });
}));
app.post("/api/sessions", authRequired, requireAnyRole("pengurus","admin"), wrap(async (req, res) => {
  const today = todayInTZ();
  const already = await db.get("SELECT 1 x FROM sessions WHERE tanggal=? AND status='aktif'", [today]);
  if (already) return res.status(400).json({ error: "Sesi hari ini sudah aktif." });
  await db.run("UPDATE sessions SET status='ditutup' WHERE status='aktif'");
  const id = crypto.randomUUID();
  await db.run("INSERT INTO sessions (id, tanggal, status) VALUES (?,?,'aktif')", [id, today]);
  res.json({ ok: true, id, tanggal: today });
}));
app.put("/api/sessions/:id/tutup", authRequired, requireAnyRole("pengurus","admin"), wrap(async (req, res) => {
  await db.run("UPDATE sessions SET status='ditutup' WHERE id=?", [req.params.id]);
  res.json({ ok: true });
}));
app.put("/api/sessions/:id/buka", authRequired, requireAnyRole("pengurus","admin"), wrap(async (req, res) => {
  await db.run("UPDATE sessions SET status='ditutup' WHERE status='aktif'");
  await db.run("UPDATE sessions SET status='aktif' WHERE id=?", [req.params.id]);
  res.json({ ok: true });
}));
app.delete("/api/sessions/:id", authRequired, requireAnyRole("pengurus","admin"), wrap(async (req, res) => {
  await db.run("DELETE FROM sessions WHERE id=?", [req.params.id]);
  res.json({ ok: true });
}));
app.get("/api/sessions/:id/attendance", authRequired, wrap(async (req, res) => {
  const rows = await db.all(`
    SELECT a.*, s.nama as siswa_nama, s.kelas_id
    FROM attendance a JOIN students s ON s.id = a.student_id
    WHERE a.session_id = ? ORDER BY a.waktu ASC
  `, [req.params.id]);
  res.json({ attendance: rows });
}));

/* ---------------- SETTINGS (pengurus) ---------------- */
app.get("/api/branding", wrap(async (req, res) => {
  const nama = await db.get("SELECT value FROM settings WHERE key='namaSekolah'");
  const logo = await db.get("SELECT value FROM settings WHERE key='logo'");
  res.json({ namaSekolah: nama ? nama.value : "SMB Naga Putta", logo: logo ? logo.value : null });
}));
app.put("/api/branding", authRequired, requireRole("admin"), wrap(async (req, res) => {
  const { namaSekolah, logo } = req.body || {};
  if (namaSekolah !== undefined) {
    if (!namaSekolah.trim()) return res.status(400).json({ error: "Nama sekolah tidak boleh kosong." });
    await db.run("INSERT INTO settings (key, value) VALUES ('namaSekolah', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [namaSekolah.trim()]);
  }
  if (logo !== undefined) {
    await db.run("INSERT INTO settings (key, value) VALUES ('logo', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [logo]);
  }
  res.json({ ok: true });
}));

app.get("/api/settings", authRequired, wrap(async (req, res) => {
  const row = await db.get("SELECT value FROM settings WHERE key='cutoffTime'");
  res.json({ cutoffTime: row ? row.value : "10:00" });
}));
app.put("/api/settings", authRequired, requireAnyRole("pengurus","admin"), wrap(async (req, res) => {
  const { cutoffTime } = req.body || {};
  if (!/^\d{2}:\d{2}$/.test(cutoffTime || "")) return res.status(400).json({ error: "Format jam tidak valid." });
  await db.run("INSERT INTO settings (key, value) VALUES ('cutoffTime', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [cutoffTime]);
  res.json({ ok: true });
}));

/* ---------------- SCAN / ATTENDANCE (pengurus) ---------------- */
app.post("/api/attendance/scan", authRequired, requireRole("pengurus"), wrap(async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: "Kode kosong." });
  const session = await db.get("SELECT * FROM sessions WHERE status='aktif'");
  if (!session) return res.status(400).json({ error: "Tidak ada sesi aktif." });
  const student = await db.get("SELECT * FROM students WHERE barcode_value=?", [code.trim()]);
  if (!student) return res.status(404).json({ error: "Kode tidak dikenali.", kind: "unknown" });
  const already = await db.get("SELECT * FROM attendance WHERE session_id=? AND student_id=?", [session.id, student.id]);
  if (already) return res.status(409).json({ error: `${student.nama} sudah tercatat.`, kind: "duplicate", student, waktu: already.waktu, status: already.status });

  const cutoffRow = await db.get("SELECT value FROM settings WHERE key='cutoffTime'");
  const cutoff = (cutoffRow ? cutoffRow.value : "10:00").split(":").map(Number);
  const cutoffMinutes = cutoff[0] * 60 + cutoff[1];
  const now = nowInTZ();
  const status = now.minutes <= cutoffMinutes ? "hadir" : "terlambat";

  const id = crypto.randomUUID();
  const waktuIso = new Date().toISOString();
  await db.run("INSERT INTO attendance (id, session_id, student_id, waktu, status) VALUES (?,?,?,?,?)",
    [id, session.id, student.id, waktuIso, status]);
  res.json({ ok: true, student, status, waktu: waktuIso, cutoffTime: cutoffRow ? cutoffRow.value : "10:00" });
}));

/* ---------------- REKAP (pengurus) ---------------- */
app.get("/api/rekap", authRequired, wrap(async (req, res) => {
  const kelasId = req.query.kelasId || null;
  const totalSesi = (await db.get("SELECT COUNT(*) c FROM sessions")).c;
  const students = kelasId
    ? await db.all("SELECT * FROM students WHERE kelas_id=? ORDER BY nama", [kelasId])
    : await db.all("SELECT * FROM students ORDER BY nama");
  const result = [];
  for (const s of students) {
    const hadir = (await db.get("SELECT COUNT(*) c FROM attendance WHERE student_id=? AND status='hadir'", [s.id])).c;
    const telat = (await db.get("SELECT COUNT(*) c FROM attendance WHERE student_id=? AND status='terlambat'", [s.id])).c;
    const pct = totalSesi ? Math.round((hadir / totalSesi) * 100) : 0;
    result.push({ ...s, hadir, terlambat: telat, totalSesi, persentase: pct });
  }
  result.sort((a, b) => b.persentase - a.persentase || a.nama.localeCompare(b.nama));
  res.json({ rekap: result, totalSesi });
}));

app.get("/api/rekap/csv", authRequired, wrap(async (req, res) => {
  const kelasId = req.query.kelasId || null;
  const totalSesi = (await db.get("SELECT COUNT(*) c FROM sessions")).c;
  const students = kelasId
    ? await db.all("SELECT s.*, c.nama as kelas_nama FROM students s LEFT JOIN classes c ON c.id=s.kelas_id WHERE s.kelas_id=? ORDER BY s.nama", [kelasId])
    : await db.all("SELECT s.*, c.nama as kelas_nama FROM students s LEFT JOIN classes c ON c.id=s.kelas_id ORDER BY s.nama");
  const rows = [["Nama", "Kelas", "Hadir", "Terlambat/Tidak Hadir", "Total Sesi", "Persentase"]];
  for (const s of students) {
    const hadir = (await db.get("SELECT COUNT(*) c FROM attendance WHERE student_id=? AND status='hadir'", [s.id])).c;
    const telat = (await db.get("SELECT COUNT(*) c FROM attendance WHERE student_id=? AND status='terlambat'", [s.id])).c;
    const pct = totalSesi ? Math.round((hadir / totalSesi) * 100) : 0;
    rows.push([s.nama, s.kelas_nama || "-", hadir, telat, totalSesi, pct + "%"]);
  }
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=rekap-absensi.csv");
  res.send("\uFEFF" + csv);
}));

/* ---------------- BACKUP LENGKAP (admin only) ---------------- */
app.get("/api/backup", authRequired, requireRole("admin"), wrap(async (req, res) => {
  const [users, classes, students, sessions, attendance, pengurus, pengurusAttendance, settings] = await Promise.all([
    db.all("SELECT id, nama, username, role, created_at FROM users"), // password_hash sengaja tidak diikutkan
    db.all("SELECT * FROM classes"),
    db.all("SELECT * FROM students"),
    db.all("SELECT * FROM sessions"),
    db.all("SELECT * FROM attendance"),
    db.all("SELECT * FROM pengurus"),
    db.all("SELECT * FROM pengurus_attendance"),
    db.all("SELECT * FROM settings")
  ]);
  const backup = {
    exported_at: new Date().toISOString(),
    catatan: "Backup ini tidak berisi password akun demi keamanan. Kalau perlu restore, akun harus login pakai reset password.",
    users, classes, students, sessions, attendance, pengurus, pengurus_attendance: pengurusAttendance, settings
  };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=backup-smb-naga-putta-${todayInTZ()}.json`);
  res.send(JSON.stringify(backup, null, 2));
}));

/* ---------------- RIWAYAT LOGIN (admin only) ---------------- */
app.get("/api/login-history", authRequired, requireRole("admin"), wrap(async (req, res) => {
  const rows = await db.all(`
    SELECT h.*, u.username, u.nama, u.role FROM login_history h
    JOIN users u ON u.id = h.user_id
    ORDER BY h.waktu DESC LIMIT 300
  `);
  res.json({ history: rows });
}));
app.delete("/api/login-history", authRequired, requireRole("admin"), wrap(async (req, res) => {
  await db.run("DELETE FROM login_history");
  res.json({ ok: true });
}));

/* ---------------- PENGURUS: data & absensi (admin only) ---------------- */
app.get("/api/pengurus", authRequired, requireRole("admin"), wrap(async (req, res) => {
  res.json({ pengurus: await db.all("SELECT * FROM pengurus ORDER BY nama") });
}));
app.post("/api/pengurus", authRequired, requireRole("admin"), wrap(async (req, res) => {
  const { nama, tempatLahir, tanggalLahir, kelasId, alamat, noHp, foto, fotoPosisi } = req.body || {};
  if (!nama) return res.status(400).json({ error: "Nama pengurus wajib diisi." });
  const dupe = await db.get("SELECT 1 x FROM pengurus WHERE LOWER(TRIM(nama)) = LOWER(TRIM(?))", [nama]);
  if (dupe) return res.status(400).json({ error: `Nama "${nama.trim()}" sudah terdaftar sebagai pengurus.` });
  const id = crypto.randomUUID();
  const barcodeValue = "PGR-" + crypto.randomBytes(4).toString("hex").toUpperCase();
  await db.run("INSERT INTO pengurus (id, nama, tempat_lahir, tanggal_lahir, kelas_id, alamat, no_hp, foto, foto_posisi, barcode_value) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, nama.trim(), tempatLahir || "", tanggalLahir || null, kelasId || null, alamat || "", noHp || "", foto || null, fotoPosisi || "center", barcodeValue]);
  res.json({ ok: true, id, barcodeValue });
}));
app.put("/api/pengurus/:id", authRequired, requireRole("admin"), wrap(async (req, res) => {
  const { nama, tempatLahir, tanggalLahir, kelasId, alamat, noHp, foto, fotoPosisi } = req.body || {};
  const p = await db.get("SELECT * FROM pengurus WHERE id=?", [req.params.id]);
  if (!p) return res.status(404).json({ error: "Pengurus tidak ditemukan." });
  if (nama) {
    const dupe = await db.get("SELECT 1 x FROM pengurus WHERE LOWER(TRIM(nama)) = LOWER(TRIM(?)) AND id != ?", [nama, req.params.id]);
    if (dupe) return res.status(400).json({ error: `Nama "${nama.trim()}" sudah terdaftar sebagai pengurus.` });
  }
  await db.run("UPDATE pengurus SET nama=?, tempat_lahir=?, tanggal_lahir=?, kelas_id=?, alamat=?, no_hp=?, foto=?, foto_posisi=? WHERE id=?",
    [nama ?? p.nama, tempatLahir ?? p.tempat_lahir, tanggalLahir ?? p.tanggal_lahir, kelasId ?? p.kelas_id, alamat ?? p.alamat, noHp ?? p.no_hp, foto !== undefined ? foto : p.foto, fotoPosisi ?? p.foto_posisi, req.params.id]);
  res.json({ ok: true });
}));
app.delete("/api/pengurus/:id", authRequired, requireRole("admin"), wrap(async (req, res) => {
  await db.run("DELETE FROM pengurus WHERE id=?", [req.params.id]);
  res.json({ ok: true });
}));
app.get("/api/pengurus/csv", authRequired, requireRole("admin"), wrap(async (req, res) => {
  const rows2 = await db.all(`
    SELECT p.*, c.nama as kelas_nama FROM pengurus p
    LEFT JOIN classes c ON c.id = p.kelas_id ORDER BY p.nama
  `);
  const rows = [["Nama", "Tempat Lahir", "Tanggal Lahir", "Kelas", "Alamat", "No HP", "Kode Unik"]];
  rows2.forEach(p => rows.push([p.nama, p.tempat_lahir || "-", p.tanggal_lahir || "-", p.kelas_nama || "-", p.alamat || "-", p.no_hp || "-", p.barcode_value]));
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=data-pengurus.csv");
  res.send("\uFEFF" + csv);
}));

app.post("/api/pengurus-attendance/scan", authRequired, requireRole("admin"), wrap(async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: "Kode kosong." });
  const session = await db.get("SELECT * FROM sessions WHERE status='aktif'");
  if (!session) return res.status(400).json({ error: "Tidak ada sesi aktif. Minta pengurus membuka sesi hari ini dulu." });
  const pengurus = await db.get("SELECT * FROM pengurus WHERE barcode_value=?", [code.trim()]);
  if (!pengurus) return res.status(404).json({ error: "Kode tidak dikenali.", kind: "unknown" });
  const already = await db.get("SELECT * FROM pengurus_attendance WHERE session_id=? AND pengurus_id=?", [session.id, pengurus.id]);
  if (already) return res.status(409).json({ error: `${pengurus.nama} sudah tercatat.`, kind: "duplicate", pengurus, waktu: already.waktu, status: already.status });

  const cutoffRow = await db.get("SELECT value FROM settings WHERE key='cutoffTime'");
  const cutoff = (cutoffRow ? cutoffRow.value : "10:00").split(":").map(Number);
  const cutoffMinutes = cutoff[0] * 60 + cutoff[1];
  const now = nowInTZ();
  const status = now.minutes <= cutoffMinutes ? "hadir" : "terlambat";

  const id = crypto.randomUUID();
  const waktuIso = new Date().toISOString();
  await db.run("INSERT INTO pengurus_attendance (id, session_id, pengurus_id, waktu, status) VALUES (?,?,?,?,?)",
    [id, session.id, pengurus.id, waktuIso, status]);
  res.json({ ok: true, pengurus, status, waktu: waktuIso, cutoffTime: cutoffRow ? cutoffRow.value : "10:00" });
}));
app.get("/api/sessions/:id/pengurus-attendance", authRequired, requireRole("admin"), wrap(async (req, res) => {
  const rows = await db.all(`
    SELECT a.*, p.nama as pengurus_nama FROM pengurus_attendance a
    JOIN pengurus p ON p.id = a.pengurus_id WHERE a.session_id = ? ORDER BY a.waktu ASC
  `, [req.params.id]);
  res.json({ attendance: rows });
}));

app.get("/api/pengurus-rekap", authRequired, requireRole("admin"), wrap(async (req, res) => {
  const totalSesi = (await db.get("SELECT COUNT(*) c FROM sessions")).c;
  const list = await db.all("SELECT * FROM pengurus ORDER BY nama");
  const result = [];
  for (const p of list) {
    const hadir = (await db.get("SELECT COUNT(*) c FROM pengurus_attendance WHERE pengurus_id=? AND status='hadir'", [p.id])).c;
    const telat = (await db.get("SELECT COUNT(*) c FROM pengurus_attendance WHERE pengurus_id=? AND status='terlambat'", [p.id])).c;
    const pct = totalSesi ? Math.round((hadir / totalSesi) * 100) : 0;
    result.push({ ...p, hadir, terlambat: telat, totalSesi, persentase: pct });
  }
  result.sort((a, b) => b.persentase - a.persentase || a.nama.localeCompare(b.nama));
  res.json({ rekap: result, totalSesi });
}));
app.get("/api/pengurus-rekap/csv", authRequired, requireRole("admin"), wrap(async (req, res) => {
  const totalSesi = (await db.get("SELECT COUNT(*) c FROM sessions")).c;
  const list = await db.all("SELECT * FROM pengurus ORDER BY nama");
  const rows = [["Nama", "Hadir", "Terlambat/Tidak Hadir", "Total Sesi", "Persentase"]];
  for (const p of list) {
    const hadir = (await db.get("SELECT COUNT(*) c FROM pengurus_attendance WHERE pengurus_id=? AND status='hadir'", [p.id])).c;
    const telat = (await db.get("SELECT COUNT(*) c FROM pengurus_attendance WHERE pengurus_id=? AND status='terlambat'", [p.id])).c;
    const pct = totalSesi ? Math.round((hadir / totalSesi) * 100) : 0;
    rows.push([p.nama, hadir, telat, totalSesi, pct + "%"]);
  }
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=rekap-pengurus.csv");
  res.send("\uFEFF" + csv);
}));

/* ---------------- SPA fallback ---------------- */
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await db.init();
    app.listen(PORT, () => console.log(`Absensi SMB Naga Putta jalan di port ${PORT}`));
  } catch (e) {
    console.error("Gagal konek ke database Turso. Cek TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN di .env.");
    console.error(e);
    process.exit(1);
  }
})();