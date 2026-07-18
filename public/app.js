/* ================= STATE ================= */
let token = localStorage.getItem("smb_token") || null;
let currentUser = null;
let classesCache = [];
let studentsCache = [];
let qrScanner = null;
let lastScanCode = null, lastScanAt = 0;
let scanFeedItems = [];

/* ================= ICONS & EMPTY STATES ================= */
const ICONS = {
  users: '<path d="M12 8a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path d="M5 19c0-3.8 3-6.5 7-6.5s7 2.7 7 6.5"/>',
  classes: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  camera: '<path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M7 12h10"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4M10 10v4M13 10v4M16 10v4"/>',
  chart: '<path d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-7"/>',
  search: '<circle cx="10" cy="10" r="6.5"/><path d="M19 19l-4.5-4.5"/>',
  accounts: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 8.5c1.8.3 3 1.7 3 3.5M17 14c1.8.4 3 1.7 3 3.5"/>',
  edit: '<path d="M14.2 3.8a1.7 1.7 0 0 1 2.4 2.4L6.5 16.3 3 17l.7-3.5 10.5-9.7Z"/>',
  trash: '<path d="M4 6h16M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M6 6l1 13.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 6"/>'
};
function icon(name, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
}
function compressImageToBase64(file, maxDim = 320, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
        else if (h >= w && h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Gagal membaca gambar."));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Gagal membaca file."));
    reader.readAsDataURL(file);
  });
}
function initials(nama) { return (nama || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase(); }
function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function emptyState(iconName, title, desc, actionHtml = "") {
  return `<div class="empty">
    <div class="empty-badge">${icon(iconName, 24)}</div>
    <h3>${title}</h3>
    <p>${desc}</p>
    ${actionHtml}
  </div>`;
}

/* ================= API HELPER ================= */
async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error(data.error || "Terjadi kesalahan.");
    err.data = data;
    throw err;
  }
  return data;
}

/* ================= AUTH ================= */
async function tryAutoLogin() {
  if (!token) return showLogin();
  try {
    const { user } = await api("/api/auth/me");
    currentUser = user;
    await enterApp();
  } catch (e) {
    localStorage.removeItem("smb_token"); token = null;
    showLogin();
  }
}
function showLogin() {
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("app").classList.remove("active");
}
async function doLogin() {
  const u = document.getElementById("loginUser").value.trim();
  const p = document.getElementById("loginPass").value;
  const errBox = document.getElementById("loginErr");
  errBox.style.display = "none";
  if (!u || !p) { errBox.textContent = "Isi username dan password."; errBox.style.display = "block"; return; }
  try {
    const data = await api("/api/auth/login", "POST", { username: u, password: p });
    token = data.token; localStorage.setItem("smb_token", token);
    currentUser = data.user;
    document.getElementById("loginUser").value = ""; document.getElementById("loginPass").value = "";
    await enterApp();
  } catch (e) {
    errBox.textContent = e.message; errBox.style.display = "block";
  }
}
function doLogout() {
  stopScanner();
  token = null; currentUser = null;
  localStorage.removeItem("smb_token");
  showLogin();
}
function openGantiPasswordModal() {
  openModal(`
    <h3>Ganti Password</h3>
    <div class="field"><label>Password lama</label><input id="fPassLama" type="password" placeholder="Password saat ini"></div>
    <div class="field"><label>Password baru</label><input id="fPassBaru" type="password" placeholder="Minimal 4 karakter"></div>
    <div class="field"><label>Ulangi password baru</label><input id="fPassBaru2" type="password" placeholder="Ketik ulang password baru"></div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" onclick="simpanGantiPassword()">Simpan</button>
    </div>`);
}
async function simpanGantiPassword() {
  const oldPassword = document.getElementById("fPassLama").value;
  const newPassword = document.getElementById("fPassBaru").value;
  const confirmPassword = document.getElementById("fPassBaru2").value;
  if (!oldPassword || !newPassword) { showToast("Isi semua field dulu.", "err"); return; }
  if (newPassword !== confirmPassword) { showToast("Password baru tidak sama dengan konfirmasi.", "err"); return; }
  try {
    await api("/api/auth/password", "PUT", { oldPassword, newPassword });
    closeModal();
    showToast("Password berhasil diganti.");
  } catch (e) { showToast(e.message, "err"); }
}
async function enterApp() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("app").classList.add("active");
  renderNav();
  document.getElementById("whoBox").innerHTML =
    `${esc(currentUser.nama || currentUser.username)} <span class="badge-role ${currentUser.role === "admin" ? "badge-admin" : "badge-pengurus"}">${currentUser.role}</span>`;
  goTo("ringkasan");
}

