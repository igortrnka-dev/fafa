import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- konfigurácia ----------
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "poloha.sqlite");
const TIME_ZONE = "Europe/Bratislava";
const ONLINE_SECONDS = 120; // posledná poloha mladšia ako 2 min = online
const KEEP_DAYS = 60;       // história polôh sa maže po 60 dňoch

if (!ADMIN_PASSWORD || !SESSION_SECRET || SESSION_SECRET.length < 20) {
  console.error("Nastavte premenné prostredia ADMIN_PASSWORD a SESSION_SECRET (min. 20 znakov). Pozri .env.example");
  process.exit(1);
}

// ---------- databáza ----------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    token TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    accuracy REAL,
    speed REAL,
    ip TEXT,
    recorded_at INTEGER NOT NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );
  CREATE INDEX IF NOT EXISTS idx_positions_emp_time ON positions(employee_id, recorded_at);
  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    note TEXT,
    photo_file TEXT,
    audio_file TEXT,
    lat REAL,
    lng REAL,
    ip TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    file TEXT NOT NULL,
    lat REAL,
    lng REAL,
    ip TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );
  CREATE INDEX IF NOT EXISTS idx_snap_emp_time ON snapshots(employee_id, created_at);
  CREATE TABLE IF NOT EXISTS consents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );
  CREATE INDEX IF NOT EXISTS idx_consent_emp_time ON consents(employee_id, created_at);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// migrácia starších databáz (stĺpec ip pribudol dodatočne)
try { db.exec("ALTER TABLE positions ADD COLUMN ip TEXT"); } catch {}

const INCIDENT_DIR = path.join(path.dirname(DB_PATH), "incidents");
const SNAPSHOT_DIR = path.join(path.dirname(DB_PATH), "snapshots");
fs.mkdirSync(INCIDENT_DIR, { recursive: true });
fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
const SNAPSHOT_KEEP_DAYS = 14;

const DEFAULT_SETTINGS = { work_start: "08:00", work_end: "17:00", work_days: "1,2,3,4,5", camera: "0", camera_interval: "60" };
function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}
function setSetting(key, value) {
  db.prepare("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

// ---------- pracovná doba ----------
function localNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE, hour12: false,
    weekday: "short", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { day: dayMap[get("weekday")], minutes: Number(get("hour")) % 24 * 60 + Number(get("minute")) };
}
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function isWorkTime(settings, date = new Date()) {
  const { day, minutes } = localNow(date);
  const days = settings.work_days.split(",").filter(Boolean).map(Number);
  if (!days.includes(day)) return false;
  const start = toMinutes(settings.work_start), end = toMinutes(settings.work_end);
  if (start <= end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end; // nočná zmena cez polnoc
}

// ---------- prihlásenie admina (podpísaná cookie) ----------
function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}
function makeSession() {
  const payload = `${Date.now()}.${crypto.randomBytes(8).toString("hex")}`;
  return `${payload}.${sign(payload)}`;
}
function validSession(cookie) {
  if (!cookie) return false;
  const i = cookie.lastIndexOf(".");
  if (i < 0) return false;
  const payload = cookie.slice(0, i), sig = cookie.slice(i + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const age = Date.now() - Number(payload.split(".")[0]);
  return age >= 0 && age < 30 * 24 * 3600 * 1000; // 30 dní
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  }
  return out;
}
function requireAdmin(req, res, next) {
  if (validSession(parseCookies(req).session)) return next();
  if (req.originalUrl.startsWith("/api/")) return res.status(401).json({ error: "unauthorized" });
  res.redirect("/login");
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ---------- aplikácia ----------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false }));

const pub = (f) => path.join(__dirname, "public", f);
// HTML stránky posielaj vždy čerstvé, nech prehliadač neukáže starú verziu po aktualizácii
const sendPage = (res, file, status = 200) => {
  res.set("Cache-Control", "no-cache, must-revalidate");
  res.status(status).sendFile(pub(file));
};

