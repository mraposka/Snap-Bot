/**
 * Snapchat Web otomasyon motoru (tek kaynak).
 * runAccount() bir hesabı: login eder → snapchat.com/web'e gider →
 * karşılama ("Welcome to Snapchat for Web!") penceresini geçer →
 * bildirim pop-up'ını kapatır → Add Friends açar → istekleri kabul eder.
 *
 * Hem CLI (login.js) hem de arayüz (server.js) bu modülü kullanır.
 *
 * XPath / metin ayarlarını buradan düzenle.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { launchBrowser } = require("./browserLauncher");

puppeteer.use(StealthPlugin());

// ---------------------------------------------------------------- Ayarlar ---
const LOGIN_URL = "https://accounts.snapchat.com/v2/login";
const WEB_APP_URL = "https://www.snapchat.com/web";
const WELCOME_RE = /accounts\.snapchat\.com\/v2\/welcome/i;

const USER_SELECTORS = [
  'input[name="username"]',
  'input[type="text"]',
  'input[type="email"]',
  "#username",
];
const PASS_SELECTORS = [
  'input[name="password"]',
  'input[type="password"]',
  "#password",
];

// "Add Friends" panelini açan buton. Otomatik bulunamazsa buraya XPath yaz.
const ADD_FRIENDS_XPATH = "/html/body/main/div[1]/div[2]/div[1]/div[3]/div[1]/button";

// "View more" — tıklayınca istek listesi genişler, kabul daha hızlı ilerler.
const VIEW_MORE_XPATH =
  "/html/body/main/div[1]/div[3]/div/div[2]/div/div/div[2]/div[1]/div/div/div[6]";

const ACCEPT_TEXTS = ["accept", "kabul et", "kabul", "onayla"];
const COOKIE_ACCEPT_TEXTS = [
  "accept all",
  "tümünü kabul et",
  "tumunu kabul et",
  "alle akzeptieren",
  "accepter tout",
];
const ADD_FRIENDS_TEXTS = [
  "add friends",
  "arkadaş ekle",
  "arkadas ekle",
  "added me",
  "beni ekleyenler",
];

// Snapchat hız sınırına takıldığında sayfada beliren uyarı.
// Görülürse tıklamayı DURDURUYORUZ — ısrar etmek hesabı riske atar.
const RATE_LIMIT_TEXTS = [
  "limit reached",
  "try again in a few minutes",
  "sınıra ulaş",
  "sinira ulas",
  "limite ulaş",
  "birkaç dakika sonra",
  "birkac dakika sonra",
];

// "Welcome to Snapchat for Web!" karşılama penceresi (bazen çıkıyor).
// Başlığından tanınır; içindeki "Next" butonuna tıklanarak geçilir.
const WELCOME_DIALOG_RE =
  "welcome to snapchat for web|snapchat for web'e hoş geldin|web için snapchat'e hoş geldin";
const WELCOME_NEXT_TEXTS = [
  "next",
  "ileri",
  "sonraki",
  "devam",
  "continue",
  "got it",
  "anladım",
  "anladim",
  "tamam",
  "ok",
  "done",
];

// ------------------------------------------------------- Story ayarları -----
// Snapchat web arayüzü değişirse buradaki metin/etiketleri güncelle.
// Her adımda önce etiket (aria-label/title), sonra metin, sonra konum denenir.

// Adımların XPath'leri — ASIL YÖNTEM BUDUR. Snapchat arayüzü değişirse
// tarayıcıda öğeye sağ tık → Kopyala → XPath kopyala yapıp buraya yapıştır.
// Bulunamazsa aşağıdaki etiket/metin listelerine düşülür.
const STORY_XPATH = {
  // Ortadaki kamera ikonu
  camera: "/html/body/main/div[1]/div[3]/div/div/div/div[1]/div[1]/div/div/div/div/div/button",
  // Fotoğrafı çeken düğme (kısmi yol: sayfanın herhangi bir yerinde aranır)
  capture: "/div/div[2]/div/div[4]/div/div/button[1]",
  // Fotoğrafın üstüne yazı ekleyen "T" düğmesi
  textTool:
    "/html/body/main/div[1]/div[3]/div/div/div/div[1]/div[1]/div/div/div/div/div[2]/div[1]/div[1]/div/div/button",
  // Alıcı listesini açan Gönder düğmesi
  send: "/html/body/main/div[1]/div[3]/div/div/div/div[1]/div[1]/div/div/div/div/div[2]/div[2]/button[2]",
  // Listedeki "Hikayem" satırı
  myStory:
    "/html/body/main/div[1]/div[3]/div/div/div/div[1]/div[1]/div/div/div/div/div[1]/div/form/div/ul/li[2]/div",
  // Alttaki "Gönder" düğmesi (hikayeye yollar)
  sendStory:
    "/html/body/main/div[1]/div[3]/div/div/div/div[1]/div[1]/div/div/div/div/div[1]/div/form/div[2]/button",
};

// Ortadaki "Kameraya tıkla" düğmesi
const CAMERA_LABELS = ["camera", "kamera", "take snap", "new snap", "snap çek"];
const CAMERA_HINT_TEXTS = [
  "kameraya tıkla",
  "kameraya tikla",
  "click camera",
  "snap'leri göndermek",
  "to send snaps",
];
// Snapchat'in kendi "Kamerana erişmek için izin isteyeceğiz" penceresi
const PERMISSION_OK_TEXTS = [
  "tamamdır",
  "tamamdir",
  "got it",
  "anladım",
  "anladim",
  "tamam",
  "devam",
  "continue",
  "izin ver",
  "allow",
];
// Fotoğrafı çeken büyük yuvarlak düğme (alt orta)
const CAPTURE_LABELS = ["capture", "shutter", "take photo", "take snap", "fotoğraf", "çek"];
// Fotoğrafın üstüne yazı ekleyen "T" düğmesi (üst sağ)
const TEXT_TOOL_LABELS = ["text", "add text", "caption", "yazı", "yazi", "metin"];
// Gönder düğmesi ve hikaye satırı
const SEND_TEXTS = ["gönder", "gonder", "send", "send to", "gönder ►"];
const MY_STORY_TEXTS = ["hikayem", "hikâyem", "my story", "benim hikayem"];

const SESSIONS_ROOT = path.join(__dirname, "sessions");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Snapchat oturum çerezlerinin temizleneceği origin'ler (eklenti modunda login
// saklanmasın diye her turun başında bunlar silinir; eklentinin kendi verisi
// başka yerde -chrome.storage- durduğu için etkilenmez).
const SNAP_ORIGINS = [
  "https://www.snapchat.com",
  "https://web.snapchat.com",
  "https://accounts.snapchat.com",
];

// --- Eklenti (Chrome extension) desteği ---------------------------------------
// Eklenti KLASÖRÜ (içinde manifest.json) yüklenir; .crx doğrudan yüklenmez.
// Aynı profil aynı anda iki Chrome tarafından açılamaz (profil kilidi), o yüzden
// eklenti modunda tarayıcı açılışları sıraya alınır.
let _extChain = Promise.resolve();
function lockExtensionProfile() {
  let release;
  const next = new Promise((r) => (release = r));
  const prev = _extChain;
  _extChain = prev.then(() => next);
  return prev.then(() => release);
}

// Eklenti klasörü geçerli mi? (manifest.json var mı)
function extensionReady(extPath) {
  try {
    return !!extPath && fs.existsSync(path.join(extPath, "manifest.json"));
  } catch {
    return false;
  }
}

// Verilen origin'lerin çerez + site verisini siler (login oturumunu düşürür).
async function clearSiteData(page, origins) {
  try {
    const client = await page.target().createCDPSession();
    for (const origin of origins) {
      await client
        .send("Storage.clearDataForOrigin", { origin, storageTypes: "all" })
        .catch(() => {});
    }
    await client.detach().catch(() => {});
  } catch {
    /* CDP yoksa boş ver */
  }
}

