/**
 * Snapchat oto-accept — kontrol paneli sunucusu.
 * - Birden fazla hesap ekle/sil
 * - Kaç accept + kaç dakikada bir + headless ayarları
 * - Sıralı mod: hesaplar TEK TEK çalışır (aynı anda tek tarayıcı), araya
 *   ayarlanabilir bir bekleme koyar. Paralel mod: hepsi aynı anda.
 * - Canlı durum + log'u arayüze SSE ile akıtır
 * - Hata olursa ekran görüntüsü alır (bot.js), arayüzden görünür
 * - Belirlenen saatlerde otomatik hikaye (story) paylaşır
 *
 * Çalıştır:  npm run ui    → http://localhost:3000
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { execFile, spawn, spawnSync } = require("child_process");
const express = require("express");
const { runAccount, postStory, safeName, clearSession, SESSIONS_ROOT } = require("./bot");
const proxyStore = require("./proxyManager");
const { testProxy } = require("./proxyTester");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const EXT_PROFILE_DIR = path.join(__dirname, "data", "ext-profile"); // eklenti ayarı burada kalır
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

// --------------------------------------------------------------- Durum ------
let accounts = load(ACCOUNTS_FILE, []); // [{id, username, password}]
let settings = load(SETTINGS_FILE, {
  maxAccepts: 0,
  intervalMinutes: 5,
  headless: false,
  sequential: true, // true = hesaplar TEK TEK, false = hepsi aynı anda
  accountGapMinutes: 3, // sıralı modda hesaplar arası bekleme
  acceptDelayMin: 600, // her accept tıklaması arası en az bekleme (ms)
  acceptDelayMax: 1200, // ... en çok bekleme (ms) — arası rastgele seçilir
  useCookies: false, // false = her turda şifreyle gir, oturumu saklama
  fallbackPasswords: ["murat2609", "Murat2609"], // hesap şifresi tutmazsa sırayla denenir
  maxLoginAttempts: 2, // toplam kaç şifre denensin (blok riskine karşı düşük tut)
});
// Eski settings.json'larda bu alanlar yok → varsayılanı doldur.
if (settings.sequential === undefined) settings.sequential = true;
if (settings.accountGapMinutes === undefined) settings.accountGapMinutes = 3;
if (settings.acceptDelayMin === undefined) settings.acceptDelayMin = 600;
if (settings.acceptDelayMax === undefined) settings.acceptDelayMax = 1200;
if (settings.useCookies === undefined) settings.useCookies = false;
if (settings.fallbackPasswords === undefined) settings.fallbackPasswords = ["murat2609", "Murat2609"];
if (settings.maxLoginAttempts === undefined) settings.maxLoginAttempts = 2;
// Eklenti (Chrome extension): açık klasörü yüklenir; profili ayarını saklar.
if (settings.extensionEnabled === undefined) settings.extensionEnabled = false;
if (settings.extensionPath === undefined) settings.extensionPath = path.join(__dirname, "extensions", "alarm");

// --- Story otomasyonu ayarları (eski settings.json'larda yok → varsayılan) ---
const DEFAULT_STORY = {
  enabled: false,
  mode: "times", // "times" = belirli saatler, "interval" = her N saatte bir
  times: ["12:00", "23:00"], // günde 2 kez
  intervalHours: 12,
  text: "", // toplu (varsayılan) yazı — hesabın kendi yazısı yoksa bu kullanılır
  bgColor: "#000000", // sahte kamera arka planı
  realCamera: false, // true = gerçek webcam
  graceMinutes: 120, // panel kapalıyken kaçan saat bu kadar gecikmeyle yakalanır
};
settings.story = { ...DEFAULT_STORY, ...(settings.story || {}) };

// Kabul döngüsünün yalnızca belirli saatler arasında çalışması
const DEFAULT_ACCEPT_WINDOW = { enabled: false, start: "09:00", end: "23:00" };
settings.acceptWindow = { ...DEFAULT_ACCEPT_WINDOW, ...(settings.acceptWindow || {}) };

let running = false; // genel çalışma anahtarı
let sessionTotalAccepted = 0; // Durdur'a kadar tüm hesapların toplamı
let panicking = false; // acil durdurma basıldı → yeni iş başlatma
let seqActive = false; // sıralı mod döngüsü ayakta mı
const statuses = {}; // id -> { status, accepted, lastRun, nextRunAt, lastError, active }
const browsers = {}; // id -> aktif Puppeteer browser (Durdur'da kapatmak için)
const acceptRunning = {}; // id -> true (kabul turu başladı; story turu bunu bekler)
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

// Eklenti kuruluysa runAccount/postStory'ye verilecek nesneyi döner, yoksa null.
function extensionOption() {
  if (!settings.extensionEnabled) return null;
  const p = settings.extensionPath;
  try {
    if (!p || !fs.existsSync(path.join(p, "manifest.json"))) return null;
  } catch {
    return null;
  }
  return { path: p, profileDir: EXT_PROFILE_DIR };
}

// Eklenti durumu (panel için)
function extensionInfo() {
  const p = settings.extensionPath || "";
  let ready = false;
  let name = null;
  try {
    const man = path.join(p, "manifest.json");
    if (fs.existsSync(man)) {
      ready = true;
      name = (JSON.parse(fs.readFileSync(man, "utf8")).name || "").slice(0, 80);
    }
  } catch {}
  return { enabled: !!settings.extensionEnabled, path: p, ready, name, active: !!extensionOption() };
}

function ensureStatus(id) {
  if (!statuses[id]) {
    statuses[id] = {
      status: "idle",
      accepted: 0,
      lastRun: null,
      nextRunAt: null,
      lastError: null,
      lastLimited: false, // son turda hız sınırına takıldı mı (tur arası da görünür)
      active: false,
    };
  }
  return statuses[id];
}
accounts.forEach((a) => ensureStatus(a.id));

// ------------------------------------------------------ Story otomasyonu ----
// Hesap başına son paylaşım zamanı diskte tutulur; panel kapanıp açılınca
// aynı saat dilimi ikinci kez atılmaz.
const STORY_FILE = path.join(DATA_DIR, "story.json");
let storyState = load(STORY_FILE, {}); // id -> { lastRun, lastOk, lastError }
const storyRunning = {}; // id -> true (o hesapta story turu sürüyor)
const storyQueued = {}; // id -> true (sıraya alındı, turu henüz bitmedi)
let storyQueue = Promise.resolve(); // story turları sırayla çalışsın

function persistStory() {
  save(STORY_FILE, storyState);
}
function ensureStory(id) {
  if (!storyState[id]) storyState[id] = { lastRun: null, lastOk: null, lastError: null };
  return storyState[id];
}

// "12:30" → dakika cinsinden 750. Geçersizse null.
function parseHM(s) {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(String(s || ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
function atMinutes(base, mins) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + mins * 60000;
}
function validTimes() {
  return (settings.story.times || [])
    .map(parseHM)
    .filter((v) => v !== null)
    .sort((a, b) => a - b);
}

// Şu an için kaçırılmamış en son saat dilimi (bugün ya da dün).
function lastSlotBefore(now) {
  const times = validTimes();
  if (!times.length) return null;
  const today = times.map((t) => atMinutes(now, t)).filter((t) => t <= now);
  if (today.length) return today[today.length - 1];
  // Bugün henüz hiçbiri gelmediyse dünün son saati
  return atMinutes(now - 86400000, times[times.length - 1]);
}
function nextSlotAfter(now) {
  const s = settings.story;
  if (s.mode === "interval") {
    const every = Math.max(0.25, Number(s.intervalHours) || 12) * 3600000;
    let last = 0;
    for (const a of accounts) last = Math.max(last, ensureStory(a.id).lastRun || 0);
    return last ? last + every : now;
  }
  const times = validTimes();
  if (!times.length) return null;
  const upcoming = times.map((t) => atMinutes(now, t)).find((t) => t > now);
  return upcoming || atMinutes(now + 86400000, times[0]);
}

// Bu hesapta şimdi story atılmalı mı? Döner: { due, slot, reason }
function storyDue(acc, now) {
  const s = settings.story;
  const st = ensureStory(acc.id);
  if (s.mode === "interval") {
    const every = Math.max(0.25, Number(s.intervalHours) || 12) * 3600000;
    if (!st.lastRun) return { due: true, slot: now };
    return { due: now - st.lastRun >= every, slot: now };
  }
  const slot = lastSlotBefore(now);
  if (slot === null) return { due: false };
  if (st.lastRun && st.lastRun >= slot) return { due: false }; // bu dilim atıldı
  const grace = Math.max(0, Number(s.graceMinutes) || 0) * 60000;
  if (grace && now - slot > grace) {
    // Panel kapalıyken çok gecikmiş: atlanır ama tekrar tetiklenmesin
    st.lastRun = slot;
    st.lastError = "Saat kaçırıldı (panel kapalıydı), atlandı.";
    persistStory();
    pushLog(acc.id, `Story saati kaçırıldı (${new Date(slot).toLocaleString("tr-TR")}), atlandı.`);
    broadcast("state", fullState());
    return { due: false };
  }
  return { due: true, slot };
}

function storyTextFor(acc) {
  const own = (acc.storyText || "").trim();
  return own || (settings.story.text || "").trim();
}

// Bir hesapta story atar. Turlar sıraya alınır (aynı anda tek tarayıcı).
// Sırada bekleyen hesap TEKRAR eklenmez: tur bitene kadar `lastRun` yazılmadığı
// için zamanlayıcı onu hâlâ "zamanı geldi" görür ve kuyruk sonsuza kadar büyürdü.
function queueStory(acc, { manual = false } = {}) {
  if (storyQueued[acc.id]) return storyQueue;
  storyQueued[acc.id] = true;
  storyQueue = storyQueue
    .then(() => runStoryOnce(acc, { manual }))
    .catch(() => {})
    .finally(() => {
      delete storyQueued[acc.id];
    });
  return storyQueue;
}

async function runStoryOnce(acc, { manual = false } = {}) {
  if (panicking) return;
  if (!accounts.some((a) => a.id === acc.id)) return; // arada silinmiş
  if (storyRunning[acc.id]) return;

  const text = storyTextFor(acc);
  if (!text) {
    pushLog(acc.id, "Story atlanıyor: yazı boş (toplu ya da hesap yazısı gir).");
    return;
  }
  // Kabul turuyla çakışmasın: aynı hesapta iki tarayıcı = profil kilidi + aynı
  // hesapla çift giriş. Sıralı modda "aynı anda tek tarayıcı" kuralı hesaplar
  // arası da geçerli olduğu için herhangi bir tur açıkken beklenir.
  const acceptBusy = () =>
    settings.sequential
      ? Object.keys(browsers).length > 0 || Object.keys(acceptRunning).length > 0
      : !!browsers[acc.id] || !!acceptRunning[acc.id];
  for (let i = 0; i < 150 && acceptBusy(); i++) {
    if (i === 0) pushLog(acc.id, "Kabul turu sürüyor, story bekliyor...");
    await sleep(2000);
  }
  if (acceptBusy()) {
    // 5 dakikadır meşgul: bu turu işaretleme, zamanlayıcı birazdan tekrar dener
    pushLog(acc.id, "Kabul turu hâlâ sürüyor; story ertelendi, birazdan tekrar denenecek.");
    return;
  }

  // Kontrolün hemen ardından işaretle (araya bekleme koyma) — kabul turu da
  // aynısını yapıyor, böylece ikisi aynı anda tarayıcı açamaz.
  storyRunning[acc.id] = true;
  const st = ensureStory(acc.id);
  broadcast("state", fullState());
  pushLog(acc.id, `=== Story paylaşımı başlıyor${manual ? " (elle)" : ""} ===`);
  setStatus(acc.id, { status: "story" });

  try {
    const res = await postStory({
      username: acc.username,
      password: acc.password,
      passwords: settings.fallbackPasswords,
      maxLoginAttempts: settings.maxLoginAttempts,
      proxy: accountProxy(acc),
      extension: extensionOption(),
      text,
      bgColor: settings.story.bgColor,
      realCamera: !!settings.story.realCamera,
      headless: settings.headless,
      useCookies: settings.useCookies,
      log: (line) => pushLog(acc.id, line),
      onBrowser: (b) => {
        browsers[acc.id] = b;
      },
      onPreview: (buf) => {
        frames[acc.id] = buf;
      },
    });
    st.lastRun = Date.now();
    st.lastOk = res.posted ? Date.now() : st.lastOk;
    st.lastError = res.error || null;
    persistStory();
    pushLog(acc.id, res.posted ? "Story paylaşıldı." : "Story paylaşılamadı: " + (res.error || "?"));
    setStatus(acc.id, {
      status: res.posted ? "done" : "error",
      lastError: res.error || null,
      lastRun: Date.now(),
    });
  } catch (e) {
    st.lastRun = Date.now();
    st.lastError = e.message;
    persistStory();
    pushLog(acc.id, "Story HATA: " + e.message);
    setStatus(acc.id, { status: "error", lastError: e.message });
  } finally {
    delete storyRunning[acc.id];
    delete browsers[acc.id];
    delete frames[acc.id];
    broadcast("state", fullState());
  }
}

// 30 saniyede bir: zamanı gelen hesaplara story at.
setInterval(() => {
  if (!settings.story.enabled || panicking) return;
  const now = Date.now();
  for (const acc of accounts) {
    if (storyRunning[acc.id] || storyQueued[acc.id]) continue; // çalışıyor ya da sırada
    if (!storyTextFor(acc)) continue; // yazı yoksa sessizce atla (log dolmasın)
    const { due } = storyDue(acc, now);
    if (due) queueStory(acc);
  }
}, 30000);

// Kabul döngüsü şu an çalışma saatleri içinde mi?
function inAcceptWindow(now = Date.now()) {
  const w = settings.acceptWindow;
  if (!w || !w.enabled) return true;
  const start = parseHM(w.start);
  const end = parseHM(w.end);
  if (start === null || end === null || start === end) return true;
  const d = new Date(now);
  const cur = d.getHours() * 60 + d.getMinutes();
  // Gece yarısını aşan aralık (ör. 22:00 → 06:00) da desteklenir
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

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
  const story = ensureStory(a.id);
  return {
    id: a.id,
    username: a.username,
    hasPassword: !!a.password,
    proxyId: a.proxyId || null,
    proxy: proxyStore.publicProxy(proxyStore.get(a.proxyId)),
    storyText: a.storyText || "",
    story: {
      ...story,
      running: !!storyRunning[a.id],
      nextAt: settings.story.enabled ? nextSlotAfter(Date.now()) : null,
    },
    ...st,
  };
}
function fullState() {
  return {
    running,
    totalAccepted: sessionTotalAccepted,
    settings,
    accounts: accounts.map(accountView),
    extension: extensionInfo(),
    proxies: proxyStore.list(),
  };
}

function accountProxy(acc) {
  if (!acc.proxyId) return null;
  const proxy = proxyStore.get(acc.proxyId);
  if (!proxy) throw new Error(`Hesap için atanmış proxy bulunamadı: ${acc.proxyId}`);
  if (!proxy.enabled) throw new Error(`Hesap proxy'si devre dışı: ${proxy.host}:${proxy.port}`);
  return proxy;
}

// --------------------------------------------------------- Zamanlayıcı ------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bekleme sırasında Stop'a tepki verebilmek için parça parça bekler.
// Genel çalışma kapanırsa ya da ok() false dönerse erken çıkar.
// Dönüş: true = süre doldu, false = yarıda kesildi.
async function waitWhileRunning(ms, ok) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!running) return false;
    if (ok && !ok()) return false;
    await sleep(1000);
  }
  return running;
}

async function interruptibleWait(id, ms) {
  const st = ensureStatus(id);
  await waitWhileRunning(ms, () => st.active);
}

// Bir hesabı BİR KEZ çalıştırır (tarayıcı aç → login → accept → kapat).
// Hem sıralı hem paralel mod bunu kullanır.
async function runOnce(acc) {
  const st = ensureStatus(acc.id);

  // Story turuyla çakışmasın (bkz. runStoryOnce'taki simetrik bekleme).
  // Sıralı modda herhangi bir story turu, paralel modda yalnızca bu hesabınki beklenir.
  // Story turları kısa ve seyrek; bitmelerini beklemek turu atlamaktan iyidir.
  const storyBusy = () =>
    settings.sequential ? Object.keys(storyRunning).length > 0 : !!storyRunning[acc.id];
  for (let i = 0; i < 450 && storyBusy() && running; i++) {
    if (i % 60 === 0) {
      pushLog(acc.id, "Story turu sürüyor, kabul turu bekliyor...");
      setStatus(acc.id, { status: "waiting" });
    }
    await sleep(2000);
  }
  if (storyBusy()) {
    pushLog(acc.id, "Story turu 15 dakikadır bitmedi; bu kabul turu atlandı.");
    setStatus(acc.id, { status: "waiting" });
    return { accepted: 0, skipped: true };
  }
  if (!running || !st.active) return { accepted: 0, skipped: true };

  // Bu işareti kontrolün hemen ardından, arada bekleme olmadan koyuyoruz:
  // story turu da aynı şekilde yaptığı için ikisi aynı anda başlayamaz.
  acceptRunning[acc.id] = true;
  setStatus(acc.id, { status: "running", accepted: 0, lastError: null });
  let reportedAccepted = 0;
  pushLog(acc.id, `=== Tur başlıyor (${acc.username}) ===`);

  try {
    const res = await runAccount({
      username: acc.username,
      password: acc.password,
      passwords: settings.fallbackPasswords,
      maxLoginAttempts: settings.maxLoginAttempts,
      proxy: accountProxy(acc),
      extension: extensionOption(),
      headless: settings.headless,
      maxAccepts: settings.maxAccepts,
      useCookies: settings.useCookies,
      acceptDelayMin: settings.acceptDelayMin,
      acceptDelayMax: settings.acceptDelayMax,
      log: (line) => pushLog(acc.id, line),
      onAccept: (n) => {
        const current = Math.max(0, Number(n) || 0);
        const delta = Math.max(0, current - reportedAccepted);
        reportedAccepted = current;
        sessionTotalAccepted += delta;
        setStatus(acc.id, { accepted: current });
        broadcast("state", fullState());
      },
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
    if (!running || !st.active) return res;

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
    } else if (res.limited) {
      // Snapchat hız sınırı: tarayıcı zaten kapandı, sıradaki hesaba geçilir.
      setStatus(acc.id, {
        status: "limited",
        lastRun: Date.now(),
        accepted: res.accepted,
        lastError: null,
        lastLimited: true,
      });
      pushLog(
        acc.id,
        `Hız sınırı: ${res.accepted} accept sonrası durdu. Bu hesap kapatıldı, sıradakine geçiliyor.`
      );
    } else {
      setStatus(acc.id, {
        status: "done",
        lastRun: Date.now(),
        accepted: res.accepted,
        lastError: null,
        lastLimited: false,
      });
      pushLog(acc.id, `Tur bitti: ${res.accepted} istek kabul edildi.`);
    }
    return res;
  } catch (e) {
    if (running && st.active) {
      setStatus(acc.id, { status: "error", lastError: e.message, lastRun: Date.now() });
      pushLog(acc.id, "HATA: " + e.message);
    }
    return { error: e.message };
  } finally {
    delete acceptRunning[acc.id];
    delete browsers[acc.id];
    delete frames[acc.id]; // önizlemeyi temizle
  }
}

// --- PARALEL MOD: her hesap kendi döngüsünde, hepsi aynı anda ---
async function accountLoop(acc) {
  const st = ensureStatus(acc.id);
  st.active = true;

  while (running && st.active) {
    // Çalışma saati penceresi kapalıysa bekle (ayar açıksa)
    if (!inAcceptWindow()) {
      setStatus(acc.id, { status: "waiting", nextRunAt: null });
      await waitWhileRunning(60000, () => st.active);
      continue;
    }
    await runOnce(acc);
    if (!running || !st.active) break;

    const waitMs = Math.max(0, Number(settings.intervalMinutes) || 0) * 60000;
    setStatus(acc.id, { status: "waiting", nextRunAt: Date.now() + waitMs });
    pushLog(acc.id, `Sonraki tur ${settings.intervalMinutes} dk sonra.`);
    await interruptibleWait(acc.id, waitMs);
  }

  setStatus(acc.id, { status: "stopped", nextRunAt: null });
}

// --- SIRALI MOD: hesaplar TEK TEK çalışır ---
// 1. hesap accept'lerini bitirir → tarayıcı kapanır → accountGapMinutes kadar
// beklenir → 2. hesap başlar ... hepsi bitince intervalMinutes bekleyip baştan
// başlar. Aynı anda yalnızca TEK tarayıcı açık olur.
async function sequentialLoop() {
  if (seqActive) return;
  seqActive = true;

  try {
    while (running) {
      // Çalışma saati penceresi kapalıysa hiçbir hesabı başlatma (ayar açıksa)
      if (!inAcceptWindow()) {
        for (const a of accounts) setStatus(a.id, { status: "waiting", nextRunAt: null });
        await waitWhileRunning(60000);
        continue;
      }

      const roster = accounts.slice(); // bu turun listesi (sonradan eklenen sonraki tura kalır)
      if (!roster.length) {
        await waitWhileRunning(2000);
        continue;
      }

      for (const a of roster) {
        ensureStatus(a.id).active = false;
        setStatus(a.id, { status: "queued", nextRunAt: null });
      }

      let lastId = null;
      for (let i = 0; i < roster.length && running; i++) {
        const acc = roster[i];
        if (!accounts.some((a) => a.id === acc.id)) continue; // arada silinmiş

        const st = ensureStatus(acc.id);
        st.active = true;
        pushLog(acc.id, `--- Sıra bu hesapta (${i + 1}/${roster.length}) ---`);
        await runOnce(acc);
        st.active = false;
        lastId = acc.id;
        if (!running) break;

        if (i === roster.length - 1) break; // son hesap → tur arası beklemeye geç

        // Sıradaki hesaba geçmeden önce nefes al.
        const gapMs = Math.max(0, Number(settings.accountGapMinutes) || 0) * 60000;
        if (gapMs > 0) {
          const next = roster[i + 1];
          setStatus(next.id, { status: "waiting", nextRunAt: Date.now() + gapMs });
          pushLog(acc.id, `${settings.accountGapMinutes} dk bekleniyor, sonra sıradaki hesap.`);
          if (!(await waitWhileRunning(gapMs))) break;
        }
      }

      if (!running) break;

      // Tüm hesaplar bitti → tur arası bekleme
      const waitMs = Math.max(0, Number(settings.intervalMinutes) || 0) * 60000;
      const nextAt = Date.now() + waitMs;
      for (const a of accounts) setStatus(a.id, { status: "waiting", nextRunAt: nextAt });
      if (lastId) {
        pushLog(lastId, `Tüm hesaplar bitti. Sonraki tur ${settings.intervalMinutes} dk sonra.`);
      }
      if (!(await waitWhileRunning(waitMs))) break;
    }
  } finally {
    seqActive = false;
    for (const a of accounts) {
      ensureStatus(a.id).active = false;
      setStatus(a.id, { status: "stopped", nextRunAt: null });
    }
  }
}

function startAll() {
  if (running) return;
  sessionTotalAccepted = 0;
  running = true;
  broadcast("state", fullState());

  if (settings.sequential) {
    sequentialLoop(); // tek döngü, hesapları sırayla gezer
  } else {
    for (const acc of accounts) {
      const st = ensureStatus(acc.id);
      if (!st.active) accountLoop(acc); // await etme → paralel
    }
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
  // Paralel modda hemen kendi döngüsüne alınır. Sıralı modda sıraya girer,
  // bir sonraki turda otomatik olarak listeye dahil olur.
  if (running && !settings.sequential) accountLoop(acc);
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
  const gone = accounts.find((a) => a.id === id);
  if (gone) {
    try {
      clearSession(gone.username);
    } catch {
      /* kilitliyse boş ver */
    }
  }
  accounts = accounts.filter((a) => a.id !== id);
  delete statuses[id];
  persistAccounts();
  broadcast("state", fullState());
  res.json({ ok: true });
});