app.get("/login", (req, res) => sendPage(res, "login.html"));
app.post("/login", (req, res) => {
  if (!safeEqual(req.body.password || "", ADMIN_PASSWORD)) return res.redirect("/login?chyba=1");
  const secure = PUBLIC_URL.startsWith("https://") ? "; Secure" : "";
  res.setHeader("Set-Cookie", `session=${makeSession()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${secure}`);
  res.redirect("/");
});
app.get("/logout", (req, res) => {
  res.setHeader("Set-Cookie", "session=; Path=/; HttpOnly; Max-Age=0");
  res.redirect("/login");
});

// --- stránka pre zamestnanca (bez prihlásenia, identifikácia cez token v linku) ---
// názov v ceste linku (meno firmy); nastaviteľné cez BRAND_SLUG v .env
const BRAND_SLUG = (process.env.BRAND_SLUG || "t").replace(/[^a-zA-Z0-9_-]/g, "") || "t";
const getByToken = db.prepare("SELECT id, name, active FROM employees WHERE token = ?");
function serveTrack(req, res) {
  const emp = getByToken.get(req.params.token);
  if (!emp || !emp.active) return sendPage(res, "neplatny.html", 404);
  sendPage(res, "track.html");
}
app.get(`/${BRAND_SLUG}/:token`, serveTrack);
if (BRAND_SLUG !== "t") app.get("/t/:token", serveTrack); // spätná kompatibilita starých linkov
app.get("/api/t/:token", (req, res) => {
  const emp = getByToken.get(req.params.token);
  if (!emp || !emp.active) return res.status(404).json({ error: "not_found" });
  const s = getSettings();
  res.json({ name: emp.name, work_start: s.work_start, work_end: s.work_end, work_days: s.work_days,
    work_time: isWorkTime(s), camera: s.camera === "1", camera_interval: Math.max(20, Number(s.camera_interval) || 60) });
});
// záznam súhlasu kuriéra (kliknutie na Súhlasím pri otvorení linku) – dôkaz s časom a IP
const insertConsent = db.prepare("INSERT INTO consents(employee_id, ip, user_agent, created_at) VALUES (?, ?, ?, ?)");
app.post("/api/t/:token/consent", (req, res) => {
  const emp = getByToken.get(req.params.token);
  if (!emp || !emp.active) return res.status(404).json({ error: "not_found" });
  insertConsent.run(emp.id, clientIp(req), String(req.headers["user-agent"] || "").slice(0, 300), Date.now());
  res.json({ ok: true });
});
function clientIp(req) {
  return (req.ip || "").replace(/^::ffff:/, "") || null;
}
const insertPos = db.prepare("INSERT INTO positions(employee_id, lat, lng, accuracy, speed, ip, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
app.post("/api/t/:token/pos", (req, res) => {
  const emp = getByToken.get(req.params.token);
  if (!emp || !emp.active) return res.status(404).json({ error: "not_found" });
  const s = getSettings();
  if (!isWorkTime(s)) return res.json({ stored: false, reason: "outside_hours", work_time: false });
  const { lat, lng, accuracy, speed, ts } = req.body || {};
  if (typeof lat !== "number" || typeof lng !== "number" || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: "bad_position" });
  }
  const now = Date.now();
  const recorded = typeof ts === "number" && Math.abs(now - ts) < 10 * 60 * 1000 ? ts : now;
  insertPos.run(emp.id, lat, lng, typeof accuracy === "number" ? accuracy : null, typeof speed === "number" ? speed : null, clientIp(req), recorded);
  res.json({ stored: true, work_time: true });
});

