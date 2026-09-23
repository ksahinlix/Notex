import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { COOKIE_NAME, createSessionToken, hashPassword } from "../src/auth.js";
import { isPrivateAddress } from "../src/routes/imageProxy.js";

test("private addresses are recognized", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "93.184.216.34", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
});

// Fake upstream: maps URLs to responses, so no real network is used.
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const upstream = {
  "https://img.example/cat.png": () => new Response(PNG, { headers: { "content-type": "image/png" } }),
  "https://img.example/page.html": () => new Response("<html>", { headers: { "content-type": "text/html" } }),
  "https://img.example/redirect": () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret.png" } }),
  "https://img.example/big.png": () => new Response(Buffer.alloc(9 * 1024 * 1024), { headers: { "content-type": "image/png" } }),
};
const fetchImpl = async (url) => (upstream[String(url)] ?? (() => new Response("nope", { status: 404 })))();
// Hosts under img.example count as public; everything else goes through the real IP check.
const check = async (url) => {
  if (url.hostname === "img.example") return;
  if (!isPrivateAddress(url.hostname)) return;
  throw Object.assign(new Error("address not allowed"), { status: 400 });
};

let server, base, cookie;
before(async () => {
  const app = createApp({ pool: { query: async () => ({ rows: [] }) }, sessionSecret: "s", passwordHash: await hashPassword("pw"), imageProxy: { fetchImpl, check } });
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/image-proxy?url=`;
  cookie = `${COOKIE_NAME}=${createSessionToken("s")}`;
});
after(() => server?.close());

const get = (u, auth = true) => fetch(base + encodeURIComponent(u), { headers: auth ? { cookie } : {} });

test("image proxy", async () => {
  assert.equal((await get("https://img.example/cat.png", false)).status, 401);
  const ok = await get("https://img.example/cat.png");
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), PNG);
  assert.equal((await get("https://img.example/page.html")).status, 415);
  assert.equal((await get("https://img.example/redirect")).status, 400); // redirect to 127.0.0.1 blocked
  assert.equal((await get("http://169.254.169.254/latest")).status, 400);
  assert.equal((await get("file:///etc/passwd")).status, 400);
  assert.equal((await get("not a url")).status, 400);
  assert.equal((await get("https://img.example/big.png")).status, 413);
  assert.equal((await get("https://img.example/missing.png")).status, 502);
});