/* ================= NAV ================= */
const PAGES = [
  { key: "ringkasan", label: "Ringkasan", roles: ["pengurus", "admin"], icon: '<path d="M3 12h4v7H3zM10 7h4v12h-4zM17 3h4v16h-4z"/>' },
  { key: "scan", label: "Scan Absen", roles: ["pengurus"], icon: '<path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M7 12h10"/>' },
  { key: "siswa", label: "Data Siswa", roles: ["pengurus"], icon: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.8 3-6.5 7-6.5s7 2.7 7 6.5"/>' },
  { key: "kelas", label: "Kelas", roles: ["pengurus", "admin"], icon: '<path d="M4 6h16M4 12h16M4 18h10"/>' },
  { key: "sesi", label: "Sesi Absen", roles: ["pengurus", "admin"], icon: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>' },
  { key: "kartu", label: "Kartu Absen", roles: ["pengurus"], icon: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4M10 10v4M13 10v4M16 10v4"/>' },
  { key: "rekap", label: "Rekap", roles: ["pengurus"], icon: '<path d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-7"/>' },
  { key: "akun", label: "Kelola Akun", roles: ["admin"], icon: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 8.5c1.8.3 3 1.7 3 3.5M17 14c1.8.4 3 1.7 3 3.5"/>' },
  { key: "pengurus-data", label: "Data Pengurus", roles: ["admin"], icon: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.8 3-6.5 7-6.5s7 2.7 7 6.5"/>' },
  { key: "pengurus-scan", label: "Scan Absen Pengurus", roles: ["admin"], icon: '<path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M7 12h10"/>' },
  { key: "pengurus-kartu", label: "Kartu Absen Pengurus", roles: ["admin"], icon: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4M10 10v4M13 10v4M16 10v4"/>' },
  { key: "pengurus-rekap", label: "Rekap Pengurus", roles: ["admin"], icon: '<path d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-7"/>' },
  { key: "login-history", label: "Riwayat Login", roles: ["admin"], icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>' },
  { key: "pengaturan", label: "Pengaturan", roles: ["admin"], icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.04Z"/>' }
];
function renderNav() {
  const nav = document.getElementById("navBtns");
  const items = PAGES.filter(p => currentUser && p.roles.includes(currentUser.role));
  nav.innerHTML = items.map(p => `
    <button class="nav-btn" data-key="${p.key}" onclick="goTo('${p.key}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p.icon}</svg>
      ${p.label}
    </button>`).join("");
}
function toggleMobileNav() {
  document.getElementById("sidebar").classList.toggle("mobile-open");
  document.getElementById("navOverlay").classList.toggle("active");
}
function closeMobileNav() {
  document.getElementById("sidebar").classList.remove("mobile-open");
  document.getElementById("navOverlay").classList.remove("active");
}
async function goTo(key) {
  const def = PAGES.find(p => p.key === key);
  if (!currentUser || !def || !def.roles.includes(currentUser.role)) return;
  if (key !== "scan") stopScanner();
  closeMobileNav();
  document.querySelectorAll(".page").forEach(el => el.classList.toggle("active", el.dataset.page === key));
  document.querySelectorAll(".nav-btn").forEach(el => el.classList.toggle("active", el.dataset.key === key));
  try {
    if (key === "ringkasan") await renderRingkasan();
    if (key === "siswa") await renderSiswa();
    if (key === "kelas") await renderKelas();
    if (key === "sesi") await renderSesi();
    if (key === "scan") await renderScan();
    if (key === "kartu") await renderKartu();
    if (key === "rekap") await renderRekap();
    if (key === "akun") await renderAkun();
    if (key === "pengurus-data") await renderPengurusData();
    if (key === "pengurus-scan") await renderPengurusScan();
    if (key === "pengurus-kartu") await renderPengurusKartu();
    if (key === "pengurus-rekap") await renderPengurusRekap();
    if (key === "login-history") await renderLoginHistory();
    if (key === "pengaturan") await renderPengaturan();
  } catch (e) { showToast(e.message, "err"); }
}

/* ================= HELPERS ================= */
function kelasName(id) { const k = classesCache.find(c => c.id === id); return k ? k.nama : "—"; }
function studentById(id) { return studentsCache.find(s => s.id === id); }
function fmtDate(iso) { const d = new Date(iso + "T00:00:00"); return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }); }
function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) + ", " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}
function fmtTgl(iso) { if (!iso) return "—"; return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }); }
function hitungUmur(iso) {
  if (!iso) return null;
  const dob = new Date(iso + "T00:00:00"); const now = new Date();
  let umur = now.getFullYear() - dob.getFullYear();
  const belumUlangTahun = (now.getMonth() < dob.getMonth()) || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (belumUlangTahun) umur--;
  return umur;
}
function genderLabel(g) { return g === "L" ? "Laki-laki" : g === "P" ? "Perempuan" : "—"; }

let toastTimer;
function showToast(msg, kind) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = document.createElement("div");
  t.className = "toast" + (kind === "err" ? " err" : kind === "warn" ? " warn" : "");
  t.textContent = (kind === "err" ? "⚠️ " : kind === "warn" ? "⏰ " : "✓ ") + msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2800);
}
function closeModal() { document.getElementById("modalBg").classList.remove("active"); }
function openModal(html) { document.getElementById("modalBody").innerHTML = html; document.getElementById("modalBg").classList.add("active"); }

async function refreshClasses() { classesCache = (await api("/api/classes")).classes; return classesCache; }
async function refreshStudents() { studentsCache = (await api("/api/students")).students; return studentsCache; }
async function fillKelasSelects() {
  await refreshClasses();
  const siswaClasses = classesCache.filter(c => c.tipe !== "pengurus");
  const opts = siswaClasses.map(c => `<option value="${c.id}">${esc(c.nama)}</option>`).join("");
  const a = document.getElementById("siswaKelasFilter"); if (a) a.innerHTML = `<option value="">Semua kelas</option>${opts}`;
  const b = document.getElementById("rekapKelasFilter"); if (b) b.innerHTML = `<option value="">Semua kelas</option>${opts}`;
}

