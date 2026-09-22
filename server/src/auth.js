// Single-user authentication.
//
// - The owner's password is stored only as a scrypt hash in APP_PASSWORD_HASH
//   (generate it with `npm run hash-password`).
// - A successful login sets an httpOnly cookie holding a signed, expiring
//   token. The signature (HMAC-SHA256 with SESSION_SECRET) means the server
//   needs no session table.
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

export const COOKIE_NAME = "notex_session";
const SESSION_DAYS = 30;
const KEY_LEN = 64;
const SCRYPT_N = 2 ** 15;
const SCRYPT_OPTS = { N: SCRYPT_N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// Format: scrypt$<N>$<saltHex>$<hashHex>
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, SCRYPT_OPTS);
  return `scrypt$${SCRYPT_N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, n, saltHex, hashHex] = (stored || "").split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length, { ...SCRYPT_OPTS, N: Number(n) });
  return crypto.timingSafeEqual(actual, expected);
}

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: now + SESSION_DAYS * 86400_000 })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token, secret, now = Date.now()) {
  if (typeof token !== "string") return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(sig);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
}

export function sessionCookieOptions(secure) {
  return { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: SESSION_DAYS * 86400_000 };
}

// Tiny in-memory limiter for the login route: max 10 attempts per IP per 15 min.
const attempts = new Map();
export function loginRateLimited(ip, now = Date.now()) {
  const windowMs = 15 * 60_000;
  const recent = (attempts.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > 10;
}

export function requireAuth(secret) {
  return (req, res, next) => {
    if (verifySessionToken(req.cookies?.[COOKIE_NAME], secret)) return next();
    res.status(401).json({ error: "unauthorized" });
  };
}
