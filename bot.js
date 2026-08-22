/**
 * Snapchat Web otomasyon motoru (tek kaynak).
 * runAccount() bir hesabı: login eder → snapchat.com/web'e gider →
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
const ADD_FRIENDS_TEXTS = [
  "add friends",
  "arkadaş ekle",
  "arkadas ekle",
  "added me",
  "beni ekleyenler",
];

const SESSIONS_ROOT = path.join(__dirname, "sessions");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
// max'a ulaşınca ya da idleTimeout süresince yeni çıkmayınca durur.
async function clickAllByText(page, texts, { max = 300, delay = 500, idleTimeout = 6000, onHit, log } = {}) {
  const wanted = texts.map((t) => t.toLowerCase());
  let total = 0;
  let lastHit = Date.now();

  while (total < max) {
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
      await sleep(delay);
    } else {
      if (Date.now() - lastHit > idleTimeout) break;
      await sleep(400);
    }
  }
  return total;
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

async function acceptAllFriendRequests(page, maxAccepts, log, onHit, shotPath) {
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

  const max = maxAccepts > 0 ? maxAccepts : Infinity;
  const n = await clickAllByText(page, ACCEPT_TEXTS, {
    max,
    delay: 600,
    idleTimeout: 6000,
    onHit,
    log,
  });
  return n;
}

function urlLooksLoggedIn(url) {
  if (WELCOME_RE.test(url)) return true;
  if (/\/v2\/login|\/login|www\.snapchat\.com/i.test(url)) return false;
  return /accounts\.snapchat\.com/i.test(url);
}

async function checkLoginState(page, log) {
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
  await sleep(2000);
  const url = page.url();
  log("Kontrol URL: " + url);
  if (WELCOME_RE.test(url)) return "logged";
  const userInput = await queryAny(page, USER_SELECTORS);
  if (userInput) return "needlogin";
  if (/accounts\.snapchat\.com/i.test(url) && !/\/login/i.test(url)) return "logged";
  return "unknown";
}

async function doPasswordLogin(page, username, password, log) {
  if (!username || !password) throw new Error("Kullanıcı adı / şifre eksik.");

  let userField = await queryAny(page, USER_SELECTORS);
  if (!userField) {
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });
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

// --------------------------------------------------------------- runAccount ---
/**
 * @param {object} o
 * @param {string} o.username
 * @param {string} o.password
 * @param {boolean} [o.headless=false]
 * @param {number}  [o.maxAccepts=0]  0 = sınırsız
 * @param {function}[o.log]           (satır) => void
 * @param {function}[o.onAccept]      (toplamSayı) => void
 * @param {boolean} [o.keepOpen=false] true ise tarayıcı kapatılmaz (CLI için)
 * @returns {Promise<{username,loggedIn,accepted,error,screenshot}>}
 */
async function runAccount(o) {
  const {
    username,
    password,
    headless = false,
    maxAccepts = 0,
    log = () => {},
    onAccept = () => {},
    onBrowser = () => {}, // tarayıcı açılınca referansı dışarı ver (durdurmak için)
    onPreview = null, // (dataUrl) => void — canlı önizleme kareleri
    keepOpen = false,
  } = o;

  const userKey = safeName(username);
  const sessionDir = path.join(SESSIONS_ROOT, userKey);
  const cookiesPath = path.join(sessionDir, "cookies.json");
  const userDataDir = path.join(sessionDir, "profile");
  const okShot = path.join(sessionDir, "sonuc.png");
  const errShot = path.join(sessionDir, "error.png");
  const afShot = path.join(sessionDir, "addfriends.png"); // teşhis: panel açık hali
  fs.mkdirSync(sessionDir, { recursive: true });

  const result = { username, loggedIn: false, accepted: 0, error: null, screenshot: null };
  let browser;
  let previewTimer = null;

  try {
    log(`Tarayıcı açılıyor (headless=${headless})...`);
    browser = await puppeteer.launch({
      headless,
      defaultViewport: null,
      userDataDir,
      args: [
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--start-maximized",
        "--window-size=1280,800",
        "--mute-audio", // sesi kapat
        "--deny-permission-prompts", // izin pop-up'larını reddet
      ],
    });
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

    await loadCookies(page, cookiesPath);
    const state = await checkLoginState(page, log);

    if (state === "logged") {
      log("Kayıtlı oturumla girildi (şifre gerekmedi).");
      result.loggedIn = true;
    } else {
      await doPasswordLogin(page, username, password, log);
      await sleep(1000);
      if (urlLooksLoggedIn(page.url())) {
        log("Login başarılı.");
        await saveCookies(page, cookiesPath, log);
        result.loggedIn = true;
      } else {
        throw new Error("Login tamamlanamadı (captcha / doğrulama gerekebilir).");
      }
    }

    if (result.loggedIn) {
      log("Web uygulamasına gidiliyor...");
      await page.goto(WEB_APP_URL, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
      await sleep(2000);
      await dismissNotificationPrompt(page, log);
      result.accepted = await acceptAllFriendRequests(
        page,
        maxAccepts,
        log,
        (n) => {
          result.accepted = n;
          onAccept(n);
        },
        afShot
      );
      log(`Bu turda ${result.accepted} istek kabul edildi.`);
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
  }

  return result;
}

module.exports = { runAccount, safeName, SESSIONS_ROOT };