// --- nahlásenie nehody / poškodenia (spúšťa kuriér tlačidlom; fotka a hlas sú dobrovoľné) ---
const bigJson = express.json({ limit: "12mb" });
const insertIncident = db.prepare("INSERT INTO incidents(employee_id, note, photo_file, audio_file, lat, lng, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
function saveDataUrl(dir, base, dataUrl, allowed) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl || "");
  if (!m || !allowed[m[1]]) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 10 * 1024 * 1024) return null;
  const file = `${base}.${allowed[m[1]]}`;
  fs.writeFileSync(path.join(dir, file), buf);
  return file;
}
app.post("/api/t/:token/incident", bigJson, (req, res) => {
  const emp = getByToken.get(req.params.token);
  if (!emp || !emp.active) return res.status(404).json({ error: "not_found" });
  const { note, photo, audio, lat, lng } = req.body || {};
  const now = Date.now();
  const base = `${now}-${emp.id}`;
  const photoFile = photo ? saveDataUrl(INCIDENT_DIR, `${base}-foto`, photo, { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }) : null;
  const audioFile = audio ? saveDataUrl(INCIDENT_DIR, `${base}-zvuk`, audio, { "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/mpeg": "mp3" }) : null;
  insertIncident.run(emp.id, String(note || "").slice(0, 1000) || null, photoFile, audioFile,
    typeof lat === "number" ? lat : null, typeof lng === "number" ? lng : null, clientIp(req), now);
  res.json({ ok: true });
});

// --- priebežná snímka z kamery vozidla (každú minútu, len počas pracovnej doby) ---
const insertSnap = db.prepare("INSERT INTO snapshots(employee_id, file, lat, lng, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)");
app.post("/api/t/:token/snapshot", bigJson, (req, res) => {
  const emp = getByToken.get(req.params.token);
  if (!emp || !emp.active) return res.status(404).json({ error: "not_found" });
  const s = getSettings();
  if (!isWorkTime(s)) return res.json({ stored: false, work_time: false });
  const { photo, lat, lng } = req.body || {};
  const now = Date.now();
  const file = saveDataUrl(SNAPSHOT_DIR, `${now}-${emp.id}`, photo, { "image/jpeg": "jpg", "image/webp": "webp" });
  if (!file) return res.status(400).json({ error: "bad_photo" });
  insertSnap.run(emp.id, file, typeof lat === "number" ? lat : null, typeof lng === "number" ? lng : null, clientIp(req), now);
  res.json({ stored: true, work_time: true });
});

// --- príjem polohy z aplikácie bežiacej na pozadí (Traccar Client / OsmAnd protokol) ---
// Kuriér v appke Traccar Client nastaví: Server URL = https://<adresa>/gps, Device ID = svoj token.
// Funguje aj keď je telefón zamknutý alebo prehliadač zavretý.
function parseTs(v) {
  if (v == null || v === "") return Date.now();
  if (/^\d+$/.test(String(v))) { const n = Number(v); return n < 1e12 ? n * 1000 : n; }
  const t = Date.parse(v);
  return Number.isNaN(t) ? Date.now() : t;
}
function handleGps(req, res) {
  const q = { ...(req.query || {}), ...(req.body || {}) };
  // otvorené v prehliadači bez údajov o polohe – priateľská správa, že endpoint žije
  if (q.lat == null && q.lon == null && q.lng == null && q.longitude == null) {
    return res.type("text").send("Tracking endpoint je aktívny. Túto adresu zadaj v aplikácii Traccar Client ako Server URL a pri nej Device identifier (kód kuriéra z admina).");
  }
  const emp = getByToken.get(String(q.id || q.deviceid || ""));
  if (!emp || !emp.active) return res.status(404).send("neznámy kód kuriéra (Device ID)");
  const lat = Number(q.lat), lng = Number(q.lon ?? q.lng ?? q.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return res.status(400).send("bad position");
  const s = getSettings();
  if (!isWorkTime(s)) return res.send("outside hours"); // 200, mimo pracovnej doby neukladáme
  const acc = Number(q.accuracy);
  let recorded = parseTs(q.timestamp);
  if (Math.abs(Date.now() - recorded) > 24 * 3600 * 1000) recorded = Date.now();
  insertPos.run(emp.id, lat, lng, Number.isFinite(acc) ? acc : null, null, clientIp(req), recorded);
  res.send("ok");
}
app.get("/gps", handleGps);
app.post("/gps", handleGps);

// --- admin ---
app.get("/", requireAdmin, (req, res) => sendPage(res, "admin.html"));
app.use("/api", requireAdmin);

function baseUrl(req) {
  // link berie z adresy, cez ktorú práve pristupuješ (tunel, doména aj localhost fungujú samo)
  const host = req.get("host");
  return host ? `${req.protocol}://${host}` : PUBLIC_URL;
}
function employeeRow(e, req) {
  return { ...e, link: `${baseUrl(req)}/${BRAND_SLUG}/${e.token}` };
}
app.get("/api/employees", (req, res) => {
  const rows = db.prepare("SELECT id, name, phone, token, active, created_at FROM employees ORDER BY name").all();
  res.json(rows.map((e) => employeeRow(e, req)));
});
app.post("/api/employees", (req, res) => {
  const name = String(req.body.name || "").trim();
  const phone = String(req.body.phone || "").trim();
  if (!name) return res.status(400).json({ error: "Meno je povinné" });
  const token = crypto.randomBytes(12).toString("base64url");
  const r = db.prepare("INSERT INTO employees(name, phone, token, created_at) VALUES (?, ?, ?, ?)").run(name, phone, token, Date.now());
  const e = db.prepare("SELECT id, name, phone, token, active, created_at FROM employees WHERE id = ?").get(r.lastInsertRowid);
  res.json(employeeRow(e, req));
});
app.patch("/api/employees/:id", (req, res) => {
  const id = Number(req.params.id);
  const e = db.prepare("SELECT * FROM employees WHERE id = ?").get(id);
  if (!e) return res.status(404).json({ error: "not_found" });
  const name = req.body.name !== undefined ? String(req.body.name).trim() || e.name : e.name;
  const phone = req.body.phone !== undefined ? String(req.body.phone).trim() : e.phone;
  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : e.active;
  const token = req.body.new_link ? crypto.randomBytes(12).toString("base64url") : e.token;
  db.prepare("UPDATE employees SET name = ?, phone = ?, active = ?, token = ? WHERE id = ?").run(name, phone, active, token, id);
  res.json(employeeRow(db.prepare("SELECT id, name, phone, token, active, created_at FROM employees WHERE id = ?").get(id), req));
});
app.delete("/api/employees/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM positions WHERE employee_id = ?").run(id);
  db.prepare("DELETE FROM employees WHERE id = ?").run(id);
  res.json({ ok: true });
});