// min–max arası rastgele bekleme. Sabit aralıklı tıklama robot gibi göründüğü
// için accept'ler arasında bunu kullanıyoruz.
const randBetween = (min, max) => {
  const lo = Math.max(0, Number(min) || 0);
  const hi = Math.max(lo, Number(max) || 0);
  return Math.round(lo + Math.random() * (hi - lo));
};

// Bir hesabın kayıtlı oturumunu siler: cookies.json + Chrome profili.
// Ekran görüntülerine dokunmaz (teşhis için lazım).
// Döndürür: silinen öğe adları.
function clearSession(username) {
  const dir = path.join(SESSIONS_ROOT, safeName(username));
  const removed = [];
  for (const name of ["cookies.json", "profile"]) {
    const target = path.join(dir, name);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

// Kullanıcı adını dosya/klasör için güvenli hale getirir.
function safeName(s) {
  return String(s || "default")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_");
}

// --------------------------------------------------------------- Yardımcılar ---
async function waitForAny(page, selectors, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) return { el, selector: sel };
    }
    await sleep(300);
  }
  throw new Error(`Seçiciler bulunamadı: ${selectors.join(", ")}`);
}

async function queryAny(page, selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) return el;
  }
  return null;
}

async function loadCookies(page, cookiesPath) {
  if (!fs.existsSync(cookiesPath)) return false;
  try {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
    if (Array.isArray(cookies) && cookies.length) {
      await page.setCookie(...cookies);
      return true;
    }
  } catch {
    /* bozuk dosya, yok say */
  }
  return false;
}

async function saveCookies(page, cookiesPath, log) {
  const cookies = await page.cookies();
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
  log("Çerezler kaydedildi.");
}

async function tryClickXPath(page, xpath, timeout, log) {
  const sel = "xpath/" + xpath;
  const deadline = Date.now() + timeout;
  let handle = null;

  while (Date.now() < deadline && !handle) {
    for (const frame of page.frames()) {
      try {
        const h = await frame.$(sel);
        if (h) {
          handle = h;
          break;
        }
      } catch {
        /* frame gitmiş olabilir */
      }
    }
    if (!handle) await sleep(400);
  }

  if (!handle) {
    log(`Öğe bulunamadı (XPath): ${xpath}`);
    return false;
  }

  const targetHandle = await handle.evaluateHandle(
    (el) =>
      el.closest("button, a, [role='button'], [tabindex]") ||
      el.closest("div") ||
      el.parentElement ||
      el
  );
  const target = targetHandle.asElement() || handle;

  try {
    await target.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
    await sleep(300);
  } catch {}

  try {
    await target.click();
    return true;
  } catch {
    return await handle.evaluate((el) => {
      const t = el.closest("button, a, [role='button'], [tabindex]") || el.parentElement || el;
      const opts = { bubbles: true, cancelable: true, view: window };
      ["pointerover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) =>
        t.dispatchEvent(new MouseEvent(type, opts))
      );
      return true;
    });
  }
}

async function clickByText(page, texts, timeout, log) {
  const wanted = texts.map((t) => t.toLowerCase());
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const hit = await frame
        .evaluate((wanted) => {
          const visible = (el) =>
            el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
          const els = [...document.querySelectorAll('button, a, [role="button"]')];
          for (const el of els) {
            if (!visible(el)) continue;
            const txt = (el.innerText || "").trim().toLowerCase();
            if (txt && wanted.some((w) => txt.includes(w))) {
              el.scrollIntoView({ block: "center" });
              el.click();
              return txt;
            }
          }
          return null;
        }, wanted)
        .catch(() => null);
      if (hit) {
        if (log) log(`"${hit}" butonuna tıklandı.`);
        return true;
      }
    }
    await sleep(400);
  }
  return false;
}

// Snapchat login ekranında bazen gösterilen çerez banner'ı. Yalnızca
// görünür bir "Accept All" düğmesi varsa tıklanır; banner yoksa no-op'tur.
async function dismissCookieConsent(page, log = () => {}) {
  const clicked = await clickByText(page, COOKIE_ACCEPT_TEXTS, 2500, log);
  if (clicked) {
    log("Çerez bildirimi görüldü; 'Accept All' seçildi.");
    await sleep(500);
  }
  return clicked;
}

// aria-label / title / alt / data-testid değerine göre tıklar.
// Snapchat web'de ikon düğmelerinin metni olmadığı için asıl yöntem budur.
async function clickByLabel(page, labels, timeout = 6000, log) {
  const wanted = labels.map((t) => t.toLowerCase());
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const hit = await frame
        .evaluate((wanted) => {
          const visible = (el) =>
            el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
          const els = [...document.querySelectorAll("button, a, [role='button'], [tabindex]")];
          for (const el of els) {
            if (!visible(el) || el.disabled) continue;
            const label = [
              el.getAttribute("aria-label"),
              el.getAttribute("title"),
              el.getAttribute("alt"),
              el.getAttribute("data-testid"),
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            if (!label) continue;
            if (wanted.some((w) => label.includes(w))) {
              el.scrollIntoView({ block: "center" });
              el.click();
              return label.slice(0, 40);
            }
          }
          return null;
        }, wanted)
        .catch(() => null);
      if (hit) {
        if (log) log(`Etiketle tıklandı: "${hit}"`);
        return true;
      }
    }
    await sleep(300);
  }
  return false;
}

// "/html/..." tam yol ya da "/div/div[2]/..." gibi kısmi yol olabilir;
// kısmi yollar sayfanın herhangi bir yerinde aranır (// ile).
function xpathVariants(xp) {
  const clean = String(xp || "").trim().replace(/\/+$/, "");
  if (!clean) return [];
  const list = [clean];
  if (clean.startsWith("/") && !clean.startsWith("//") && !/^\/html/i.test(clean)) {
    list.push("/" + clean);
  }
  return list;
}

// Bir story adımına tıklar: önce XPath, olmazsa etiket, olmazsa metin.
// KONUMDAN TAHMİN YAPMAZ — yanlış bir öğeye (ör. sohbet listesindeki bir kişiye)
// tıklamaktansa hata verip durmak daha güvenli.
async function clickStep(page, { xpath, labels, texts, log = () => {}, timeout = 6000 }) {
  for (const xp of xpathVariants(xpath)) {
    if (await tryClickXPath(page, xp, timeout, () => {})) {
      log(`XPath ile tıklandı: ${xp}`);
      return true;
    }
  }
  if (xpath) log("XPath ile bulunamadı, etiket/metin deneniyor.");
  if (labels && (await clickByLabel(page, labels, 3000, log))) return true;
  if (texts && (await clickByText(page, texts, 3000, log))) return true;
  return false;
}