/* ================= RINGKASAN ================= */
async function renderRingkasan() {
  if (currentUser.role === "admin") { await renderRingkasanAdmin(); return; }
  await renderRingkasanPengurus();
}
function drawTrendChart(last6, counts) {
  const max = Math.max(1, ...counts);
  document.getElementById("trendChart").innerHTML = `
    <div style="display:flex;align-items:flex-end;gap:16px;height:140px;padding-top:10px;">
      ${last6.map((s, i) => {
        const cnt = counts[i]; const h = Math.max(6, Math.round((cnt / max) * 110));
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;">
          <div style="font-size:12px;font-weight:700;color:var(--maroon);">${cnt}</div>
          <div style="width:100%;max-width:38px;height:${h}px;background:linear-gradient(180deg,var(--gold),var(--maroon));border-radius:6px 6px 3px 3px;"></div>
          <div style="font-size:10.5px;color:var(--ink-soft);text-align:center;">${new Date(s.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit" })}</div>
        </div>`;
      }).join("")}
    </div>`;
}

/* ---- Ringkasan untuk Pengurus: fokus data siswa ---- */
async function renderRingkasanPengurus() {
  document.getElementById("adminExtra").innerHTML = "";
  await refreshStudents();
  const sessions = (await api("/api/sessions")).sessions.sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  const totalSesi = sessions.length;
  const sesiTerakhir = sessions[sessions.length - 1];
  let hadirTerakhir = 0;
  if (sesiTerakhir) {
    const att = (await api(`/api/sessions/${sesiTerakhir.id}/attendance`)).attendance;
    hadirTerakhir = att.filter(a => a.status === "hadir").length;
  }
  const act = sessions.find(s => s.status === "aktif");
  document.getElementById("statGrid").innerHTML = `
    <div class="stat-card"><div class="stat-icon">${icon("users")}</div><div class="num">${studentsCache.length}</div><div class="label">Siswa terdaftar</div></div>
    <div class="stat-card"><div class="stat-icon">${icon("calendar")}</div><div class="num">${totalSesi}</div><div class="label">Total sesi tercatat</div></div>
    <div class="stat-card"><div class="stat-icon">${icon("chart")}</div><div class="num">${sesiTerakhir ? hadirTerakhir : "–"}</div><div class="label">Hadir sesi terakhir</div></div>
    <div class="stat-card"><div class="stat-icon">${icon("camera")}</div><div class="num" style="color:${act ? 'var(--green)' : 'var(--clay)'}">${act ? "AKTIF" : "TUTUP"}</div><div class="label">Status sesi hari ini</div></div>
  `;
  const last6 = sessions.slice(-6);
  if (last6.length === 0) {
    document.getElementById("trendChart").innerHTML = emptyState("chart", "Belum ada tren", "Buka sesi pertama di tab Sesi Absen untuk mulai melihat grafik kehadiran.");
    return;
  }
  const counts = await Promise.all(last6.map(async s => (await api(`/api/sessions/${s.id}/attendance`)).attendance.filter(a => a.status === "hadir").length));
  drawTrendChart(last6, counts);
}

/* ---- Ringkasan untuk Admin: fokus data pengurus + aktivitas login ---- */
async function renderRingkasanAdmin() {
  document.getElementById("adminExtra").innerHTML = "";
  const [pengurusData, sessionsData] = await Promise.all([
    api("/api/pengurus").catch(() => ({ pengurus: [] })),
    api("/api/sessions")
  ]);
  const sessions = sessionsData.sessions.sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  const totalSesi = sessions.length;
  const sesiTerakhir = sessions[sessions.length - 1];
  let hadirTerakhir = 0;
  if (sesiTerakhir) {
    const att = (await api(`/api/sessions/${sesiTerakhir.id}/pengurus-attendance`)).attendance;
    hadirTerakhir = att.filter(a => a.status === "hadir").length;
  }
  const act = sessions.find(s => s.status === "aktif");
  document.getElementById("statGrid").innerHTML = `
    <div class="stat-card"><div class="stat-icon">${icon("accounts")}</div><div class="num">${pengurusData.pengurus.length}</div><div class="label">Pengurus terdaftar</div></div>
    <div class="stat-card"><div class="stat-icon">${icon("calendar")}</div><div class="num">${totalSesi}</div><div class="label">Total sesi tercatat</div></div>
    <div class="stat-card"><div class="stat-icon">${icon("chart")}</div><div class="num">${sesiTerakhir ? hadirTerakhir : "–"}</div><div class="label">Hadir pengurus sesi terakhir</div></div>
    <div class="stat-card"><div class="stat-icon">${icon("camera")}</div><div class="num" style="color:${act ? 'var(--green)' : 'var(--clay)'}">${act ? "AKTIF" : "TUTUP"}</div><div class="label">Status sesi hari ini</div></div>
  `;
  const last6 = sessions.slice(-6);
  if (last6.length === 0) {
    document.getElementById("trendChart").innerHTML = emptyState("chart", "Belum ada tren", "Tren kehadiran pengurus akan muncul setelah ada sesi & scan.");
  } else {
    const counts = await Promise.all(last6.map(async s => (await api(`/api/sessions/${s.id}/pengurus-attendance`)).attendance.filter(a => a.status === "hadir").length));
    drawTrendChart(last6, counts);
  }

  const historyData = await api("/api/login-history").catch(() => ({ history: [] }));
  const recentLogins = historyData.history.slice(0, 5);
  document.getElementById("adminExtra").innerHTML = `
    <div class="card" style="margin-top:22px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="font-size:15px;">Login terbaru</h3>
        <a style="font-size:12.5px;color:var(--maroon);cursor:pointer;font-weight:600;" onclick="goTo('login-history')">Lihat semua →</a>
      </div>
      ${recentLogins.length === 0 ? `<p style="font-size:13px;color:var(--ink-soft);">Belum ada riwayat login.</p>` :
        recentLogins.map(h => `
          <div class="scan-feed-item">
            <div class="scan-avatar">${initials(h.nama || h.username)}</div>
            <div><b>${esc(h.nama || h.username)}</b> <span class="badge-role ${h.role === 'admin' ? 'badge-admin' : 'badge-pengurus'}" style="margin-left:4px;">${h.role}</span><br>
            <span style="font-size:11.5px;color:var(--ink-soft);">${esc(h.device || '—')} · ${esc(h.lokasi || '—')}</span></div>
            <div class="time">${fmtDateTime(h.waktu)}</div>
          </div>`).join("")}
    </div>`;
}

/* ================= SISWA ================= */
async function renderSiswa() {
  await fillKelasSelects();
  await refreshStudents();
  const q = (document.getElementById("siswaSearch").value || "").toLowerCase();
  const kf = document.getElementById("siswaKelasFilter").value;
  const gf = document.getElementById("siswaGenderFilter").value;
  let list = studentsCache.filter(s => s.nama.toLowerCase().includes(q) && (!kf || s.kelas_id === kf) && (!gf || s.gender === gf));
  list = list.sort((a, b) => a.nama.localeCompare(b.nama));
  const container = document.getElementById("siswaTableWrap");
  if (studentsCache.length === 0) { container.innerHTML = emptyState("users", "Belum ada siswa", "Tambahkan siswa pertama untuk mulai membuat kartu QR."); return; }
  if (list.length === 0) { container.innerHTML = emptyState("search", "Tidak ditemukan", "Coba ubah pencarian atau filter."); return; }
  container.innerHTML = `<table>
    <thead><tr><th></th><th>Nama</th><th>Kelas</th><th>Gender</th><th>Tanggal Lahir</th><th>Alamat</th><th>Kode Unik</th><th>Ortu / Kontak</th><th></th></tr></thead>
    <tbody>${list.map(s => `
      <tr>
        <td>${s.foto ? `<img class="table-avatar" src="${s.foto}" alt="">` : `<span class="table-avatar">${initials(s.nama)}</span>`}</td>
        <td>${esc(s.nama)}</td><td>${kelasName(s.kelas_id)}</td>
        <td>${s.gender ? `<span class="pill ${s.gender === 'L' ? 'pill-gold' : 'pill-amber'}">${genderLabel(s.gender)}</span>` : "—"}</td>
        <td>${fmtTgl(s.tanggal_lahir)}${s.tanggal_lahir ? ` <span style="color:var(--ink-soft);font-size:11.5px;">(${hitungUmur(s.tanggal_lahir)} th)</span>` : ""}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(s.alamat || '')}">${esc(s.alamat || "—")}</td>
        <td class="mono">${s.barcode_value}</td><td>${esc(s.ortu || "—")}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="icon-btn" title="Edit" onclick="openStudentModal('${s.id}')">${icon("edit",14)}</button>
          <button class="icon-btn" title="Hapus" onclick="hapusSiswa('${s.id}')">${icon("trash",14)}</button>
        </td>
      </tr>`).join("")}</tbody></table>`;
}
function openStudentModal(id) {
  const s = id ? studentById(id) : null;
  const siswaClasses = classesCache.filter(c => c.tipe !== "pengurus");
  if (siswaClasses.length === 0) { showToast("Buat kelas untuk siswa dulu sebelum menambah siswa.", "err"); goTo("kelas"); return; }
  pendingFoto = undefined;
  const opts = siswaClasses.map(c => `<option value="${c.id}" ${s && s.kelas_id === c.id ? 'selected' : ''}>${esc(c.nama)}</option>`).join("");
  const previewHtml = s && s.foto ? `<img src="${s.foto}" alt="">` : initials(s ? s.nama : "?");
  openModal(`
    <h3>${s ? "Edit Siswa" : "Tambah Siswa"}</h3>
    <div class="field" style="text-align:center;">
      <div class="table-avatar" id="fFotoPreview" style="width:72px;height:72px;font-size:22px;margin:0 auto 8px;">${previewHtml}</div>
      <label style="text-align:center;">Foto (opsional)</label>
      <input id="fFoto" type="file" accept="image/*" onchange="handleFotoSelect(event)">
    </div>
    <div class="field"><label>Nama lengkap</label><input id="fNama" value="${esc(s ? s.nama : '')}" placeholder="Nama siswa"></div>
    <div class="field"><label>Kelas</label><select id="fKelas">${opts}</select></div>
    <div class="field-row">
      <div class="field"><label>Tanggal lahir</label><input id="fTglLahir" type="date" value="${s && s.tanggal_lahir ? s.tanggal_lahir : ''}"></div>
      <div class="field"><label>Gender</label>
        <select id="fGender">
          <option value="">Pilih</option>
          <option value="L" ${s && s.gender === 'L' ? 'selected' : ''}>Laki-laki</option>
          <option value="P" ${s && s.gender === 'P' ? 'selected' : ''}>Perempuan</option>
        </select>
      </div>
    </div>
    <div class="field"><label>Kontak orang tua (opsional)</label><input id="fOrtu" value="${esc(s ? s.ortu || '' : '')}" placeholder="No. HP / nama"></div>
    <div class="field"><label>Alamat (opsional)</label><input id="fAlamat" value="${esc(s ? s.alamat || '' : '')}" placeholder="Alamat rumah"></div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" onclick="simpanSiswa('${s ? s.id : ''}')">Simpan</button>
    </div>`);
}
let pendingFoto;
async function handleFotoSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pendingFoto = await compressImageToBase64(file);
    document.getElementById("fFotoPreview").innerHTML = `<img src="${pendingFoto}" alt="">`;
  } catch (err) { showToast("Gagal memproses foto.", "err"); }
}
async function simpanSiswa(id) {
  const nama = document.getElementById("fNama").value.trim();
  const kelasId = document.getElementById("fKelas").value;
  const ortu = document.getElementById("fOrtu").value.trim();
  const tanggalLahir = document.getElementById("fTglLahir").value || null;
  const gender = document.getElementById("fGender").value || null;
  const alamat = document.getElementById("fAlamat").value.trim();
  if (!nama) { showToast("Nama tidak boleh kosong.", "err"); return; }
  const payload = { nama, kelasId, ortu, tanggalLahir, gender, alamat };
  if (pendingFoto !== undefined) payload.foto = pendingFoto;
  try {
    if (id) await api(`/api/students/${id}`, "PUT", payload);
    else await api("/api/students", "POST", payload);
    closeModal(); await renderSiswa();
    showToast("Data siswa disimpan.");
  } catch (e) { showToast(e.message, "err"); }
}
function downloadSiswaCSV() {
  fetch("/api/students/csv", { headers: { Authorization: "Bearer " + token } })
    .then(r => r.blob())
    .then(blob => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "data-siswa.csv"; a.click();
    })
    .catch(() => showToast("Gagal mengunduh data siswa.", "err"));
}
async function hapusSiswa(id) {
  if (!confirm("Hapus siswa ini? Riwayat absensinya juga akan terhapus.")) return;
  await api(`/api/students/${id}`, "DELETE");
  await renderSiswa();
  showToast("Siswa dihapus.");
}

/* ================= KELAS ================= */
async function renderKelas() {
  await refreshClasses();
  await refreshStudents();
  const el = document.getElementById("kelasTableWrap");
  if (classesCache.length === 0) { el.innerHTML = emptyState("classes", "Belum ada kelas", "Tambahkan kelompok usia, misalnya Kelas 2 – 4."); return; }
  el.innerHTML = `<table><thead><tr><th>Nama Kelas</th><th>Untuk</th><th>Jumlah Siswa</th><th></th></tr></thead><tbody>
    ${classesCache.map(c => `<tr><td>${esc(c.nama)}</td>
      <td><span class="pill ${c.tipe === 'pengurus' ? 'pill-gold' : 'pill-green'}">${c.tipe === 'pengurus' ? 'Pengurus' : 'Siswa'}</span></td>
      <td>${studentsCache.filter(s => s.kelas_id === c.id).length}</td>
      <td style="text-align:right;"><button class="icon-btn" onclick="openKelasModal('${c.id}')">${icon("edit",14)}</button>
      <button class="icon-btn" onclick="hapusKelas('${c.id}')">${icon("trash",14)}</button></td></tr>`).join("")}
  </tbody></table>`;
}
function openKelasModal(id) {
  const c = id ? classesCache.find(x => x.id === id) : null;
  openModal(`<h3>${c ? "Edit Kelas" : "Tambah Kelas"}</h3>
    <div class="field"><label>Nama kelas / tingkatan</label><input id="fKelasNama" value="${esc(c ? c.nama : '')}" placeholder="mis. Kelas 2 – 4"></div>
    <div class="field"><label>Kelas ini untuk</label>
      <select id="fKelasTipe">
        <option value="siswa" ${!c || c.tipe !== 'pengurus' ? 'selected' : ''}>Siswa (anak-anak)</option>
        <option value="pengurus" ${c && c.tipe === 'pengurus' ? 'selected' : ''}>Pengurus</option>
      </select>
    </div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="closeModal()">Batal</button>
    <button class="btn btn-primary" onclick="simpanKelas('${c ? c.id : ''}')">Simpan</button></div>`);
}
async function simpanKelas(id) {
  const nama = document.getElementById("fKelasNama").value.trim();
  const tipe = document.getElementById("fKelasTipe").value;
  if (!nama) { showToast("Nama kelas tidak boleh kosong.", "err"); return; }
  try {
    if (id) await api(`/api/classes/${id}`, "PUT", { nama, tipe });
    else await api("/api/classes", "POST", { nama, tipe });
    closeModal(); await renderKelas(); await fillKelasSelects();
    showToast("Kelas disimpan.");
  } catch (e) { showToast(e.message, "err"); }
}
async function hapusKelas(id) {
  if (!confirm("Hapus kelas ini?")) return;
  try { await api(`/api/classes/${id}`, "DELETE"); await renderKelas(); await fillKelasSelects(); }
  catch (e) { showToast(e.message, "err"); }
}

/* ================= SESI ================= */
async function bukaSesiBaru() {
  try { await api("/api/sessions", "POST"); await renderSesi(); showToast("Sesi hari ini dibuka. Siap untuk scan."); }
  catch (e) { showToast(e.message, "err"); }
}
async function tutupSesi(id) { await api(`/api/sessions/${id}/tutup`, "PUT"); await renderSesi(); }
async function bukaKembali(id) { await api(`/api/sessions/${id}/buka`, "PUT"); await renderSesi(); }
async function hapusSesi(id) {
  if (!confirm("Hapus sesi ini beserta data absensinya?")) return;
  await api(`/api/sessions/${id}`, "DELETE"); await renderSesi();
}
async function simpanCutoff() {
  const val = document.getElementById("cutoffInput").value;
  if (!val) { showToast("Pilih jam terlebih dahulu.", "err"); return; }
  try { await api("/api/settings", "PUT", { cutoffTime: val }); showToast("Batas jam hadir disimpan: " + val); }
  catch (e) { showToast(e.message, "err"); }
}
async function renderSesi() {
  const settings = await api("/api/settings");
  document.getElementById("cutoffInput").value = settings.cutoffTime;
  const sessions = (await api("/api/sessions")).sessions;
  const el = document.getElementById("sesiTableWrap");
  if (sessions.length === 0) { el.innerHTML = emptyState("calendar", "Belum ada sesi", 'Klik "Buka Sesi Hari Ini" untuk mulai mencatat kehadiran minggu ini.'); return; }
  const counts = await Promise.all(sessions.map(async s => {
    const att = (await api(`/api/sessions/${s.id}/attendance`)).attendance;
    return { hadir: att.filter(a => a.status === "hadir").length, telat: att.filter(a => a.status === "terlambat").length };
  }));
  el.innerHTML = `<table><thead><tr><th>Tanggal</th><th>Status</th><th>Hadir</th><th>Terlambat</th><th></th></tr></thead><tbody>
    ${sessions.map((s, i) => `<tr>
        <td>${fmtDate(s.tanggal)}</td>
        <td>${s.status === "aktif" ? '<span class="pill pill-green">Aktif</span>' : '<span class="pill pill-clay">Ditutup</span>'}</td>
        <td>${counts[i].hadir} siswa</td><td>${counts[i].telat} siswa</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="btn btn-sm btn-outline" onclick="showSesiDetail('${s.id}','${s.tanggal}')">Detail</button>
          ${s.status === "aktif" ? `<button class="btn btn-sm btn-outline" onclick="tutupSesi('${s.id}').then(renderSesi)">Tutup</button>`
            : `<button class="btn btn-sm btn-outline" onclick="bukaKembali('${s.id}').then(renderSesi)">Buka lagi</button>`}
          <button class="icon-btn" onclick="hapusSesi('${s.id}')">${icon("trash",14)}</button>
        </td>
      </tr>`).join("")}
  </tbody></table>`;
}
async function showSesiDetail(id, tanggal) {
  const records = (await api(`/api/sessions/${id}/attendance`)).attendance;
  openModal(`
    <h3>Detail — ${fmtDate(tanggal)}</h3>
    <div style="max-height:340px;overflow-y:auto;">
      ${records.length === 0 ? '<p style="color:var(--ink-soft);font-size:13px;">Belum ada yang scan di sesi ini.</p>' :
        `<table><thead><tr><th>Nama</th><th>Jam</th><th>Status</th></tr></thead><tbody>
        ${records.map(r => `<tr>
          <td>${r.siswa_nama}</td><td class="mono">${fmtTime(r.waktu)}</td>
          <td>${r.status === "hadir" ? '<span class="pill pill-green">Hadir</span>' : '<span class="pill pill-amber">Tidak Hadir</span>'}</td>
        </tr>`).join("")}</tbody></table>`}
    </div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="closeModal()">Tutup</button></div>`);
}

/* ================= SCAN (kamera) — siswa & pengurus ================= */
async function renderScan() {
  const sessions = (await api("/api/sessions")).sessions;
  const act = sessions.find(s => s.status === "aktif");
  const wrap = document.getElementById("scanWrap");
  if (!act) {
    wrap.innerHTML = `<div style="max-width:420px;">${emptyState("calendar", "Belum ada sesi aktif", "Buka sesi hari ini dulu sebelum mulai scan.",
      `<button class="btn btn-primary" onclick="bukaSesiBaru().then(()=>goTo('scan'))">Buka Sesi Hari Ini</button>`)}</div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="scan-grid">
      <div>
        <div class="scan-seal"><div class="d">${fmtDate(act.tanggal)}<br><span style="color:var(--gold);font-size:11px;font-weight:700;">SESI AKTIF</span></div></div>
        <div id="qrReader"></div>
        <div class="manual-toggle"><a onclick="toggleManual('scanInput')">Kamera tidak berfungsi? Input kode manual</a></div>
        <div class="manual-box" id="manualBox">
          <input id="scanInput" class="mono" placeholder="Ketik kode siswa lalu Enter" autocomplete="off">
        </div>
      </div>
      <div>
        <h3 style="font-size:14px;margin-bottom:10px;">Riwayat scan hari ini</h3>
        <div id="scanFeed"></div>
      </div>
    </div>`;
  drawFeed("scanFeed", scanFeedItems);
  startScanner(processScan);
  const manualInput = document.getElementById("scanInput");
  manualInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); processScan(manualInput.value.trim()); manualInput.value = ""; } });
}
function toggleManual(inputId) {
  const box = document.getElementById("manualBox");
  box.classList.toggle("active");
  if (box.classList.contains("active")) document.getElementById(inputId).focus();
}
function startScanner(onDecode) {
  stopScanner();
  try {
    qrScanner = new Html5QrcodeScanner("qrReader", { fps: 12, qrbox: 230, rememberLastUsedCamera: true, showTorchButtonIfSupported: true }, false);
    qrScanner.render((decodedText) => onScanSuccess(decodedText, onDecode), () => {});
  } catch (e) {
    document.getElementById("qrReader").innerHTML = emptyState("camera", "Kamera tidak tersedia", "Gunakan input kode manual di bawah.");
    document.getElementById("manualBox").classList.add("active");
  }
}
function stopScanner() {
  if (qrScanner) { try { qrScanner.clear().catch(() => {}); } catch (e) {} qrScanner = null; }
}
function onScanSuccess(decodedText, onDecode) {
  const now = Date.now();
  if (decodedText === lastScanCode && (now - lastScanAt) < 3000) return;
  lastScanCode = decodedText; lastScanAt = now;
  onDecode(decodedText.trim());
}
async function processScan(code) {
  if (!code) return;
  try {
    const data = await api("/api/attendance/scan", "POST", { code });
    const s = data.student;
    if (data.status === "hadir") {
      pushFeed(scanFeedItems, "scanFeed", "ok", `${esc(s.nama)} — ${kelasName(s.kelas_id)}`);
      showScanResult({ type: "ok", nama: s.nama, foto: s.foto, meta: kelasName(s.kelas_id), message: "Absen berhasil — tepat waktu!", waktu: data.waktu });
    } else {
      pushFeed(scanFeedItems, "scanFeed", "late", `${esc(s.nama)} — lewat jam ${data.cutoffTime}, dianggap tidak hadir`);
      showScanResult({ type: "late", nama: s.nama, foto: s.foto, meta: kelasName(s.kelas_id), message: `Kamu terlambat (lewat jam ${data.cutoffTime}) — dianggap tidak hadir.`, waktu: data.waktu });
    }
  } catch (e) {
    if (e.data && e.data.kind === "duplicate") {
      const s = e.data.student;
      pushFeed(scanFeedItems, "scanFeed", "dup", `${esc(s.nama)} sudah tercatat`);
      showScanResult({ type: "dup", nama: s.nama, foto: s.foto, meta: kelasName(s.kelas_id), message: `Kamu sudah terdata di absen hari ini (${e.data.status === "hadir" ? "hadir" : "terlambat"}).`, waktu: e.data.waktu });
    } else {
      pushFeed(scanFeedItems, "scanFeed", "error", e.message);
      showScanResult({ type: "err", nama: "Kode tidak dikenali", meta: "", message: e.message });
    }
  }
}
let scanResultTimer;
const SRC_BADGE_ICONS = {
  ok: '<path d="M20 6L9 17l-5-5"/>',
  late: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  dup: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  err: '<path d="M18 6L6 18M6 6l12 12"/>'
};
function showScanResult({ type, nama, meta, foto, message, waktu }) {
  clearTimeout(scanResultTimer);
  const overlay = document.getElementById("scanResultOverlay");
  const photoWrap = document.getElementById("srcPhotoWrap");
  const photoEl = document.getElementById("srcPhoto");
  const badgeEl = document.getElementById("srcBadge");
  const card = document.getElementById("scanResultCard");

  photoWrap.className = "src-photo-wrap " + type;
  photoEl.innerHTML = foto ? `<img src="${foto}" alt="">` : initials(nama);
  badgeEl.className = "src-badge " + type;
  badgeEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${SRC_BADGE_ICONS[type]}</svg>`;
  document.getElementById("srcName").textContent = nama || "—";
  document.getElementById("srcMeta").textContent = meta || "";
  const bannerEl = document.getElementById("srcBanner");
  bannerEl.className = "src-banner " + type;
  bannerEl.textContent = message || "";
  document.getElementById("srcTime").textContent = waktu ? "Jam " + fmtTime(waktu) : "";

  card.classList.remove("src-shake");
  void card.offsetWidth; // reset animasi kalau kartu sebelumnya masih tampil
  if (type === "err") card.classList.add("src-shake");

  overlay.classList.add("active");
  scanResultTimer = setTimeout(hideScanResult, 3800);
}
function hideScanResult() {
  clearTimeout(scanResultTimer);
  const overlay = document.getElementById("scanResultOverlay");
  if (overlay) overlay.classList.remove("active");
}
function pushFeed(arr, elId, type, text) {
  arr.unshift({ type, text, time: fmtTime(new Date().toISOString()) });
  drawFeed(elId, arr);
}
function drawFeed(elId, arr) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = arr.slice(0, 10).map(it => `
    <div class="scan-feed-item">
      <div class="scan-avatar ${it.type === 'dup' || it.type === 'error' ? 'dup' : it.type === 'late' ? 'late' : ''}">${it.type === 'ok' ? '✓' : it.type === 'late' ? '!' : '✕'}</div>
      <div>${it.text}</div><div class="time">${it.time}</div>
    </div>`).join("") || `<p style="color:var(--ink-soft);font-size:13px;">Riwayat scan hari ini akan muncul di sini.</p>`;
}