// posledná poloha každého aktívneho zamestnanca
app.get("/api/live", (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.name, e.phone, p.lat, p.lng, p.accuracy, p.speed, p.ip, p.recorded_at
    FROM employees e
    LEFT JOIN positions p ON p.id = (
      SELECT id FROM positions WHERE employee_id = e.id ORDER BY recorded_at DESC LIMIT 1
    )
    WHERE e.active = 1
    ORDER BY e.name
  `).all();
  const now = Date.now();
  const s = getSettings();
  res.json({
    now,
    work_time: isWorkTime(s),
    camera: s.camera === "1",
    camera_interval: Math.max(20, Number(s.camera_interval) || 60),
    employees: rows.map((r) => {
      const snap = db.prepare("SELECT id, created_at FROM snapshots WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1").get(r.id);
      const consent = db.prepare("SELECT created_at FROM consents WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1").get(r.id);
      return {
        ...r,
        status: r.recorded_at == null ? "none" : now - r.recorded_at < ONLINE_SECONDS * 1000 ? "online" : "stale",
        snapshot: snap ? `/api/snapshots/${snap.id}/img` : null,
        snapshot_at: snap ? snap.created_at : null,
        consent_at: consent ? consent.created_at : null,
      };
    }),
  });
});

// história za jeden deň (dátum v lokálnom čase)
app.get("/api/history", (req, res) => {
  const employeeId = Number(req.query.employee);
  const date = String(req.query.date || "");
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "bad_request" });
  const start = localDateToUtcMs(date);
  const end = start + 24 * 3600 * 1000;
  const rows = db.prepare(
    "SELECT lat, lng, accuracy, speed, ip, recorded_at FROM positions WHERE employee_id = ? AND recorded_at >= ? AND recorded_at < ? ORDER BY recorded_at"
  ).all(employeeId, start, end);
  res.json(rows);
});

// zoznam nahlásených nehôd
app.get("/api/incidents", (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.employee_id, e.name, i.note, i.photo_file, i.audio_file, i.lat, i.lng, i.ip, i.created_at
    FROM incidents i JOIN employees e ON e.id = i.employee_id
    ORDER BY i.created_at DESC LIMIT 200
  `).all();
  res.json(rows.map((r) => ({
    ...r,
    photo: r.photo_file ? `/api/incidents/${r.id}/foto` : null,
    audio: r.audio_file ? `/api/incidents/${r.id}/zvuk` : null,
  })));
});
app.get("/api/incidents/:id/:kind", (req, res) => {
  const row = db.prepare("SELECT photo_file, audio_file FROM incidents WHERE id = ?").get(Number(req.params.id));
  if (!row) return res.sendStatus(404);
  const file = req.params.kind === "foto" ? row.photo_file : req.params.kind === "zvuk" ? row.audio_file : null;
  if (!file) return res.sendStatus(404);
  res.sendFile(path.join(INCIDENT_DIR, path.basename(file)));
});