// Sayfada bu metinlerden biri görünüyor mu?
async function pageHasText(page, texts) {
  const wanted = texts.map((t) => t.toLowerCase());
  return await page
    .evaluate((wanted) => {
      const t = (document.body ? document.body.innerText || "" : "").toLowerCase();
      return wanted.some((w) => t.includes(w));
    }, wanted)
    .catch(() => false);
}

// Chrome'a "sahte kamera" olarak verilecek düz renkli tek kare (Y4M / I420).
// Gerçek webcam yerine bunu kullanmak: odandaki görüntü hikayeye düşmez,
// headless modda da çalışır ve sonuç her seferinde aynı olur.
function writeSolidColorY4M(file, hexColor, width = 720, height = 1280) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hexColor || "#000000").trim());
  const rgb = m ? m[1] : "000000";
  const R = parseInt(rgb.slice(0, 2), 16);
  const G = parseInt(rgb.slice(2, 4), 16);
  const B = parseInt(rgb.slice(4, 6), 16);
  // BT.601 sınırlı aralık (video standardı)
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const Y = clamp(16 + (65.481 * R + 128.553 * G + 24.966 * B) / 255);
  const U = clamp(128 + (-37.797 * R - 74.203 * G + 112.0 * B) / 255);
  const V = clamp(128 + (112.0 * R - 93.786 * G - 18.214 * B) / 255);

  const w = width % 2 ? width + 1 : width;
  const h = height % 2 ? height + 1 : height;
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420mpeg2\nFRAME\n`, "ascii");
  const yPlane = Buffer.alloc(w * h, Y);
  const uPlane = Buffer.alloc((w / 2) * (h / 2), U);
  const vPlane = Buffer.alloc((w / 2) * (h / 2), V);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, yPlane, uPlane, vPlane]));
  return file;
}

// "Welcome to Snapchat for Web!" penceresini "Next" ile geçer. Pencere açıkken
// arkadaki butonlara (Add Friends) gerçek fare tıklaması ulaşmıyor.
// waitMs kadar pencerenin çıkmasını bekler (bazen sayfa yüklendikten biraz
// sonra geliyor). Pencere yoksa HİÇBİR ŞEYE TIKLAMAZ.
async function dismissWelcomeDialog(page, log, waitMs = 0) {
  const deadline = Date.now() + waitMs;
  while (true) {
    const res = await page
      .evaluate(
        async (reSrc, texts) => {
          const re = new RegExp(reSrc, "i");
          const visible = (el) =>
            el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

          // Başlık metnini bul, buton içeren ilk üst öğeye çık = pencere kartı.
          // (Aramayı kartla sınırlamak, arkadaki "OK"/"Done" gibi butonlara
          //  yanlışlıkla tıklamayı önler.)
          let dialog = null;
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n && !dialog; n = walker.nextNode()) {
            if (!re.test(n.nodeValue || "") || !visible(n.parentElement)) continue;
            for (let el = n.parentElement; el && el !== document.body; el = el.parentElement) {
              if (el.querySelector('button, [role="button"]')) {
                dialog = el;
                break;
              }
            }
          }
          if (!dialog) return { found: false, clicked: [] };

          // Birden fazla adımlı olabilir: kart kaybolana kadar (en fazla 5 adım) ilerle.
          const clicked = [];
          for (let step = 0; step < 5; step++) {
            if (!dialog.isConnected || !visible(dialog)) break;
            const btn = [...dialog.querySelectorAll('button, [role="button"]')].find(
              (b) => visible(b) && texts.includes((b.innerText || "").trim().toLowerCase())
            );
            if (!btn) break;
            clicked.push((btn.innerText || "").trim());
            btn.click();
            await new Promise((r) => setTimeout(r, 1000));
          }
          return { found: true, clicked };
        },
        WELCOME_DIALOG_RE,
        WELCOME_NEXT_TEXTS
      )
      .catch(() => ({ found: false, clicked: [] }));

    if (res.clicked.length) {
      log(`Karşılama penceresi geçildi (${res.clicked.map((t) => `"${t}"`).join(" → ")}).`);
      return true;
    }
    if (res.found) {
      // Pencere var ama buton metni tanınmadı → Escape (yanlış tıklama riski yok)
      await page.keyboard.press("Escape").catch(() => {});
      log("Karşılama penceresi var ama 'Next' bulunamadı; Escape denendi (WELCOME_NEXT_TEXTS'e bak).");
      return true;
    }
    if (Date.now() >= deadline) break;
    await sleep(500);
  }

  if (waitMs > 0) log("Karşılama penceresi yok, atlanıyor.");
  return false;
}

// Bildirim izni pop-up'ını kapatır. Pop-up yoksa HİÇBİR ŞEYE TIKLAMAZ.
// (Eskiden yedek olarak pozisyona dayalı bir XPath'e tıklıyordu; o XPath
//  Add Friends butonuyla aynı elemana çıkıp paneli açıp kapatıyordu.)
async function dismissNotificationPrompt(page, log) {
  // Pop-up gerçekten var mı? Metninden anla.
  const visible = await page
    .evaluate(() =>
      /enable notifications|keep up with your friends|bildirim/i.test(document.body.innerText || "")
    )
    .catch(() => false);

  if (!visible) {
    log("Bildirim pop-up'ı yok, atlanıyor.");
    return false;
  }

  const closed = await clickByText(
    page,
    ["not now", "şimdi değil", "simdi degil", "daha sonra", "maybe later"],
    5000,
    log
  );
  if (closed) return true;

  // Güvenli yedek: Escape (yanlış bir butona tıklama riski yok)
  await page.keyboard.press("Escape").catch(() => {});
  log("Pop-up Escape ile kapatılmaya çalışıldı.");
  return true;
}

async function clickXPathQuick(page, xpath) {
  const sel = "xpath/" + xpath;
  for (const frame of page.frames()) {
    const h = await frame.$(sel).catch(() => null);
    if (!h) continue;
    try {
      await h.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await h.click();
    } catch {
      await h.evaluate((el) => {
        const t = el.closest("button, a, [role='button'], [tabindex]") || el;
        t.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      });
    }
    return true;
  }
  return false;
}

// Metnine uyan TÜM butonlara sırayla tıklar (tüm "Accept"lar).
// max'a ulaşınca, idleTimeout süresince yeni çıkmayınca ya da shouldStop()
// true dönünce durur.
// Döndürür: { total, limited }
async function clickAllByText(
  page,
  texts,
  { max = 300, delayMin = 600, delayMax = 1200, idleTimeout = 6000, onHit, log, shouldStop } = {}
) {
  const wanted = texts.map((t) => t.toLowerCase());
  let total = 0;
  let limited = false;
  let lastHit = Date.now();

  while (total < max) {
    if (shouldStop && (await shouldStop())) {
      limited = true;
      break;
    }
    let hit = null;
    for (const frame of page.frames()) {
      hit = await frame
        .evaluate((wanted) => {
          // Sadece GÖRÜNÜR butonlara tıkla (gizli olanlar sayacı şişiriyordu)
          const visible = (el) =>
            el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
          const els = [...document.querySelectorAll('button, [role="button"]')];
          for (const el of els) {
            if (el.disabled || !visible(el)) continue;
            const txt = (el.innerText || "").trim().toLowerCase();
            if (!txt || txt.length > 24) continue;
            if (wanted.some((w) => txt === w || txt.includes(w))) {
              el.scrollIntoView({ block: "center" });
              el.click();
              return txt;
            }
          }
          return null;
        }, wanted)
        .catch(() => null);
      if (hit) break;
    }

    if (hit) {
      total++;
      lastHit = Date.now();
      if (onHit) onHit(total);
      await sleep(randBetween(delayMin, delayMax));
    } else {
      if (Date.now() - lastHit > idleTimeout) break;
      await sleep(400);
    }
  }
  return { total, limited };
}

// Sayfada hız sınırı uyarısı görünüyor mu?
async function isRateLimited(page) {
  for (const frame of page.frames()) {
    const hit = await frame
      .evaluate((needles) => {
        const t = (document.body ? document.body.innerText || "" : "").toLowerCase();
        return needles.some((n) => t.includes(n));
      }, RATE_LIMIT_TEXTS)
      .catch(() => false);
    if (hit) return true;
  }
  return false;
}

// Metnine uyan tıklanabilir öğe sayısını verir (teşhis için).
async function countByText(page, texts) {
  const wanted = texts.map((t) => t.toLowerCase());
  let count = 0;
  for (const frame of page.frames()) {
    count += await frame
      .evaluate((wanted) => {
        // Sadece GÖRÜNÜR butonlar sayılır (gizli panelde innerText textContent'e düşer)
        const visible = (el) =>
          el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
        const els = [...document.querySelectorAll('button, [role="button"]')];
        let c = 0;
        for (const el of els) {
          if (!visible(el)) continue;
          const t = (el.innerText || "").trim().toLowerCase();
          if (t && t.length <= 24 && wanted.some((w) => t === w || t.includes(w))) c++;
        }
        return c;
      }, wanted)
      .catch(() => 0);
  }
  return count;
}

// Add Friends paneli AÇIK mı? (Panel açıkken bu başlıklar/butonlar görünür.)
async function isAddFriendsOpen(page) {
  return await page
    .evaluate(() => {
      // document.body.innerText yerleşim duyarlıdır: gizli içerik burada görünmez.
      const t = (document.body.innerText || "").toLowerCase();
      if (/added me|beni ekleyenler|quick add|hızlı ekle|hizli ekle/.test(t)) return true;
      // Ya da GÖRÜNÜR kabul/yoksay butonları listeleniyorsa
      const visible = (el) =>
        el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
      return [...document.querySelectorAll('button, [role="button"]')].some((b) => {
        if (!visible(b)) return false;
        const x = (b.innerText || "").trim().toLowerCase();
        return x === "accept" || x === "kabul et" || x === "ignore" || x === "yoksay";
      });
    })
    .catch(() => false);
}

// Add Friends panelini açar. Buton bir TOGGLE olduğu için:
//  - Zaten açıksa tıklamaz (yoksa kapatırdı).
//  - Tıkladıktan sonra gerçekten açıldı mı diye doğrular, açılmadıysa tekrar dener.
async function openAddFriends(page, log) {
  // Karşılama penceresi geç çıkmış olabilir; açıksa Add Friends'e tıklanamaz.
  if (await dismissWelcomeDialog(page, log)) await sleep(1000);

  if (await isAddFriendsOpen(page)) {
    log("Add Friends zaten açık, tekrar tıklanmıyor.");
    return true;
  }

  const attempts = [
    {
      name: "XPath",
      run: () => (ADD_FRIENDS_XPATH ? tryClickXPath(page, ADD_FRIENDS_XPATH, 8000, log) : false),
    },
    { name: "metin", run: () => clickByText(page, ADD_FRIENDS_TEXTS, 4000, log) },
    {
      name: "etiket",
      run: () =>
        page
          .evaluate(() => {
            const cand = [
              ...document.querySelectorAll('button, [role="button"], a, [aria-label], [title]'),
            ];
            for (const el of cand) {
              const label = (
                (el.getAttribute("aria-label") || "") +
                " " +
                (el.getAttribute("title") || "")
              ).toLowerCase();
              if (label.includes("add friend") || label.includes("arkadaş")) {
                el.scrollIntoView({ block: "center" });
                el.click();
                return true;
              }
            }
            return false;
          })
          .catch(() => false),
    },
  ];

  for (let round = 1; round <= 2; round++) {
    for (const a of attempts) {
      const clicked = await a.run();
      if (!clicked) continue;
      await sleep(1800); // panelin açılmasını bekle
      if (await isAddFriendsOpen(page)) {
        log(`Add Friends açıldı (${a.name}, deneme ${round}).`);
        return true;
      }
      log(`${a.name} ile tıklandı ama panel açılmadı (toggle kapanmış olabilir), tekrar denenecek.`);
    }
  }

  log("'Add Friends' paneli açılamadı (bot.js içindeki ADD_FRIENDS_XPATH'i güncelle).");
  return false;
}

/**
 * @param {object} o
 * @param {number} [o.maxAccepts=0]        0 = sınırsız
 * @param {number} [o.acceptDelayMin=600]  accept'ler arası en az bekleme (ms)
 * @param {number} [o.acceptDelayMax=1200] accept'ler arası en çok bekleme (ms)
 */
async function acceptAllFriendRequests(page, o) {
  const {
    maxAccepts = 0,
    acceptDelayMin = 600,
    acceptDelayMax = 1200,
    log = () => {},
    onHit,
    shotPath,
  } = o;
  log("Add Friends açılıyor...");
  const opened = await openAddFriends(page, log);
  log("Add Friends açıldı mı: " + (opened ? "evet" : "HAYIR"));
  await sleep(1500); // panel yüklensin

  // "Added Me" sekmesine yalnızca GEREKİRSE geç: Accept butonları zaten
  // görünüyorsa dokunma (o metin toggle butonuna denk gelip paneli kapatabilir).
  if ((await countByText(page, ACCEPT_TEXTS)) === 0) {
    await clickByText(page, ["added me", "beni ekleyenler"], 3000, log);
    await sleep(1200);
    // Sekme tıklaması paneli kapattıysa geri aç
    if (!(await isAddFriendsOpen(page))) {
      log("Sekme tıklaması paneli kapattı, yeniden açılıyor...");
      await openAddFriends(page, log);
      await sleep(1200);
    }
  }

  // >>> TEŞHİS: panel açıkken (View more'dan ÖNCE) durumu yakala <<<
  if (shotPath) await page.screenshot({ path: shotPath }).catch(() => {});
  const before = await countByText(page, ACCEPT_TEXTS);
  log(`Panel açıldıktan sonra sayfada ${before} adet 'Accept' butonu var.`);
  const sample = await page
    .evaluate(() => {
      const visible = (el) =>
        el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
      const els = [...document.querySelectorAll('button, [role="button"]')];
      const txts = [];
      for (const el of els) {
        if (!visible(el)) continue;
        const t = (el.innerText || "").replace(/\s+/g, " ").trim();
        if (t && t.length <= 30) txts.push(t);
        if (txts.length >= 40) break;
      }
      return txts;
    })
    .catch(() => []);
  log("Görünen butonlar: " + JSON.stringify(sample));
  if (before === 0) {
    // Panel kapanmış olabilir → bir kez daha aç ve tekrar say
    if (!(await isAddFriendsOpen(page))) {
      log("Panel kapalı görünüyor, yeniden açılıyor...");
      await openAddFriends(page, log);
      await sleep(1500);
      const retry = await countByText(page, ACCEPT_TEXTS);
      log(`Yeniden açtıktan sonra ${retry} adet 'Accept' butonu var.`);
    } else {
      log("Uyarı: panel açık ama hiç 'Accept' yok (bekleyen istek olmayabilir).");
      log("Kabul butonunun metni farklıysa yukarıdaki listeye bakıp ACCEPT_TEXTS'e ekleyeceğiz.");
    }
  }

  // "View more" ile listeyi genişlet
  if (VIEW_MORE_XPATH) {
    let more = 0;
    for (let i = 0; i < 20; i++) {
      if (!(await clickXPathQuick(page, VIEW_MORE_XPATH))) break;
      more++;
      await sleep(700);
    }
    if (more) log(`View more ${more} kez tıklandı.`);
  }

  // Panel açılır açılmaz sınır uyarısı varsa hiç başlama.
  if (await isRateLimited(page)) {
    log("Snapchat hız sınırı uyarısı zaten ekranda. Bu tur atlanıyor.");
    return { accepted: 0, limited: true };
  }

  const max = maxAccepts > 0 ? maxAccepts : Infinity;
  log(`Accept'ler arası bekleme: ${acceptDelayMin}-${acceptDelayMax} ms (rastgele).`);
  const { total, limited } = await clickAllByText(page, ACCEPT_TEXTS, {
    max,
    delayMin: acceptDelayMin,
    delayMax: acceptDelayMax,
    idleTimeout: 6000,
    onHit,
    log,
    shouldStop: () => isRateLimited(page),
  });

  if (limited) {
    log(`Snapchat hız sınırına takıldı (${total} accept sonrası). Tıklama durduruldu.`);
  }
  return { accepted: total, limited };
}