/* ---- Scan Absen Pengurus ---- */
let pengurusFeedItems = [];
async function renderPengurusScan() {
  const sessions = (await api("/api/sessions")).sessions;
  const act = sessions.find(s => s.status === "aktif");
  const wrap = document.getElementById("pengurusScanWrap");
  if (!act) {
    wrap.innerHTML = `<div style="max-width:420px;">${emptyState("calendar", "Belum ada sesi aktif", "Minta pengurus membuka sesi hari ini dulu di tab Sesi Absen sebelum mulai scan.")}</div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="scan-grid">
      <div>
        <div class="scan-seal"><div class="d">${fmtDate(act.tanggal)}<br><span style="color:var(--gold);font-size:11px;font-weight:700;">SESI AKTIF</span></div></div>
        <div id="qrReader"></div>
        <div class="manual-toggle"><a onclick="toggleManual('pengurusScanInput')">Kamera tidak berfungsi? Input kode manual</a></div>
        <div class="manual-box" id="manualBox">
          <input id="pengurusScanInput" class="mono" placeholder="Ketik kode pengurus lalu Enter" autocomplete="off">
        </div>
      </div>
      <div>
        <h3 style="font-size:14px;margin-bottom:10px;">Riwayat scan hari ini</h3>
        <div id="pengurusScanFeed"></div>
      </div>
    </div>`;
  drawFeed("pengurusScanFeed", pengurusFeedItems);
  startScanner(processPengurusScan);
  const manualInput = document.getElementById("pengurusScanInput");
  manualInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); processPengurusScan(manualInput.value.trim()); manualInput.value = ""; } });
}
async function processPengurusScan(code) {
  if (!code) return;
  try {
    const data = await api("/api/pengurus-attendance/scan", "POST", { code });
    const p = data.pengurus;
    if (data.status === "hadir") {
      pushFeed(pengurusFeedItems, "pengurusScanFeed", "ok", `${esc(p.nama)}`);
      showScanResult({ type: "ok", nama: p.nama, meta: "Pengurus", message: "Absen berhasil — tepat waktu!", waktu: data.waktu });
    } else {
      pushFeed(pengurusFeedItems, "pengurusScanFeed", "late", `${esc(p.nama)} — lewat jam ${data.cutoffTime}, dianggap tidak hadir`);
      showScanResult({ type: "late", nama: p.nama, meta: "Pengurus", message: `Kamu terlambat (lewat jam ${data.cutoffTime}) — dianggap tidak hadir.`, waktu: data.waktu });
    }
  } catch (e) {
    if (e.data && e.data.kind === "duplicate") {
      const p = e.data.pengurus;
      pushFeed(pengurusFeedItems, "pengurusScanFeed", "dup", `${esc(p.nama)} sudah tercatat`);
      showScanResult({ type: "dup", nama: p.nama, meta: "Pengurus", message: `Kamu sudah terdata di absen hari ini (${e.data.status === "hadir" ? "hadir" : "terlambat"}).`, waktu: e.data.waktu });
    } else {
      pushFeed(pengurusFeedItems, "pengurusScanFeed", "error", e.message);
      showScanResult({ type: "err", nama: "Kode tidak dikenali", meta: "", message: e.message });
    }
  }
}

