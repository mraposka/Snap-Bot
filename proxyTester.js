const net = require("net");
const tls = require("tls");
const https = require("https");
const { SocksProxyAgent } = require("socks-proxy-agent");

const IP_URL = "api.ipify.org";
const COUNTRY_URL = "ipwho.is";

function requestThroughProxy(proxy, host, port, path, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = proxy.protocol === "https"
      ? tls.connect({ host: proxy.host, port: proxy.port, servername: proxy.host, rejectUnauthorized: true })
      : net.connect({ host: proxy.host, port: proxy.port });
    let settled = false;
    let buffer = Buffer.alloc(0);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve({ ...value, latencyMs: Date.now() - started });
    };
    const auth = proxy.username || proxy.password
      ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username || ""}:${proxy.password || ""}`).toString("base64")}\r\n` : "";
    const connectRequest = `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}Connection: close\r\n\r\n`;
    socket.setTimeout(timeoutMs, () => finish(new Error("zaman aşımı")));
    socket.once("error", (error) => finish(error));
    socket.once("secureConnect", () => socket.write(connectRequest));
    socket.once("connect", () => { if (proxy.protocol !== "https") socket.write(connectRequest); });
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const headers = buffer.subarray(0, headerEnd).toString("latin1");
      const status = /^HTTP\/\d(?:\.\d)?\s+(\d+)/i.exec(headers);
      if (!status || Number(status[1]) !== 200) return finish(new Error(`proxy CONNECT yanıtı: ${status ? status[1] : "geçersiz"}`));
      socket.removeAllListeners("data");
      const secure = tls.connect({ socket, servername: host, rejectUnauthorized: true });
      let body = Buffer.alloc(0);
      secure.setTimeout(timeoutMs, () => finish(new Error("hedef yanıtı zaman aşımı")));
      secure.once("error", (error) => finish(error));
      secure.once("secureConnect", () => secure.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nAccept: application/json\r\nConnection: close\r\n\r\n`));
      secure.on("data", (part) => { body = Buffer.concat([body, part]); });
      secure.on("end", () => {
        const split = body.indexOf("\r\n\r\n");
        if (split < 0) return finish(new Error("hedef yanıtı okunamadı"));
        const responseHeaders = body.subarray(0, split).toString("latin1");
        const responseBody = body.subarray(split + 4).toString("utf8");
        const responseStatus = /^HTTP\/\d(?:\.\d)?\s+(\d+)/i.exec(responseHeaders);
        if (!responseStatus || Number(responseStatus[1]) < 200 || Number(responseStatus[1]) >= 300)
          return finish(new Error(`IP servisi HTTP ${responseStatus ? responseStatus[1] : "?"}`));
        try { finish(null, { data: JSON.parse(responseBody) }); } catch { finish(new Error("IP servisi JSON döndürmedi")); }
      });
    });
  });
}

function requestThroughSocks(proxy, host, path, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const auth = proxy.username || proxy.password
      ? `${encodeURIComponent(proxy.username || "")} :${encodeURIComponent(proxy.password || "")}`.replace(" :", ":")
      : "";
    const agent = new SocksProxyAgent(`${proxy.protocol}://${auth ? `${auth}@` : ""}${proxy.host}:${proxy.port}`);
    const req = https.get({ hostname: host, path, port: 443, agent, headers: { Accept: "application/json" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (part) => { body += part; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`IP servisi HTTP ${res.statusCode}`));
        try { resolve({ data: JSON.parse(body), latencyMs: Date.now() - started }); } catch { reject(new Error("IP servisi JSON döndürmedi")); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("zaman aşımı")));
    req.once("error", reject);
  });
}

async function testProxy(proxy, { timeoutMs = 15000 } = {}) {
  const started = Date.now();
  try {
    const socks = proxy.protocol === "socks4" || proxy.protocol === "socks5";
    const request = (host, targetPath) => socks
      ? requestThroughSocks(proxy, host, targetPath, timeoutMs)
      : requestThroughProxy(proxy, host, 443, targetPath, timeoutMs);
    const ipResult = await request(IP_URL, "/?format=json");
    const ip = ipResult.data && ipResult.data.ip;
    if (!ip) throw new Error("public IP alınamadı");
    let country = null;
    try { country = (await request(COUNTRY_URL, `/${encodeURIComponent(ip)}`)).data.country || null; } catch {}
    return { ok: true, ip, country, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, ip: null, country: null, latencyMs: Date.now() - started, error: String(error.message || error).slice(0, 300) };
  }
}

module.exports = { testProxy };