function urlLooksLoggedIn(url) {
  if (WELCOME_RE.test(url)) return true;
  if (/\/v2\/login|\/login|www\.snapchat\.com/i.test(url)) return false;
  return /accounts\.snapchat\.com/i.test(url);
}

async function checkLoginState(page, log) {
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
  await sleep(2000);
  await dismissCookieConsent(page, log);
  const url = page.url();
  log("Kontrol URL: " + url);
  if (WELCOME_RE.test(url)) return "logged";
  const userInput = await queryAny(page, USER_SELECTORS);
  if (userInput) return "needlogin";
  if (/accounts\.snapchat\.com/i.test(url) && !/\/login/i.test(url)) return "logged";
  return "unknown";
}

// Sayfada captcha / SMS / cihaz doğrulaması var mı? (Yanlış şifreden farklı.)
// Varsa ikinci şifreyi denemek anlamsız ve riskli — hemen durmalı.
// Not: alt bilgideki "Safety Center / Güvenlik Merkezi" gibi ifadelere denk
// gelmemek için sadece doğrulamaya özgü kalıplar aranır.
async function looksLikeVerification(page) {
  return await page
    .evaluate(() => {
      const t = (document.body ? document.body.innerText || "" : "").toLowerCase();
      return /enter the code|verification code|doğrulama kodu|dogrulama kodu|kodu gir|code sent|sms|i'?m not a robot|recaptcha|are you a robot|robot değil|two-?factor|iki adım|iki asamali/i.test(
        t
      );
    })
    .catch(() => false);
}