/* ================= KARTU (QR) ================= */
async function renderKartu() {
  await refreshStudents(); await refreshClasses();
  const grid = document.getElementById("cardGrid");
  if (studentsCache.length === 0) { grid.innerHTML = emptyState("card", "Belum ada siswa", "Tambahkan siswa dulu di tab Data Siswa."); return; }
  const list = [...studentsCache].sort((a, b) => a.nama.localeCompare(b.nama));
  grid.innerHTML = list.map(s => `
    <div class="id-card">
      <img class="mini-logo" src="/assets/logo.png" alt="">
      ${s.foto ? `<img class="foto-thumb" src="${s.foto}" alt="">` : `<div class="foto-thumb">${initials(s.nama)}</div>`}
      <div class="nama">${esc(s.nama)}</div>
      <div class="kelas">${kelasName(s.kelas_id)}</div>
      <div class="qrbox" id="qr-${s.id}"></div>
      <div class="kode-txt">${s.barcode_value}</div>
    </div>`).join("");
  list.forEach(s => {
    try { new QRCode(document.getElementById(`qr-${s.id}`), { text: s.barcode_value, width: 120, height: 120, correctLevel: QRCode.CorrectLevel.M }); } catch (e) {}
  });
}

/* ================= REKAP ================= */
async function renderRekap() {
  await fillKelasSelects();
  const kf = document.getElementById("rekapKelasFilter").value;
  const sortBy = document.getElementById("rekapSortFilter").value;
  const data = await api("/api/rekap" + (kf ? `?kelasId=${kf}` : ""));
  let list = data.rekap;
  if (sortBy === "pct_asc") list = [...list].sort((a, b) => a.persentase - b.persentase || a.nama.localeCompare(b.nama));
  else if (sortBy === "nama_asc") list = [...list].sort((a, b) => a.nama.localeCompare(b.nama));
  else list = [...list].sort((a, b) => b.persentase - a.persentase || a.nama.localeCompare(b.nama));
  const el = document.getElementById("rekapTableWrap");
  if (list.length === 0) { el.innerHTML = emptyState("chart", "Belum ada data", "Rekap akan muncul setelah ada siswa dan sesi absen."); return; }
  el.innerHTML = `<table><thead><tr><th>Nama</th><th>Kelas</th><th>Hadir</th><th>Terlambat</th><th>Total Sesi</th><th>Persentase</th></tr></thead><tbody>
    ${list.map(s => `<tr><td>${esc(s.nama)}</td><td>${kelasName(s.kelas_id)}</td><td>${s.hadir}</td><td>${s.terlambat}</td><td>${s.totalSesi}</td>
      <td><span class="pill ${s.persentase >= 80 ? 'pill-green' : s.persentase >= 50 ? 'pill-gold' : 'pill-clay'}">${s.persentase}%</span></td></tr>`).join("")}
  </tbody></table>`;
}
function downloadRekapCSV() {
  const kf = document.getElementById("rekapKelasFilter").value;
  const url = "/api/rekap/csv" + (kf ? `?kelasId=${kf}` : "");
  fetch(url, { headers: { Authorization: "Bearer " + token } })
    .then(r => r.blob())
    .then(blob => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "rekap-absensi.csv"; a.click();
    })
    .catch(() => showToast("Gagal mengunduh rekap.", "err"));
}

