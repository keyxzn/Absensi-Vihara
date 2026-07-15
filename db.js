const { createClient } = require("@libsql/client");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error(
    "TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN belum diisi di file .env.\n" +
    "Lihat README.md bagian 'Membuat database Turso gratis' untuk cara mendapatkannya."
  );
  process.exit(1);
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

function rowsToObjects(result) {
  return result.rows.map((row) => {
    const obj = {};
    result.columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}
async function all(sql, args = []) {
  const r = await client.execute({ sql, args });
  return rowsToObjects(r);
}
async function get(sql, args = []) {
  const rows = await all(sql, args);
  return rows[0];
}
async function run(sql, args = []) {
  return client.execute({ sql, args });
}

async function init() {
  // node:sqlite dan better-sqlite3 mendukung banyak statement sekaligus lewat exec(),
  // libSQL memakai executeMultiple() untuk hal yang sama.
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      nama TEXT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','pengurus')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      nama TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      kelas_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
      ortu TEXT,
      tanggal_lahir TEXT,
      gender TEXT,
      alamat TEXT,
      barcode_value TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      tanggal TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('aktif','ditutup'))
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      waktu TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('hadir','terlambat')),
      UNIQUE(session_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS pengurus (
      id TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      tempat_lahir TEXT,
      tanggal_lahir TEXT,
      kelas_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
      alamat TEXT,
      no_hp TEXT,
      barcode_value TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pengurus_attendance (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      pengurus_id TEXT NOT NULL REFERENCES pengurus(id) ON DELETE CASCADE,
      waktu TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('hadir','terlambat')),
      UNIQUE(session_id, pengurus_id)
    );

    CREATE TABLE IF NOT EXISTS login_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      waktu TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      device TEXT,
      lokasi TEXT
    );
  `);

  const userCount = (await get("SELECT COUNT(*) c FROM users")).c;
  if (userCount === 0) {
    const id = crypto.randomUUID();
    const hash = bcrypt.hashSync("admin123", 10);
    await run("INSERT INTO users (id, nama, username, password_hash, role) VALUES (?,?,?,?,?)",
      [id, "Admin", "admin", hash, "admin"]);
    console.log('Akun admin default dibuat -> username: "admin", password: "admin123" (segera ganti setelah login pertama)');
  }

  const classCount = (await get("SELECT COUNT(*) c FROM classes")).c;
  if (classCount === 0) {
    const defaults = ["Belum Sekolah – Kelas 1", "Kelas 2 – 4", "Kelas 5 – SMP"];
    for (const nama of defaults) {
      await run("INSERT INTO classes (id, nama) VALUES (?,?)", [crypto.randomUUID(), nama]);
    }
  }

  const cutoffRow = await get("SELECT 1 x FROM settings WHERE key='cutoffTime'");
  if (!cutoffRow) {
    await run("INSERT INTO settings (key, value) VALUES ('cutoffTime','10:00')");
  }

  // Migrasi ringan: tambah kolom baru ke database yang sudah lama dibuat sebelum
  // fitur tanggal lahir & gender ada, supaya data lama tidak perlu dihapus/dibuat ulang.
  const studentCols = (await all("PRAGMA table_info(students)")).map((c) => c.name);
  if (!studentCols.includes("tanggal_lahir")) {
    await run("ALTER TABLE students ADD COLUMN tanggal_lahir TEXT");
  }
  if (!studentCols.includes("gender")) {
    await run("ALTER TABLE students ADD COLUMN gender TEXT");
  }
  if (!studentCols.includes("alamat")) {
    await run("ALTER TABLE students ADD COLUMN alamat TEXT");
  }
}

module.exports = { run, get, all, init, client };