async function doPasswordLogin(page, username, password, log) {
  if (!username || !password) throw new Error("Kullanıcı adı / şifre eksik.");

  let userField = await queryAny(page, USER_SELECTORS);
  if (!userField) {
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await dismissCookieConsent(page, log);
    userField = (await waitForAny(page, USER_SELECTORS)).el;
  }
  log("Kullanıcı adı giriliyor...");
  await userField.click({ clickCount: 3 });
  await userField.type(username, { delay: 10 });

  const nextBtn = await page.$('button[type="submit"], button');
  if (nextBtn) {
    await nextBtn.click().catch(() => {});
    await sleep(2500);
  }

  const passField = (await waitForAny(page, PASS_SELECTORS)).el;
  log("Şifre giriliyor...");
  await passField.click({ clickCount: 3 });
  await passField.type(password, { delay: 60 });

  const submit = await page.$('button[type="submit"], button');
  if (submit) await submit.click().catch(() => {});

  await page
    .waitForNavigation({ waitUntil: "networkidle2", timeout: 90000 })
    .catch(() => log("Otomatik yönlenme olmadı (ek doğrulama gerekebilir)."));
  await sleep(3000);
}

// Denenecek şifre listesini kurar: önce hesabın kendi şifresi, sonra yedekler.
// Tekilleştirir, boşları atar, maxLoginAttempts kadarını alır (0 = hepsi).
// Tek şifre verildiğinde tek elemanlı liste döner → davranış eskisiyle aynı.
function buildPasswordList(password, passwords, maxLoginAttempts = 0) {
  const candidates = [];
  for (const p of [password, ...(Array.isArray(passwords) ? passwords : [])]) {
    const pw = p == null ? "" : String(p);
    if (pw && !candidates.includes(pw)) candidates.push(pw);
  }
  const cap = maxLoginAttempts > 0 ? Math.min(candidates.length, maxLoginAttempts) : candidates.length;
  return candidates.slice(0, cap);
}

// Listedeki şifreleri sırayla dener. Biri tutarsa döner; captcha/SMS çıkarsa
// (ikinci denemeyi boşa harcamamak için) hemen durur; hepsi tükenirse hata verir.
async function loginWithPasswords(page, username, tryList, log) {
  if (!tryList.length) throw new Error("Kullanıcı adı / şifre eksik.");
  for (let i = 0; i < tryList.length; i++) {
    if (i > 0) {
      log(`Bir önceki şifre girişi başarısız; ${i + 1}. şifre deneniyor (en fazla ${tryList.length}).`);
      await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
      await sleep(1500);
      await dismissCookieConsent(page, log);
    } else if (tryList.length > 1) {
      log(`Giriş deneniyor (en fazla ${tryList.length} şifre sırayla).`);
    }

    await doPasswordLogin(page, username, tryList[i], log);
    await sleep(1000);

    if (urlLooksLoggedIn(page.url())) {
      if (tryList.length > 1) log(`Doğru şifre ${i + 1}. denemede bulundu.`);
      return true;
    }
    // Captcha/SMS ise başka şifre denemek anlamsız ve riskli → dur.
    if (await looksLikeVerification(page)) {
      throw new Error("Login tamamlanamadı: captcha / SMS / cihaz doğrulaması gerekiyor.");
    }
    log(`Şifre kabul edilmedi (deneme ${i + 1}/${tryList.length}).`);
  }
  throw new Error(
    tryList.length > 1
      ? `Login tamamlanamadı: denenen ${tryList.length} şifrenin hiçbiri kabul edilmedi.`
      : "Login tamamlanamadı (captcha / doğrulama gerekebilir)."
  );
}