/* ================= AKUN (admin) ================= */
async function renderAkun() {
  const { users } = await api("/api/users");
  const el = document.getElementById("akunTableWrap");
  el.innerHTML = `<table><thead><tr><th>Nama</th><th>Username</th><th>Peran</th><th></th></tr></thead><tbody>
    ${users.map(u => `<tr>
      <td>${esc(u.nama || "—")}</td><td class="mono">${esc(u.username)}</td>
      <td><span class="badge-role ${u.role === 'admin' ? 'badge-admin' : 'badge-pengurus'}">${u.role}</span></td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="icon-btn" title="Edit" onclick='openAkunModal(${JSON.stringify(u.id)})'>${icon("edit",14)}</button>
        <button class="icon-btn" title="Hapus" onclick="hapusAkun('${u.id}')">${icon("trash",14)}</button>
      </td></tr>`).join("")}
  </tbody></table>`;
}
async function openAkunModal(id) {
  let u = null;
  if (id) { const { users } = await api("/api/users"); u = users.find(x => x.id === id); }
  openModal(`
    <h3>${u ? "Edit Akun" : "Tambah Akun"}</h3>
    <div class="field"><label>Nama</label><input id="fAkunNama" value="${esc(u ? u.nama || '' : '')}" placeholder="Nama pengurus"></div>
    <div class="field"><label>Username</label><input id="fAkunUser" value="${esc(u ? u.username : '')}" placeholder="username"></div>
    <div class="field"><label>Password ${u ? '(kosongkan jika tidak diubah)' : ''}</label><input id="fAkunPass" type="text" placeholder="password"></div>
    <div class="field"><label>Peran</label>
      <select id="fAkunRole">
        <option value="pengurus" ${u && u.role === 'pengurus' ? 'selected' : ''}>Pengurus (kelola siswa, scan, rekap)</option>
        <option value="admin" ${u && u.role === 'admin' ? 'selected' : ''}>Admin (hanya kelola akun)</option>
      </select>
    </div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="closeModal()">Batal</button>
    <button class="btn btn-primary" onclick="simpanAkun('${u ? u.id : ''}')">Simpan</button></div>`);
}
async function simpanAkun(id) {
  const nama = document.getElementById("fAkunNama").value.trim();
  const username = document.getElementById("fAkunUser").value.trim();
  const password = document.getElementById("fAkunPass").value;
  const role = document.getElementById("fAkunRole").value;
  if (!username) { showToast("Username tidak boleh kosong.", "err"); return; }
  try {
    if (id) await api(`/api/users/${id}`, "PUT", { nama, username, password: password || undefined, role });
    else {
      if (!password) { showToast("Password wajib diisi untuk akun baru.", "err"); return; }
      await api("/api/users", "POST", { nama, username, password, role });
    }
    closeModal(); await renderAkun();
    showToast("Akun disimpan.");
  } catch (e) { showToast(e.message, "err"); }
}
async function hapusAkun(id) {
  if (!confirm("Hapus akun ini?")) return;
  try { await api(`/api/users/${id}`, "DELETE"); await renderAkun(); }
  catch (e) { showToast(e.message, "err"); }
}