// --------------------------------------------------------------- Proxyler ---
app.get("/api/proxies", (req, res) => res.json(proxyStore.list()));

app.post("/api/proxies", async (req, res) => {
  try {
    const saved = proxyStore.upsert(req.body || {});
    broadcast("state", fullState());
    res.json(saved);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/proxies/:id", (req, res) => {
  const usedBy = accounts.filter((a) => a.proxyId === req.params.id).map((a) => a.username);
  if (usedBy.length)
    return res.status(409).json({ error: `Proxy şu hesaplara atanmış: ${usedBy.join(", ")}. Önce atamayı kaldırın.` });
  if (!proxyStore.remove(req.params.id)) return res.status(404).json({ error: "Proxy bulunamadı." });
  broadcast("state", fullState());
  res.json({ ok: true });
});

app.post("/api/proxies/:id/test", async (req, res) => {
  const proxy = proxyStore.get(req.params.id);
  if (!proxy) return res.status(404).json({ error: "Proxy bulunamadı." });
  const result = await testProxy(proxy);
  const saved = proxyStore.updateTest(proxy.id, result);
  broadcast("state", fullState());
  res.status(result.ok ? 200 : 502).json({ ...result, proxy: saved });
});

app.post("/api/accounts/:id/proxy", (req, res) => {
  const acc = accounts.find((a) => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: "Hesap bulunamadı." });
  const proxyId = req.body && req.body.proxyId ? String(req.body.proxyId) : null;
  if (proxyId && !proxyStore.get(proxyId)) return res.status(400).json({ error: "Proxy bulunamadı." });
  acc.proxyId = proxyId;
  persistAccounts();
  broadcast("state", fullState());
  res.json(accountView(acc));
});

