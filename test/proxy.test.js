const test = require("node:test");
const assert = require("node:assert/strict");
const { launchBrowser, safeProxyError } = require("../browserLauncher");

test("proxy başlatıcı mevcut Chrome argümanlarını korur ve proxy argümanı ekler", async () => {
  let options;
  const page = { authenticate: async (credentials) => { assert.deepEqual(credentials, { username: "u", password: "p" }); } };
  const browser = { pages: async () => [page], on: () => {} };
  const mockPuppeteer = { launch: async (opts) => { options = opts; return browser; } };
  const result = await launchBrowser({ puppeteer: mockPuppeteer, headless: true, args: ["--no-sandbox"], proxy: { id: "p1", host: "127.0.0.1", port: 8080, protocol: "http", username: "u", password: "p", enabled: true } });
  assert.equal(result.browser, browser);
  assert.deepEqual(options.args, ["--no-sandbox", "--proxy-server=http://127.0.0.1:8080"]);
  assert.equal(options.headless, true);
});

test("devre dışı proxy tarayıcı açılmadan reddedilir", async () => {
  await assert.rejects(() => launchBrowser({ puppeteer: { launch: () => { throw new Error("çağrılmamalı"); } }, args: [], proxy: { id: "kapalı", host: "x", port: 1, protocol: "http", enabled: false } }), /devre dışı/);
});

test("proxy hata mesajı kimlik bilgilerini içermez", () => {
  const error = safeProxyError(new Error("https://user:secret@example.test bağlantı hatası"), { host: "example.test", port: 1234 });
  assert.match(error.message, /\[redacted\]/);
  assert.doesNotMatch(error.message, /secret/);
});