/* ================= DATA PENGURUS (admin) ================= */
let pengurusCache = [];
async function refreshPengurus() { pengurusCache = (await api("/api/pengurus")).pengurus; return pengurusCache; }
async function renderPengurusData() {
  await refreshClasses();
  await refreshPengurus();
  const el = document.getElementById("pengurusDataTableWrap");
  if (pengurusCache.length === 0) { el.innerHTML = emptyState("users", "Belum ada pengurus", "Tambahkan pengurus pertama untuk mulai membuat kartu QR absen."); return; }
  const list = [...pengurusCache].sort((a, b) => a.nama.localeCompare(b.nama));
  el.innerHTML = `<table>
    <thead><tr><th>Nama</th><th>TTL</th><th>Kelas</th><th>Alamat</th><th>No HP</th><th>Kode Unik</th><th></th></tr></thead>
    <tbody>${list.map(p => `
      <tr>
        <td>${esc(p.nama)}</td>
        <td>${esc(p.tempat_lahir || "—")}${p.tanggal_lahir ? ", " + fmtTgl(p.tanggal_lahir) : ""}</td>
        <td>${kelasName(p.kelas_id)}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(p.alamat || '')}">${esc(p.alamat || "—")}</td>
        <td>${esc(p.no_hp || "—")}</td>
        <td class="mono">${p.barcode_value}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="icon-btn" title="Edit" onclick="openPengurusModal('${p.id}')">${icon("edit",14)}</button>
          <button class="icon-btn" title="Hapus" onclick="hapusPengurus('${p.id}')">${icon("trash",14)}</button>
        </td>
      </tr>`).join("")}</tbody></table>`;
}
function openPengurusModal(id) {
  const p = id ? pengurusCache.find(x => x.id === id) : null;
  const pengurusClasses = classesCache.filter(c => c.tipe === "pengurus");
  const opts = pengurusClasses.map(c => `<option value="${c.id}" ${p && p.kelas_id === c.id ? 'selected' : ''}>${esc(c.nama)}</option>`).join("");
  openModal(`
    <h3>${p ? "Edit Pengurus" : "Tambah Pengurus"}</h3>
    <div class="field"><label>Nama lengkap</label><input id="fPNama" value="${esc(p ? p.nama : '')}" placeholder="Nama pengurus"></div>
    <div class="field-row">
      <div class="field"><label>Tempat lahir</label><input id="fPTempatLahir" value="${esc(p ? p.tempat_lahir || '' : '')}" placeholder="mis. Jakarta"></div>
      <div class="field"><label>Tanggal lahir</label><input id="fPTglLahir" type="date" value="${p && p.tanggal_lahir ? p.tanggal_lahir : ''}"></div>
    </div>
    <div class="field"><label>Kelas yang diampu (opsional)</label><select id="fPKelas"><option value="">Tidak ada</option>${opts}</select></div>
    <div class="field"><label>Alamat</label><input id="fPAlamat" value="${esc(p ? p.alamat || '' : '')}" placeholder="Alamat rumah"></div>
    <div class="field"><label>No HP</label><input id="fPNoHp" value="${esc(p ? p.no_hp || '' : '')}" placeholder="08xxxxxxxxxx"></div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" onclick="simpanPengurus('${p ? p.id : ''}')">Simpan</button>
    </div>`);
}
async function simpanPengurus(id) {
  const nama = document.getElementById("fPNama").value.trim();
  const tempatLahir = document.getElementById("fPTempatLahir").value.trim();
  const tanggalLahir = document.getElementById("fPTglLahir").value || null;
  const kelasId = document.getElementById("fPKelas").value || null;
  const alamat = document.getElementById("fPAlamat").value.trim();
  const noHp = document.getElementById("fPNoHp").value.trim();
  if (!nama) { showToast("Nama tidak boleh kosong.", "err"); return; }
  try {
    if (id) await api(`/api/pengurus/${id}`, "PUT", { nama, tempatLahir, tanggalLahir, kelasId, alamat, noHp });
    else await api("/api/pengurus", "POST", { nama, tempatLahir, tanggalLahir, kelasId, alamat, noHp });
    closeModal(); await renderPengurusData();
    showToast("Data pengurus disimpan.");
  } catch (e) { showToast(e.message, "err"); }
}
async function hapusPengurus(id) {
  if (!confirm("Hapus pengurus ini? Riwayat absensinya juga akan terhapus.")) return;
  await api(`/api/pengurus/${id}`, "DELETE");
  await renderPengurusData();
  showToast("Pengurus dihapus.");
}
function downloadPengurusCSV() {
  fetch("/api/pengurus/csv", { headers: { Authorization: "Bearer " + token } })
    .then(r => r.blob())
    .then(blob => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "data-pengurus.csv"; a.click(); })
    .catch(() => showToast("Gagal mengunduh data pengurus.", "err"));
}