// ------------------------------------------------------------- Oturum -------
/**
 * Tarayıcıyı açar, giriş yapar ve web uygulamasını hazır hale getirir.
 * Hem istek kabul (runAccount) hem story atma (postStory) bunu kullanır.
 * Giriş yapılamazsa hata fırlatır.
 *
 * @param {object} o
 * @param {object} [o.camera] {color} verilirse gerçek webcam yerine düz renkli
 *                            sahte kamera kullanılır ve kamera izni verilir.
 * @returns {Promise<{browser,page,sessionDir,stopPreview:Function}>}
 */
async function openSession(o) {
  const {
    username,
    password,
    passwords = null, // yedek şifre listesi (dizi). Verilirse sırayla denenir.
    maxLoginAttempts = 0, // 0 = tüm adaylar; ör. 2 = en fazla 2 şifre dener
    headless = false,
    useCookies = true,
    camera = null,
    extension = null, // { path: <klasör>, profileDir: <kalıcı profil> }
    log = () => {},
    onBrowser = () => {},
    onPreview = null,
    proxy = null,
  } = o;

  const tryList = buildPasswordList(password, passwords, maxLoginAttempts);

  const sessionDir = path.join(SESSIONS_ROOT, safeName(username));
  const cookiesPath = path.join(sessionDir, "cookies.json");
  const userDataDir = path.join(sessionDir, "profile");
  fs.mkdirSync(sessionDir, { recursive: true });

  // Eklenti modu: eklenti yalnızca headful'de yüklenir; login çerezi saklanmaz
  // (kalıcı profil sadece eklentinin ayarını tutar).
  const useExt = extensionReady(extension && extension.path);
  const effHeadless = useExt ? false : headless;
  const persistLogin = useCookies && !useExt; // eklenti modunda login saklama
  if (useExt && headless) log("Eklenti açık: headless kapatıldı (eklentiler yalnızca pencereli çalışır).");

  // Aynı eklenti profili aynı anda tek Chrome tarafından açılabilir → sıraya al
  let extRelease = useExt ? await lockExtensionProfile() : null;

  const args = [
    "--no-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--start-maximized",
    "--window-size=1280,800",
    "--mute-audio",
  ];

  if (useExt) {
    fs.mkdirSync(extension.profileDir, { recursive: true });
    args.push(`--disable-extensions-except=${extension.path}`);
    args.push(`--load-extension=${extension.path}`);
    log(`Eklenti yükleniyor: ${extension.path}`);
  }

  if (camera) {
    // getUserMedia izin penceresi çıkmasın + gerçek webcam yerine düz renk ver
    args.push("--use-fake-ui-for-media-stream");
    if (camera.fake !== false) {
      const y4m = path.join(sessionDir, "camera.y4m");
      writeSolidColorY4M(y4m, camera.color || "#000000");
      args.push("--use-fake-device-for-media-stream");
      args.push(`--use-file-for-fake-video-capture=${y4m}`);
      log(`Sahte kamera hazırlandı (${camera.color || "#000000"}).`);
    } else {
      log("Gerçek kamera kullanılacak.");
    }
  } else {
    // Story dışındaki turlarda izin pop-up'ları hiç çıkmasın
    args.push("--deny-permission-prompts");
  }

  const launchProfile = useExt ? extension.profileDir : useCookies ? userDataDir : undefined;
  log(`Tarayıcı açılıyor (headless=${effHeadless}${camera ? ", kamera açık" : ""}${useExt ? ", eklenti açık" : ""})...`);
  let browser;
  try {
    ({ browser } = await launchBrowser({ puppeteer, headless: effHeadless, userDataDir: launchProfile, args, proxy }));
  } catch (e) {
    if (extRelease) extRelease();
    throw e;
  }
  // Tarayıcı kapanınca eklenti profili kilidini bırak (çağıran unutsa bile)
  if (extRelease) {
    const rel = extRelease;
    extRelease = null;
    browser.on("disconnected", rel);
  }
  onBrowser(browser);

  const ctx = browser.defaultBrowserContext();
  const origins = [
    "https://www.snapchat.com",
    "https://web.snapchat.com",
    "https://accounts.snapchat.com",
  ];
  for (const origin of origins) {
    await ctx.overridePermissions(origin, camera ? ["camera", "microphone"] : []).catch(() => {});
  }

  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  );

  let previewTimer = null;
  if (onPreview) {
    previewTimer = setInterval(() => {
      page
        .screenshot({ type: "jpeg", quality: 45 })
        .then((buf) => onPreview(buf))
        .catch(() => {});
    }, 1200);
  }
  const stopPreview = () => {
    if (previewTimer) clearInterval(previewTimer);
    previewTimer = null;
  };

  try {
    if (useExt) {
      // Kalıcı profildeki eski Snapchat oturumunu düşür (eklenti ayarı kalır)
      await clearSiteData(page, SNAP_ORIGINS);
      log("Eklenti profili: Snapchat oturum çerezleri temizlendi (login saklanmıyor).");
    }

    if (persistLogin) {
      await loadCookies(page, cookiesPath);
    } else {
      log("Çerez saklama kapalı: bu turda şifreyle giriş yapılacak.");
    }

    const state = await checkLoginState(page, log);
    if (state === "logged") {
      log("Kayıtlı oturumla girildi (şifre gerekmedi).");
    } else {
      await loginWithPasswords(page, username, tryList, log);
      log("Login başarılı.");
      if (persistLogin) await saveCookies(page, cookiesPath, log);
    }

    log("Web uygulamasına gidiliyor...");
    await page.goto(WEB_APP_URL, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    await sleep(2000);
    await dismissCookieConsent(page, log);
    await dismissWelcomeDialog(page, log, 5000);
    await dismissNotificationPrompt(page, log);
  } catch (e) {
    stopPreview();
    // Hata olduğunda tarayıcıyı burada kapat: yoksa çağıran session'ı hiç
    // alamayacağı için tarayıcı (ve eklenti profili kilidi) açık kalırdı.
    // Kapanış "disconnected" ile kilidi bırakır.
    await browser.close().catch(() => {});
    throw e;
  }

  return { browser, page, sessionDir, stopPreview };
}

