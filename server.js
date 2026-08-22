/**
 * Snapchat oto-accept — kontrol paneli sunucusu.
 * - Birden fazla hesap ekle/sil
 * - Kaç accept + kaç dakikada bir + headless ayarları
 * - Her hesabı kendi döngüsünde arka planda çalıştırır
 * - Canlı durum + log'u arayüze SSE ile akıtır
 * - Hata olursa ekran görüntüsü alır (bot.js), arayüzden görünür
 *
 * Çalıştır:  npm run ui    → http://localhost:3000
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const { execFile } = require("child_process");
const express = require("express");
const { runAccount, safeName, SESSIONS_ROOT } = require("./bot");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

// --------------------------------------------------------------- Durum ------
let accounts = load(ACCOUNTS_FILE, []); // [{id, username, password}]
let settings = load(SETTINGS_FILE, { maxAccepts: 0, intervalMinutes: 5, headless: false });
let running = false; // genel çalışma anahtarı
const statuses = {}; // id -> { status, accepted, lastRun, nextRunAt, lastError, active }
const browsers = {}; // id -> aktif Puppeteer browser (Durdur'da kapatmak için)
const frames = {}; // id -> son önizleme karesi (JPEG Buffer)
const sseClients = new Set();

// Bir tarayıcıyı SÜREÇ AĞACIYLA birlikte zorla kapatır (Windows: taskkill /T /F).
function killBrowser(b) {
  if (!b) return;
  let pid;
  try {
    const proc = b.process && b.process();
    pid = proc && proc.pid;
  } catch {}
  try {
    b.close().catch(() => {});
  } catch {}
  if (pid) {
    if (process.platform === "win32") {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => {});
    } else {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
}

function load(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function persistAccounts() {
  save(ACCOUNTS_FILE, accounts);
}
function persistSettings() {
  save(SETTINGS_FILE, settings);
}

function ensureStatus(id) {
  if (!statuses[id]) {
    statuses[id] = {
      status: "idle",
      accepted: 0,
      lastRun: null,
      nextRunAt: null,
      lastError: null,
      active: false,
    };
  }
  return statuses[id];
}
accounts.forEach((a) => ensureStatus(a.id));

// --------------------------------------------------------------- SSE --------
function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) res.write(data);
}
function pushLog(id, line) {
  broadcast("log", { id, line, ts: Date.now() });
}
function setStatus(id, patch) {
  const st = ensureStatus(id);
  Object.assign(st, patch);
  broadcast("status", { id, ...st });
}

// Arayüze giden hesap görünümü (şifreyi maskeler)
function accountView(a) {
  const st = ensureStatus(a.id);
  return {
    id: a.id,
    username: a.username,
    hasPassword: !!a.password,
    ...st,
  };
}
function fullState() {
  return {
    running,
    settings,
    accounts: accounts.map(accountView),
  };
}

// --------------------------------------------------------- Zamanlayıcı ------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bekleme sırasında Stop'a tepki verebilmek için parça parça bekler.
async function interruptibleWait(id, ms) {
  const st = ensureStatus(id);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!running || !st.active) return;
    await sleep(1000);
  }
}

async function accountLoop(acc) {
  const st = ensureStatus(acc.id);
  st.active = true;

  while (running && st.active) {
    setStatus(acc.id, { status: "running", accepted: 0, lastError: null });
    pushLog(acc.id, `=== Tur başlıyor (${acc.username}) ===`);

    try {
      const res = await runAccount({
        username: acc.username,
        password: acc.password,
        headless: settings.headless,
        maxAccepts: settings.maxAccepts,
        log: (line) => pushLog(acc.id, line),
        onAccept: (n) => setStatus(acc.id, { accepted: n }),
        onBrowser: (b) => {
          browsers[acc.id] = b;
          const pid = (() => {
            try {
              return b.process() && b.process().pid;
            } catch {
              return null;
            }
          })();
          pushLog(acc.id, "Tarayıcı açıldı (PID " + pid + ").");
        },
        onPreview: (buf) => {
          frames[acc.id] = buf; // /api/preview/:id bunu sunar
        },
      });

      // Durdurulduysa hata olarak işaretleme
      if (!running || !st.active) break;

      if (res.error) {
        setStatus(acc.id, {
          status: "error",
          lastError: res.error,
          lastRun: Date.now(),
          accepted: res.accepted,
        });
      } else if (!res.loggedIn) {
        setStatus(acc.id, {
          status: "error",
          lastError: "Giriş yapılamadı (captcha/doğrulama?)",
          lastRun: Date.now(),
        });
      } else {
        setStatus(acc.id, {
          status: "done",
          lastRun: Date.now(),
          accepted: res.accepted,
          lastError: null,
        });
        pushLog(acc.id, `Tur bitti: ${res.accepted} istek kabul edildi.`);
      }
    } catch (e) {
      if (running && st.active) {
        setStatus(acc.id, { status: "error", lastError: e.message, lastRun: Date.now() });
        pushLog(acc.id, "HATA: " + e.message);
      }
    } finally {
      delete browsers[acc.id];
      delete frames[acc.id]; // önizlemeyi temizle
    }

    if (!running || !st.active) break;

    const waitMs = Math.max(0, Number(settings.intervalMinutes) || 0) * 60000;
    const nextAt = Date.now() + waitMs;
    setStatus(acc.id, { status: "waiting", nextRunAt: nextAt });
    pushLog(acc.id, `Sonraki tur ${settings.intervalMinutes} dk sonra.`);
    await interruptibleWait(acc.id, waitMs);
  }

  setStatus(acc.id, { status: "stopped", nextRunAt: null });
}

function startAll() {
  if (running) return;
  running = true;
  broadcast("state", fullState());
  for (const acc of accounts) {
    const st = ensureStatus(acc.id);
    if (!st.active) accountLoop(acc); // await etme → paralel
  }
}

function stopAll() {
  running = false;
  for (const id of Object.keys(statuses)) statuses[id].active = false;
  // Açık tarayıcıları süreç ağacıyla HEMEN öldür (beklemeden)
  const ids = Object.keys(browsers);
  for (const id of ids) {
    killBrowser(browsers[id]);
    delete browsers[id];
    delete frames[id];
  }
  if (ids.length) console.log(`Durduruldu: ${ids.length} tarayıcı kapatıldı.`);
  broadcast("state", fullState());
}

// --------------------------------------------------------------- HTTP -------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/state", (req, res) => res.json(fullState()));

app.post("/api/accounts", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "username ve password gerekli" });

  // Aynı kullanıcı zaten varsa şifresini GÜNCELLE (silip eklemeye gerek yok)
  const existing = accounts.find(
    (a) => a.username.toLowerCase() === String(username).toLowerCase()
  );
  if (existing) {
    existing.password = password;
    persistAccounts();
    broadcast("state", fullState());
    return res.json({ ...accountView(existing), updated: true });
  }

  const acc = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), username, password };
  accounts.push(acc);
  ensureStatus(acc.id);
  persistAccounts();
  if (running) accountLoop(acc); // çalışıyorsak hemen döngüye al
  broadcast("state", fullState());
  res.json(accountView(acc));
});

app.delete("/api/accounts/:id", (req, res) => {
  const id = req.params.id;
  const st = statuses[id];
  if (st) st.active = false; // döngüsünü durdur
  if (browsers[id]) {
    killBrowser(browsers[id]);
    delete browsers[id];
  }
  delete frames[id];
  accounts = accounts.filter((a) => a.id !== id);
  delete statuses[id];
  persistAccounts();
  broadcast("state", fullState());
  res.json({ ok: true });
});

app.post("/api/settings", (req, res) => {
  const { maxAccepts, intervalMinutes, headless } = req.body || {};
  if (maxAccepts !== undefined) settings.maxAccepts = Math.max(0, parseInt(maxAccepts, 10) || 0);
  if (intervalMinutes !== undefined)
    settings.intervalMinutes = Math.max(0, parseFloat(intervalMinutes) || 0);
  if (headless !== undefined) settings.headless = !!headless;
  persistSettings();
  broadcast("state", fullState());
  res.json(settings);
});

app.post("/api/start", (req, res) => {
  startAll();
  res.json({ running });
});
app.post("/api/stop", (req, res) => {
  stopAll();
  res.json({ running });
});

// Canlı önizleme karesi (JPEG) — UI ~1 sn'de bir tazeler
app.get("/api/preview/:id", (req, res) => {
  const buf = frames[req.params.id];
  if (!buf) return res.status(404).end();
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "no-store");
  res.end(buf);
});

// Bir hesabın son ekran görüntüsü. Öncelik: hata > add friends paneli > başarı.
app.get("/api/screenshot/:id", (req, res) => {
  const acc = accounts.find((a) => a.id === req.params.id);
  if (!acc) return res.status(404).end();
  const dir = path.join(SESSIONS_ROOT, safeName(acc.username));
  const candidates = ["error.png", "addfriends.png", "sonuc.png"].map((f) => path.join(dir, f));
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) return res.status(404).end();
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(file);
});

// Canlı olay akışı (SSE)
app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("retry: 3000\n\n");
  sseClients.add(res);
  res.write(`event: state\ndata: ${JSON.stringify(fullState())}\n\n`);
  req.on("close", () => sseClients.delete(res));
});

http.createServer(app).listen(PORT, () => {
  console.log(`\n  Kontrol paneli:  http://localhost:${PORT}\n`);
});