/* ---- Kartu QR Pengurus ---- */
async function renderPengurusKartu() {
  await refreshPengurus();
  const grid = document.getElementById("pengurusCardGrid");
  if (pengurusCache.length === 0) { grid.innerHTML = emptyState("card", "Belum ada pengurus", "Tambahkan pengurus dulu di tab Data Pengurus."); return; }
  const list = [...pengurusCache].sort((a, b) => a.nama.localeCompare(b.nama));
  grid.innerHTML = list.map(p => `
    <div class="id-card">
      <img class="mini-logo" src="/assets/logo.png" alt="">
      <div class="nama">${esc(p.nama)}</div>
      <div class="kelas">Pengurus</div>
      <div class="qrbox" id="pqr-${p.id}"></div>
      <div class="kode-txt">${p.barcode_value}</div>
    </div>`).join("");
  list.forEach(p => {
    try { new QRCode(document.getElementById(`pqr-${p.id}`), { text: p.barcode_value, width: 120, height: 120, correctLevel: QRCode.CorrectLevel.M }); } catch (e) {}
  });
}

/* ---- Rekap Pengurus ---- */
async function renderPengurusRekap() {
  const data = await api("/api/pengurus-rekap");
  const el = document.getElementById("pengurusRekapTableWrap");
  if (data.rekap.length === 0) { el.innerHTML = emptyState("chart", "Belum ada data", "Rekap akan muncul setelah ada pengurus dan sesi absen."); return; }
  el.innerHTML = `<table><thead><tr><th>Nama</th><th>Hadir</th><th>Terlambat</th><th>Total Sesi</th><th>Persentase</th></tr></thead><tbody>
    ${data.rekap.map(p => `<tr><td>${esc(p.nama)}</td><td>${p.hadir}</td><td>${p.terlambat}</td><td>${p.totalSesi}</td>
      <td><span class="pill ${p.persentase >= 80 ? 'pill-green' : p.persentase >= 50 ? 'pill-gold' : 'pill-clay'}">${p.persentase}%</span></td></tr>`).join("")}
  </tbody></table>`;
}
function downloadPengurusRekapCSV() {
  fetch("/api/pengurus-rekap/csv", { headers: { Authorization: "Bearer " + token } })
    .then(r => r.blob())
    .then(blob => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "rekap-pengurus.csv"; a.click(); })
    .catch(() => showToast("Gagal mengunduh rekap pengurus.", "err"));
}

/* ================= RIWAYAT LOGIN (admin) ================= */
async function renderLoginHistory() {
  const { history } = await api("/api/login-history");
  const el = document.getElementById("loginHistoryTableWrap");
  if (history.length === 0) { el.innerHTML = emptyState("calendar", "Belum ada riwayat", "Riwayat login akan muncul setiap kali ada akun yang masuk."); return; }
  el.innerHTML = `<table><thead><tr><th>Nama</th><th>Peran</th><th>Waktu</th><th>Perangkat</th><th>Perkiraan Lokasi</th></tr></thead><tbody>
    ${history.map(h => `<tr>
        <td>${esc(h.nama || h.username)}</td>
        <td><span class="badge-role ${h.role === 'admin' ? 'badge-admin' : 'badge-pengurus'}">${h.role}</span></td>
        <td>${fmtDateTime(h.waktu)}</td>
        <td>${esc(h.device || "—")}</td>
        <td>${esc(h.lokasi || "—")}</td>
      </tr>`).join("")}
  </tbody></table>`;
}
async function hapusRiwayatLogin() {
  if (!confirm("Hapus semua riwayat login? Tindakan ini tidak bisa dibatalkan.")) return;
  await api("/api/login-history", "DELETE");
  await renderLoginHistory();
  showToast("Riwayat login dihapus.");
}

/* ================= PENGATURAN (admin) ================= */
let pendingLogo;
async function renderPengaturan() {
  pendingLogo = undefined;
  const { namaSekolah, logo } = await api("/api/branding");
  document.getElementById("fNamaSekolah").value = namaSekolah;
  const preview = document.getElementById("settingsLogoPreview");
  preview.innerHTML = logo ? `<img src="${logo}" alt="" style="width:100%;height:100%;object-fit:cover;">` : `<img src="/assets/logo.png" alt="" style="width:100%;height:100%;object-fit:cover;">`;
}
async function handleSettingsLogoSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pendingLogo = await compressImageToBase64(file, 240, 0.8);
    document.getElementById("settingsLogoPreview").innerHTML = `<img src="${pendingLogo}" alt="" style="width:100%;height:100%;object-fit:cover;">`;
  } catch (err) { showToast("Gagal memproses logo.", "err"); }
}
async function simpanBranding() {
  const namaSekolah = document.getElementById("fNamaSekolah").value.trim();
  if (!namaSekolah) { showToast("Nama sekolah tidak boleh kosong.", "err"); return; }
  const payload = { namaSekolah };
  if (pendingLogo !== undefined) payload.logo = pendingLogo;
  try {
    await api("/api/branding", "PUT", payload);
    await applyBranding();
    showToast("Identitas aplikasi disimpan.");
  } catch (e) { showToast(e.message, "err"); }
}
function downloadBackupLengkap() {
  fetch("/api/backup", { headers: { Authorization: "Bearer " + token } })
    .then(r => r.blob())
    .then(blob => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "backup-smb-naga-putta.json"; a.click();
    })
    .catch(() => showToast("Gagal mengunduh backup.", "err"));
}

/* ================= INIT ================= */
async function applyBranding() {
  try {
    const { namaSekolah, logo } = await api("/api/branding");
    document.title = "Absensi — " + namaSekolah;
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const setImg = (id, val) => { const el = document.getElementById(id); if (el && val) el.src = val; };
    setText("brandLoginTitle", "Absensi " + namaSekolah);
    setText("brandMobileName", namaSekolah);
    setText("brandSidebarName", namaSekolah);
    setImg("brandLoginLogo", logo);
    setImg("brandMobileLogo", logo);
    setImg("brandSidebarLogo", logo);
  } catch (e) { /* biarkan default kalau gagal ambil branding */ }
}
applyBranding();
document.getElementById("loginPass").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
document.getElementById("loginUser").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
tryAutoLogin();