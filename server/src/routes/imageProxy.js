// GET /api/image-proxy?url=https://...  (login required)
//
// When a web page is pasted into a note, its images live on other sites, and
// the browser usually can't download them (CORS). The server fetches them
// instead and returns the bytes; the browser then shrinks and stores them.
//
// Guarded against SSRF: only http(s), every hop's host must resolve to a
// public address, redirects are followed manually (max 3), images only, 8 MB max.
import { Router } from "express";
import { lookup } from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

/** True for loopback, private, link-local, CGNAT, multicast and other non-public ranges. */
export function isPrivateAddress(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7)); // IPv4-mapped
    return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

async function assertPublic(url) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw Object.assign(new Error("only http(s) urls"), { status: 400 });
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address)))
    throw Object.assign(new Error("address not allowed"), { status: 400 });
}

export function imageProxyRouter({ fetchImpl = fetch, check = assertPublic } = {}) {
  const r = Router();

  r.get("/", async (req, res) => {
    let url;
    try {
      url = new URL(String(req.query.url || ""));
    } catch {
      return res.status(400).json({ error: "invalid url" });
    }
    try {
      let response;
      for (let hop = 0; ; hop++) {
        await check(url);
        response = await fetchImpl(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { "user-agent": "Mozilla/5.0 (Notex image fetch)", accept: "image/*" },
        });
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get("location");
        if (!location || hop >= MAX_REDIRECTS) return res.status(502).json({ error: "too many redirects" });
        url = new URL(location, url);
      }
      if (!response.ok) return res.status(502).json({ error: `upstream ${response.status}` });
      const type = response.headers.get("content-type") || "";
      if (!type.startsWith("image/")) return res.status(415).json({ error: "not an image" });
      if (Number(response.headers.get("content-length")) > MAX_BYTES) return res.status(413).json({ error: "image too large" });

      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_BYTES) return res.status(413).json({ error: "image too large" });
        chunks.push(chunk);
      }
      res.set("content-type", type).set("cache-control", "private, max-age=3600").send(Buffer.concat(chunks));
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      res.status(502).json({ error: e.name === "TimeoutError" ? "upstream timeout" : "fetch failed" });
    }
  });

  return r;
}