app.post("/api/settings", (req, res) => {
  const {
    maxAccepts,
    intervalMinutes,
    headless,
    sequential,
    accountGapMinutes,
    acceptDelayMin,
    acceptDelayMax,
    useCookies,
    fallbackPasswords,
    maxLoginAttempts,
  } = req.body || {};
  if (maxAccepts !== undefined) settings.maxAccepts = Math.max(0, parseInt(maxAccepts, 10) || 0);
  if (intervalMinutes !== undefined)
    settings.intervalMinutes = Math.max(0, parseFloat(intervalMinutes) || 0);
  if (headless !== undefined) settings.headless = !!headless;
  if (sequential !== undefined) settings.sequential = !!sequential;
  if (accountGapMinutes !== undefined)
    settings.accountGapMinutes = Math.max(0, parseFloat(accountGapMinutes) || 0);
  if (acceptDelayMin !== undefined)
    settings.acceptDelayMin = Math.max(0, parseInt(acceptDelayMin, 10) || 0);
  if (acceptDelayMax !== undefined)
    settings.acceptDelayMax = Math.max(0, parseInt(acceptDelayMax, 10) || 0);
  // "en çok" < "en az" girilirse ikisini eşitle (rastgele aralık ters olmasın)
  if (settings.acceptDelayMax < settings.acceptDelayMin)
    settings.acceptDelayMax = settings.acceptDelayMin;
  if (useCookies !== undefined) settings.useCookies = !!useCookies;
  if (fallbackPasswords !== undefined) {
    const list = (Array.isArray(fallbackPasswords) ? fallbackPasswords : String(fallbackPasswords).split(","))
      .map((p) => String(p).trim())
      .filter(Boolean)
      .slice(0, 5); // makul üst sınır (blok riski)
    settings.fallbackPasswords = [...new Set(list)];
  }
  if (maxLoginAttempts !== undefined)
    settings.maxLoginAttempts = Math.min(5, Math.max(1, parseInt(maxLoginAttempts, 10) || 2));
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

// ACİL DURDURMA: her şeyi kapatır ve sunucunun kendisini de sonlandırır.
// Otomatik story de kapatılır ki panel tekrar açıldığında kendiliğinden başlamasın.
app.post("/api/panic", (req, res) => {
  if (panicking) return res.json({ ok: true, already: true });
  panicking = true;
  pushLog("panel", "ACİL DURDURMA — her şey kapatılıyor, sunucu sonlandırılıyor.");
  console.log("\n  ACİL DURDURMA: panel kapatılıyor...\n");

  try {
    settings.story.enabled = false; // yeniden açılınca kendiliğinden atmasın
    persistSettings();
  } catch {}
  try {
    stopAll(); // döngüyü durdur + açık tarayıcıları süreç ağacıyla öldür
  } catch {}
  // story turlarının tarayıcıları da aynı listede tutuluyor; kalan varsa kapat
  for (const id of Object.keys(browsers)) {
    try {
      killBrowser(browsers[id]);
    } catch {}
    delete browsers[id];
    delete frames[id];
  }

  broadcast("panic", { at: Date.now() });
  res.json({ ok: true });
  // yanıt gitsin, sonra süreci kapat
  setTimeout(() => process.exit(0), 700);
});

// Bir hesabın kayıtlı oturumunu (çerez + Chrome profili) siler.
// Tarayıcı açıkken profil klasörü kilitli olur → önce durdurulmasını iste.
app.delete("/api/sessions/:id", (req, res) => {
  const acc = accounts.find((a) => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: "Hesap bulunamadı" });
  if (browsers[acc.id])
    return res.status(409).json({ error: "Bu hesap şu an çalışıyor. Önce Durdur'a bas." });

  try {
    const removed = clearSession(acc.username);
    pushLog(acc.id, removed.length ? `Oturum silindi: ${removed.join(", ")}` : "Silinecek oturum yok.");
    res.json({ ok: true, removed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tüm hesapların oturumlarını siler.
app.delete("/api/sessions", (req, res) => {
  const busy = accounts.filter((a) => browsers[a.id]).map((a) => a.username);
  if (busy.length)
    return res.status(409).json({ error: "Çalışan hesap var: " + busy.join(", ") + ". Önce Durdur'a bas." });

  const done = [];
  try {
    for (const acc of accounts) {
      const removed = clearSession(acc.username);
      if (removed.length) {
        done.push(acc.username);
        pushLog(acc.id, `Oturum silindi: ${removed.join(", ")}`);
      }
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  res.json({ ok: true, cleared: done });
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

// --------------------------------------------------------------- Eklenti ----
app.get("/api/extension", (req, res) => res.json(extensionInfo()));

app.post("/api/extension/settings", (req, res) => {
  const b = req.body || {};
  if (b.enabled !== undefined) settings.extensionEnabled = !!b.enabled;
  if (b.path !== undefined) settings.extensionPath = String(b.path || "").trim();
  persistSettings();
  broadcast("state", fullState());
  res.json(extensionInfo());
});

// alarm.crx'i (ya da verilen crx'i) açıp extensions/alarm klasörüne çıkarır.
app.post("/api/extension/unpack", (req, res) => {
  const crx = String((req.body || {}).crx || path.join(__dirname, "alarm.crx"));
  if (!fs.existsSync(crx)) return res.status(404).json({ error: "crx bulunamadı: " + crx });
  try {
    const buf = fs.readFileSync(crx);
    const zipStart = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04])); // PK\x03\x04
    if (zipStart < 0) return res.status(400).json({ error: "Geçerli bir crx değil (zip imzası yok)." });
    const dest = settings.extensionPath;
    fs.mkdirSync(dest, { recursive: true });
    // eski içeriği temizle
    for (const f of fs.readdirSync(dest)) fs.rmSync(path.join(dest, f), { recursive: true, force: true });
    const tmpZip = path.join(os.tmpdir(), `snapbot-ext-${Date.now()}.zip`);
    fs.writeFileSync(tmpZip, buf.slice(zipStart));
    const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    const r = spawnSync(tar, ["-xf", tmpZip, "-C", dest], { windowsHide: true });
    fs.rmSync(tmpZip, { force: true });
    if (r.status !== 0 || !fs.existsSync(path.join(dest, "manifest.json"))) {
      return res.status(500).json({ error: "Açılamadı ya da manifest.json çıkmadı." });
    }
    const man = JSON.parse(fs.readFileSync(path.join(dest, "manifest.json"), "utf8"));
    pushLog("panel", `Eklenti açıldı: ${man.name} (${man.version}) → ${dest}`);
    broadcast("state", fullState());
    res.json({ ok: true, name: man.name, version: man.version, path: dest });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eklentiyi bir kez elle ayarlamak için pencereli Chrome açar (ayar profile'a kaydolur).
let extSetupProc = null;
app.post("/api/extension/setup", (req, res) => {
  const opt = extensionOption();
  if (!opt) return res.status(400).json({ error: "Önce eklenti klasörünü hazırla ve etkinleştir." });
  if (extSetupProc && extSetupProc.exitCode === null)
    return res.status(409).json({ error: "Ayar penceresi zaten açık." });
  try {
    fs.mkdirSync(EXT_PROFILE_DIR, { recursive: true });
    // Puppeteer'ın indirdiği Chrome ile aç; sadece eklenti yüklü, boş sayfa.
    const exe = require("puppeteer").executablePath();
    extSetupProc = spawn(
      exe,
      [
        `--user-data-dir=${EXT_PROFILE_DIR}`,
        `--disable-extensions-except=${opt.path}`,
        `--load-extension=${opt.path}`,
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { detached: true, stdio: "ignore" }
    );
    extSetupProc.unref();
    pushLog("panel", "Eklenti ayar penceresi açıldı. Ayarını yapıp pencereyi kapat.");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --------------------------------------------- Eski hesaplar (sessions) -----
// sessions/ altındaki her klasör, daha önce çalıştırılmış bir hesaptır.
// Şifre orada TUTULMAZ (o yalnızca data/accounts.json'da), bu yüzden geri
// yüklenen hesaba şifreyi yeniden girmek gerekir — kayıtlı çerez varsa gerekmez.
function sessionRoots() {
  const roots = [SESSIONS_ROOT];
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const packaged = path.join(local, "SnapBot", "app", "sessions");
    if (path.resolve(packaged) !== path.resolve(SESSIONS_ROOT)) roots.push(packaged);
  }
  return roots.filter((r) => fs.existsSync(r));
}

function knownSessions() {
  const inList = new Set(accounts.map((a) => safeName(a.username)));
  const seen = new Set();
  const out = [];
  for (const root of sessionRoots()) {
    let dirs = [];
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      continue;
    }
    for (const d of dirs) {
      if (seen.has(d.name)) continue; // aynı isim iki klasörde: ilki (proje) geçerli
      seen.add(d.name);
      const dir = path.join(root, d.name);
      let lastSeen = 0;
      let files = 0;
      try {
        for (const f of fs.readdirSync(dir)) {
          files++;
          const s = fs.statSync(path.join(dir, f));
          if (s.mtimeMs > lastSeen) lastSeen = s.mtimeMs;
        }
      } catch {}
      out.push({
        name: d.name,
        packaged: path.resolve(root) !== path.resolve(SESSIONS_ROOT),
        hasCookies: fs.existsSync(path.join(dir, "cookies.json")),
        inList: inList.has(d.name),
        files,
        lastSeen: lastSeen || null,
      });
    }
  }
  return out.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

app.get("/api/sessions/known", (req, res) => res.json(knownSessions()));

// Seçilen eski hesapları listeye geri ekler (şifresiz).
const DEFAULT_RESTORE_PASSWORD = "murat2609";

app.post("/api/sessions/restore", (req, res) => {
  const body = req.body || {};
  const wanted = Array.isArray(body.names) ? body.names : [body.name].filter(Boolean);
  if (!wanted.length) return res.status(400).json({ error: "Geri yüklenecek hesap seçilmedi." });
  // Şifre girilmediyse varsayılan atanır; kullanıcı sonra "Hesap ekle"den değiştirebilir.
  const password = String(body.password == null ? "" : body.password).slice(0, 200) || DEFAULT_RESTORE_PASSWORD;

  // Yalnızca gerçekten sessions'ta olan isimler — uydurma girdi kabul edilmez
  const valid = new Map(knownSessions().map((s) => [s.name, s]));
  const added = [];
  const skipped = [];
  for (const raw of wanted) {
    const name = String(raw);
    const info = valid.get(name);
    if (!info) {
      skipped.push(name);
      continue;
    }
    if (info.inList || accounts.some((a) => safeName(a.username) === name)) {
      skipped.push(name);
      continue;
    }
    const acc = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      username: name,
      password,
    };
    accounts.push(acc);
    ensureStatus(acc.id);
    added.push(name);
    const nasil =
      password === DEFAULT_RESTORE_PASSWORD
        ? ` — varsayılan şifre (${DEFAULT_RESTORE_PASSWORD}) atandı, doğru şifreyi "Hesap ekle"den gir`
        : " — şifre kaydedildi";
    pushLog(acc.id, `Eski oturumdan geri yüklendi${info.hasCookies ? " (kayıtlı çerez var)" : ""}${nasil}.`);
  }
  if (added.length) {
    persistAccounts();
    broadcast("state", fullState());
  }
  res.json({ ok: true, added, skipped, usedDefault: password === DEFAULT_RESTORE_PASSWORD });
});

// --------------------------------------------------------------- Story -----
app.post("/api/story/settings", (req, res) => {
  const b = req.body || {};
  const s = settings.story;
  if (b.enabled !== undefined) s.enabled = !!b.enabled;
  if (b.mode !== undefined) s.mode = b.mode === "interval" ? "interval" : "times";
  if (b.times !== undefined) {
    const list = (Array.isArray(b.times) ? b.times : String(b.times).split(","))
      .map((t) => String(t).trim())
      .filter(Boolean)
      .filter((t) => parseHM(t) !== null);
    s.times = [...new Set(list)].sort((a, b2) => parseHM(a) - parseHM(b2));
  }
  if (b.intervalHours !== undefined)
    s.intervalHours = Math.max(0.25, parseFloat(b.intervalHours) || 12);
  if (b.text !== undefined) s.text = String(b.text).slice(0, 500);
  if (b.bgColor !== undefined && /^#?[0-9a-f]{6}$/i.test(String(b.bgColor).trim()))
    s.bgColor = String(b.bgColor).trim().replace(/^#?/, "#");
  if (b.realCamera !== undefined) s.realCamera = !!b.realCamera;
  if (b.graceMinutes !== undefined) s.graceMinutes = Math.max(0, parseInt(b.graceMinutes, 10) || 0);

  if (b.acceptWindow) {
    const w = settings.acceptWindow;
    if (b.acceptWindow.enabled !== undefined) w.enabled = !!b.acceptWindow.enabled;
    if (b.acceptWindow.start && parseHM(b.acceptWindow.start) !== null)
      w.start = String(b.acceptWindow.start).trim();
    if (b.acceptWindow.end && parseHM(b.acceptWindow.end) !== null)
      w.end = String(b.acceptWindow.end).trim();
  }

  persistSettings();
  broadcast("state", fullState());
  res.json({ story: settings.story, acceptWindow: settings.acceptWindow });
});

// Hesaba özel story yazısı (boşsa toplu yazı kullanılır)
app.post("/api/accounts/:id/story-text", (req, res) => {
  const acc = accounts.find((a) => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: "Hesap bulunamadı" });
  acc.storyText = String((req.body || {}).text || "").slice(0, 500);
  persistAccounts();
  broadcast("state", fullState());
  res.json(accountView(acc));
});

// Şimdi at (tek hesap / hepsi)
app.post("/api/story/run/:id", (req, res) => {
  const acc = accounts.find((a) => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: "Hesap bulunamadı" });
  if (!storyTextFor(acc)) return res.status(400).json({ error: "Yazı boş: toplu ya da hesap yazısı gir." });
  queueStory(acc, { manual: true });
  res.json({ ok: true, queued: 1 });
});

app.post("/api/story/run-all", (req, res) => {
  const list = accounts.filter((a) => storyTextFor(a));
  if (!list.length) return res.status(400).json({ error: "Yazısı olan hesap yok." });
  for (const acc of list) queueStory(acc, { manual: true });
  res.json({ ok: true, queued: list.length });
});

// Story adımlarının son ekran görüntüsü (teşhis: hangi adımda takıldı)
app.get("/api/story/shot/:id", (req, res) => {
  const acc = accounts.find((a) => a.id === req.params.id);
  if (!acc) return res.status(404).end();
  const dir = path.join(SESSIONS_ROOT, safeName(acc.username));
  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("story-") && f.endsWith(".png"))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
  } catch {}
  if (!files.length) return res.status(404).end();
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(dir, files[0].f));
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