// snímky z kamery za jeden deň
app.get("/api/snapshots", (req, res) => {
  const employeeId = Number(req.query.employee);
  const date = String(req.query.date || "");
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "bad_request" });
  const start = localDateToUtcMs(date), end = start + 24 * 3600 * 1000;
  const rows = db.prepare("SELECT id, lat, lng, created_at FROM snapshots WHERE employee_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at DESC").all(employeeId, start, end);
  res.json(rows.map((r) => ({ ...r, url: `/api/snapshots/${r.id}/img` })));
});
app.get("/api/snapshots/:id/img", (req, res) => {
  const row = db.prepare("SELECT file FROM snapshots WHERE id = ?").get(Number(req.params.id));
  if (!row) return res.sendStatus(404);
  res.sendFile(path.join(SNAPSHOT_DIR, path.basename(row.file)));
});
function localDateToUtcMs(yyyyMmDd) {
  // nájdi UTC okamih, ktorý zodpovedá polnoci v Európe/Bratislava
  const guess = Date.parse(`${yyyyMmDd}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
  const h = Number(parts.find((p) => p.type === "hour").value) % 24;
  const m = Number(parts.find((p) => p.type === "minute").value);
  return guess - (h * 60 + m) * 60 * 1000;
}

app.get("/api/settings", (req, res) => res.json(getSettings()));
app.put("/api/settings", (req, res) => {
  const { work_start, work_end, work_days, camera, camera_interval } = req.body || {};
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!hhmm.test(work_start || "") || !hhmm.test(work_end || "")) return res.status(400).json({ error: "Čas zadajte vo formáte HH:MM" });
  if (work_start === work_end) return res.status(400).json({ error: "Začiatok a koniec pracovnej doby nemôžu byť rovnaké. Pre celodenné sledovanie zadajte 00:00 – 23:59." });
  const days = String(work_days || "").split(",").map((d) => d.trim()).filter((d) => /^[0-6]$/.test(d));
  if (!days.length) return res.status(400).json({ error: "Vyberte aspoň jeden pracovný deň." });
  setSetting("work_start", work_start);
  setSetting("work_end", work_end);
  setSetting("work_days", days.join(","));
  setSetting("camera", camera ? "1" : "0");
  setSetting("camera_interval", String(Math.max(20, Math.min(600, Number(camera_interval) || 60))));
  res.json(getSettings());
});

// ---------- údržba: mazanie starej histórie ----------
function cleanup() {
  db.prepare("DELETE FROM positions WHERE recorded_at < ?").run(Date.now() - KEEP_DAYS * 24 * 3600 * 1000);
  const oldSnaps = db.prepare("SELECT id, file FROM snapshots WHERE created_at < ?").all(Date.now() - SNAPSHOT_KEEP_DAYS * 24 * 3600 * 1000);
  for (const s of oldSnaps) {
    try { fs.unlinkSync(path.join(SNAPSHOT_DIR, path.basename(s.file))); } catch {}
    db.prepare("DELETE FROM snapshots WHERE id = ?").run(s.id);
  }
}
cleanup();
setInterval(cleanup, 6 * 3600 * 1000);

app.listen(PORT, () => console.log(`Beží na ${PUBLIC_URL} (port ${PORT})`));
