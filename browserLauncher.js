function safeProxyError(error, proxy) {
  const where = proxy ? `${proxy.host}:${proxy.port}` : "proxy";
  const message = String(error && error.message || error || "bilinmeyen hata")
    .replace(/(https?:\/\/)([^\s/@]+):([^\s/@]+)@/gi, "$1[redacted]@");
  return new Error(`Proxy bağlantısı kurulamadı (${where}): ${message}`);
}

async function launchBrowser({ puppeteer, headless, userDataDir, args = [], proxy = null }) {
  const launchArgs = [...args];
  if (proxy) {
    if (!proxy.enabled) throw new Error(`Proxy devre dışı: ${proxy.id}`);
    launchArgs.push(`--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`);
    if ((proxy.protocol === "socks4" || proxy.protocol === "socks5") && (proxy.username || proxy.password)) {
      throw new Error(`Chrome SOCKS proxy kimlik doğrulaması desteklenmiyor: ${proxy.id}. Kullanıcı adı/parolalı SOCKS için HTTP(S) proxy kullanın.`);
    }
  }
  let browser;
  try {
    browser = await puppeteer.launch({ headless, defaultViewport: null, userDataDir, args: launchArgs });
  } catch (error) {
    throw proxy ? safeProxyError(error, proxy) : error;
  }

  const authenticate = async (page) => {
    if (!proxy || (!proxy.username && !proxy.password)) return;
    try { await page.authenticate({ username: proxy.username, password: proxy.password }); }
    catch (error) { throw safeProxyError(error, proxy); }
  };
  for (const page of await browser.pages()) await authenticate(page);
  browser.on("targetcreated", (target) => {
    target.page().then(authenticate).catch(() => {});
  });
  return { browser, authenticate };
}

module.exports = { launchBrowser, safeProxyError };
