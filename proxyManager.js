const fs = require("fs");
const path = require("path");

const PROXY_FILE = path.join(__dirname, "data", "proxies.json");

function readAll() {
  try {
    const value = JSON.parse(fs.readFileSync(PROXY_FILE, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeAll(items) {
  fs.mkdirSync(path.dirname(PROXY_FILE), { recursive: true });
  fs.writeFileSync(PROXY_FILE, JSON.stringify(items, null, 2), { mode: 0o600 });
}

function clean(value, max = 300) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function normalize(input, existing = {}) {
  const protocol = clean(input.protocol || existing.protocol || "http").toLowerCase();
  if (!["http", "https", "socks4", "socks5"].includes(protocol)) throw new Error("Protokol HTTP, HTTPS, SOCKS4 veya SOCKS5 olmalı.");
  const host = clean(input.host || existing.host);
  const port = Number(input.port || existing.port);
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) throw new Error("Geçerli bir proxy host girin.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Geçerli bir proxy port girin.");
  const id = clean(input.id || existing.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, 80);
  if (!/^[a-z0-9._:-]+$/i.test(id)) throw new Error("Proxy ID yalnızca harf, rakam, ., _, :, - içerebilir.");
  return {
    id,
    host,
    port,
    username: clean(input.username || existing.username, 200),
    password: input.password !== undefined ? String(input.password || "").slice(0, 500) : String(existing.password || ""),
    protocol,
    enabled: input.enabled === undefined ? existing.enabled !== false : !!input.enabled,
    lastTest: existing.lastTest || null,
    lastSuccessfulAt: existing.lastSuccessfulAt || null,
  };
}

function publicProxy(proxy) {
  if (!proxy) return null;
  return {
    id: proxy.id, host: proxy.host, port: proxy.port, protocol: proxy.protocol,
    username: proxy.username ? "••••••••" : "", hasPassword: !!proxy.password,
    enabled: proxy.enabled !== false, lastTest: proxy.lastTest || null,
    lastSuccessfulAt: proxy.lastSuccessfulAt || null,
  };
}

function list() { return readAll().map(publicProxy); }
function get(id) { return readAll().find((p) => p.id === String(id)) || null; }

function upsert(input) {
  const all = readAll();
  const index = all.findIndex((p) => p.id === String(input.id || ""));
  const item = normalize(input, index >= 0 ? all[index] : {});
  if (index >= 0) all[index] = item; else all.push(item);
  writeAll(all);
  return publicProxy(item);
}

function updateTest(id, test) {
  const all = readAll();
  const index = all.findIndex((p) => p.id === String(id));
  if (index < 0) return null;
  all[index].lastTest = {
    ok: !!test.ok, ip: test.ip || null, country: test.country || null,
    latencyMs: Number.isFinite(test.latencyMs) ? test.latencyMs : null,
    error: test.ok ? null : String(test.error || "Proxy testi başarısız.").slice(0, 300),
    testedAt: Date.now(),
  };
  if (test.ok) all[index].lastSuccessfulAt = Date.now();
  writeAll(all);
  return publicProxy(all[index]);
}

function remove(id) {
  const all = readAll();
  const next = all.filter((p) => p.id !== String(id));
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
}

function proxyUrl(proxy) { return `${proxy.protocol}://${proxy.host}:${proxy.port}`; }

module.exports = { PROXY_FILE, list, get, publicProxy, upsert, updateTest, remove, proxyUrl };