// ---------------------------------------------------------------- postStory ---
/**
 * Bir hesapta hikaye paylaşır:
 *   ortadaki kameraya tıkla → izin penceresini geç → fotoğrafı çek →
 *   "T" ile yazı ekle → yazıyı yaz → Gönder → "Hikayem" → Gönder
 *
 * Her adımın ekran görüntüsü sessions/<hesap>/story-N-*.png olarak kaydedilir;
 * arayüz değişirse hangi adımda takıldığı oradan görülür.
 *
 * @param {object} o
 * @param {string} o.username
 * @param {string} o.password
 * @param {string} o.text            Fotoğrafın üstüne yazılacak metin
 * @param {string} [o.bgColor]       Sahte kamera arka plan rengi (#000000)
 * @param {boolean}[o.realCamera]    true ise gerçek webcam kullanılır
 * @param {boolean}[o.dryRun]        true ise son "Gönder"e BASMAZ (deneme)
 * @returns {Promise<{username,posted,error,screenshot,steps}>}
 */
async function postStory(o) {
  const {
    username,
    password,
    passwords = null,
    maxLoginAttempts = 0,
    text = "",
    bgColor = "#000000",
    realCamera = false,
    dryRun = false,
    headless = false,
    useCookies = true,
    extension = null,
    log = () => {},
    onBrowser = () => {},
    onPreview = null,
    keepOpen = false,
    proxy = null,
  } = o;

  const result = { username, posted: false, error: null, screenshot: null, steps: [] };
  let session = null;
  const shots = [];

  const step = (name) => {
    result.steps.push(name);
    log(`[story] ${name}`);
  };

  try {
    session = await openSession({
      username,
      password,
      passwords,
      maxLoginAttempts,
      headless,
      useCookies,
      extension,
      camera: { fake: !realCamera, color: bgColor },
      log,
      onBrowser,
      onPreview,
      proxy,
    });
    const { page, sessionDir } = session;
    const shot = async (n, name) => {
      const f = path.join(sessionDir, `story-${n}-${name}.png`);
      await page.screenshot({ path: f }).catch(() => {});
      shots.push(f);
      return f;
    };

    const stepLog = (m) => log("[story] " + m);

    // 1) Ortadaki kamera düğmesi
    step("Kamera açılıyor");
    await shot(1, "baslangic");
    const opened = await clickStep(page, {
      xpath: STORY_XPATH.camera,
      labels: CAMERA_LABELS,
      texts: CAMERA_HINT_TEXTS,
      log: stepLog,
    });
    if (!opened) throw new Error("Kamera düğmesi bulunamadı (bot.js > STORY_XPATH.camera).");
    await sleep(2500);

    // 2) Snapchat'in kendi izin penceresi ("Tamamdır!")
    if (await pageHasText(page, ["izin isteyeceğiz", "erişmek için", "wants to", "access your camera"])) {
      step("İzin penceresi geçiliyor");
      await clickByText(page, PERMISSION_OK_TEXTS, 4000, log);
      await sleep(2500);
    }
    // Tarayıcı izni zaten --use-fake-ui-for-media-stream ile veriliyor.
    await shot(2, "kamera");

    // 3) Fotoğrafı çek
    step("Fotoğraf çekiliyor");
    const captured = await clickStep(page, {
      xpath: STORY_XPATH.capture,
      labels: CAPTURE_LABELS,
      log: stepLog,
    });
    if (!captured) throw new Error("Deklanşör düğmesi bulunamadı (bot.js > STORY_XPATH.capture).");
    await sleep(2500);
    await shot(3, "cekildi");

    // 4) "T" ile yazı ekle
    if (text && text.trim()) {
      step("Yazı ekleniyor");
      const textTool = await clickStep(page, {
        xpath: STORY_XPATH.textTool,
        labels: TEXT_TOOL_LABELS,
        log: stepLog,
      });
      if (!textTool) {
        throw new Error("Yazı ('T') düğmesi bulunamadı (bot.js > STORY_XPATH.textTool).");
      }
      await sleep(1200);
      await page.keyboard.type(text, { delay: 60 });
      await sleep(800);
      log(`[story] Yazı yazıldı: "${text}"`);
      await shot(4, "yazi");
    }

    // 5) Gönder (alıcı listesini açar)
    step("Gönder'e basılıyor");
    const sent1 = await clickStep(page, {
      xpath: STORY_XPATH.send,
      texts: SEND_TEXTS,
      labels: ["send", "gönder"],
      log: stepLog,
    });
    if (!sent1) throw new Error("Gönder düğmesi bulunamadı (bot.js > STORY_XPATH.send).");
    await sleep(2500);
    await shot(5, "alici-listesi");

    // 6) "Hikayem" seçili mi? Ekranın altındaki şerit seçili hedefi gösterir.
    step("Hikayem seçiliyor");
    const alreadySelected = await page
      .evaluate((wanted) => {
        const visible = (el) =>
          el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
        // Alt şeritte (ekranın alt %20'si) hikaye yazıyorsa seçilidir
        const H = window.innerHeight;
        for (const el of document.querySelectorAll("div, span, button")) {
          if (!visible(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.top < H * 0.8) continue;
          const t = (el.innerText || "").trim().toLowerCase();
          if (t && t.length < 40 && wanted.some((w) => t.includes(w))) return true;
        }
        return false;
      }, MY_STORY_TEXTS)
      .catch(() => false);

    if (alreadySelected) {
      log("[story] 'Hikayem' zaten seçili, tekrar tıklanmıyor (tıklasak seçimi kaldırırdı).");
    } else {
      const picked = await clickStep(page, {
        xpath: STORY_XPATH.myStory,
        texts: MY_STORY_TEXTS,
        log: stepLog,
      });
      if (!picked) throw new Error("'Hikayem' satırı bulunamadı (bot.js > STORY_XPATH.myStory).");
      await sleep(1200);
    }
    await shot(6, "hikayem-secili");

    // 7) Son Gönder
    if (dryRun) {
      step("DENEME modu: son Gönder'e basılmadı");
      result.posted = false;
      result.screenshot = shots[shots.length - 1];
      return result;
    }
    step("Hikayeye gönderiliyor");
    const sent2 = await clickStep(page, {
      xpath: STORY_XPATH.sendStory,
      texts: SEND_TEXTS,
      log: stepLog,
    });
    if (!sent2) throw new Error("Son Gönder düğmesi bulunamadı (bot.js > STORY_XPATH.sendStory).");
    await sleep(4000);
    await shot(7, "gonderildi");

    result.posted = true;
    result.screenshot = shots[shots.length - 1];
    log("[story] Hikaye paylaşıldı.");
  } catch (err) {
    result.error = err.message;
    log("[story] HATA: " + err.message);
    try {
      if (session) {
        const f = path.join(session.sessionDir, "story-error.png");
        await session.page.screenshot({ path: f }).catch(() => {});
        result.screenshot = f;
      }
    } catch {}
  } finally {
    if (session) {
      session.stopPreview();
      if (!keepOpen) {
        await session.browser.close().catch(() => {});
        log("Tarayıcı kapatıldı.");
      }
    }
  }

  return result;
}

// --------------------------------------------------------------- runAccount ---
/**
 * @param {object} o
 * @param {string} o.username
 * @param {string} o.password
 * @param {boolean} [o.headless=false]
 * @param {number}  [o.maxAccepts=0]  0 = sınırsız
 * @param {boolean} [o.useCookies=true] false ise oturum saklanmaz; her turda
 *                                      şifreyle giriş yapılır (geçici profil)
 * @param {number}  [o.acceptDelayMin=600]  accept'ler arası en az bekleme (ms)
 * @param {number}  [o.acceptDelayMax=1200] accept'ler arası en çok bekleme (ms)
 * @param {function}[o.log]           (satır) => void
 * @param {function}[o.onAccept]      (toplamSayı) => void
 * @param {boolean} [o.keepOpen=false] true ise tarayıcı kapatılmaz (CLI için)
 * @returns {Promise<{username,loggedIn,accepted,error,screenshot}>}
 */
async function runAccount(o) {
  const {
    username,
    password,
    passwords = null, // yedek şifre listesi (dizi); sırayla denenir
    maxLoginAttempts = 0, // 0 = tüm adaylar
    headless = false,
    maxAccepts = 0,
    useCookies = true,
    acceptDelayMin = 600,
    acceptDelayMax = 1200,
    extension = null, // { path, profileDir }
    log = () => {},
    onAccept = () => {},
    onBrowser = () => {}, // tarayıcı açılınca referansı dışarı ver (durdurmak için)
    onPreview = null, // (dataUrl) => void — canlı önizleme kareleri
    keepOpen = false,
    proxy = null,
  } = o;

  const userKey = safeName(username);
  const sessionDir = path.join(SESSIONS_ROOT, userKey);
  const cookiesPath = path.join(sessionDir, "cookies.json");
  const userDataDir = path.join(sessionDir, "profile");
  const okShot = path.join(sessionDir, "sonuc.png");
  const errShot = path.join(sessionDir, "error.png");
  const afShot = path.join(sessionDir, "addfriends.png"); // teşhis: panel açık hali
  fs.mkdirSync(sessionDir, { recursive: true });

  const result = {
    username,
    loggedIn: false,
    accepted: 0,
    limited: false, // Snapchat hız sınırına takıldı mı
    error: null,
    screenshot: null,
  };
  // Eklenti modu: headful + kalıcı eklenti profili; login çerezi saklanmaz.
  const useExt = extensionReady(extension && extension.path);
  const effHeadless = useExt ? false : headless;
  const persistLogin = useCookies && !useExt;
  if (useExt && headless) log("Eklenti açık: headless kapatıldı (eklentiler yalnızca pencereli çalışır).");
  let extRelease = useExt ? await lockExtensionProfile() : null;

  let browser;
  let previewTimer = null;

  try {
    const args = [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--start-maximized",
      "--window-size=1280,800",
      "--mute-audio", // sesi kapat
      "--deny-permission-prompts", // izin pop-up'larını reddet
    ];
    if (useExt) {
      fs.mkdirSync(extension.profileDir, { recursive: true });
      args.push(`--disable-extensions-except=${extension.path}`);
      args.push(`--load-extension=${extension.path}`);
      log(`Eklenti yükleniyor: ${extension.path}`);
    }
    const launchProfile = useExt ? extension.profileDir : useCookies ? userDataDir : undefined;

    log(`Tarayıcı açılıyor (headless=${effHeadless}${useExt ? ", eklenti açık" : ""})...`);
    ({ browser } = await launchBrowser({ puppeteer, headless: effHeadless,
      // useCookies=false → userDataDir verme. Puppeteer geçici bir profil açar
      // ve kapanışta siler; böylece Chrome'un kendi çerez deposu da kalmaz.
      userDataDir: launchProfile,
      args,
      proxy,
    }));
    if (extRelease) {
      const rel = extRelease;
      extRelease = null;
      browser.on("disconnected", rel); // kapanınca eklenti profili kilidini bırak
    }
    onBrowser(browser); // server bu referansla Durdur'da tarayıcıyı kapatabilir

    // Mic / kamera / bildirim izinlerini reddet → arama gelince uyarı çıkmaz.
    const ctx = browser.defaultBrowserContext();
    for (const origin of [
      "https://www.snapchat.com",
      "https://web.snapchat.com",
      "https://accounts.snapchat.com",
    ]) {
      await ctx.overridePermissions(origin, []).catch(() => {});
    }

    const page = (await browser.pages())[0] || (await browser.newPage());
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    );

    // Canlı önizleme: her ~1.2 sn'de bir küçük JPEG kare (Buffer) gönder.
    if (onPreview) {
      previewTimer = setInterval(() => {
        page
          .screenshot({ type: "jpeg", quality: 45 })
          .then((buf) => onPreview(buf))
          .catch(() => {});
      }, 1200);
    }

    if (useExt) {
      await clearSiteData(page, SNAP_ORIGINS);
      log("Eklenti profili: Snapchat oturum çerezleri temizlendi (login saklanmıyor).");
    }

    if (persistLogin) {
      await loadCookies(page, cookiesPath);
    } else {
      log("Çerez saklama kapalı: bu turda şifreyle giriş yapılacak.");
    }
    const state = await checkLoginState(page, log);

    if (state === "logged") {
      log("Kayıtlı oturumla girildi (şifre gerekmedi).");
      result.loggedIn = true;
    } else {
      const tryList = buildPasswordList(password, passwords, maxLoginAttempts);
      await loginWithPasswords(page, username, tryList, log);
      log("Login başarılı.");
      if (persistLogin) await saveCookies(page, cookiesPath, log);
      result.loggedIn = true;
    }

    if (result.loggedIn) {
      log("Web uygulamasına gidiliyor...");
      await page.goto(WEB_APP_URL, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
      await sleep(2000);
      await dismissCookieConsent(page, log);
      await dismissWelcomeDialog(page, log, 5000);
      await dismissNotificationPrompt(page, log);
      const accepted = await acceptAllFriendRequests(page, {
        maxAccepts,
        acceptDelayMin,
        acceptDelayMax,
        log,
        onHit: (n) => {
          result.accepted = n;
          onAccept(n);
        },
        shotPath: afShot,
      });
      result.accepted = accepted.accepted;
      result.limited = accepted.limited;
      log(`Bu turda ${result.accepted} istek kabul edildi.`);
      if (result.limited) {
        log("Hız sınırı nedeniyle tur erken bitti; tarayıcı kapatılıyor.");
      }
    }

    await page.screenshot({ path: okShot }).catch(() => {});
    result.screenshot = okShot;
  } catch (err) {
    result.error = err.message;
    log("HATA: " + err.message);
    // Hata anının ekran görüntüsünü al
    try {
      const pages = browser ? await browser.pages() : [];
      const p = pages[pages.length - 1];
      if (p) {
        await p.screenshot({ path: errShot });
        result.screenshot = errShot;
      }
    } catch {}
  } finally {
    if (previewTimer) clearInterval(previewTimer);
    if (browser && !keepOpen) {
      await browser.close().catch(() => {});
      log("Tarayıcı kapatıldı.");
    }
    // Launch hiç olmadıysa "disconnected" tetiklenmez → kilidi elle bırak
    if (extRelease) {
      extRelease();
      extRelease = null;
    }
  }

  return result;
}

module.exports = { runAccount, postStory, safeName, clearSession, SESSIONS_ROOT };
