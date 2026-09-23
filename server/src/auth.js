// Authentication (D16): "Sign in with Google", multiple users.
//
// - The browser gets a Google ID token (a signed JWT) from Google's button and
//   posts it to /api/auth/google. We verify it with Google's library against
//   our OAuth client ID, then find or create the user.
// - A successful login sets an httpOnly cookie holding a signed, expiring
//   token with the user's id (HMAC-SHA256 with SESSION_SECRET), so the server
//   needs no session table.
import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";

export const COOKIE_NAME = "notex_session";
const SESSION_DAYS = 30;

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(secret, userId, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: now + SESSION_DAYS * 86400_000 })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** The user id in a valid, unexpired token; otherwise null. */
export function verifySessionToken(token, secret, now = Date.now()) {
  if (typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(sig);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof uid === "string" && typeof exp === "number" && exp > now ? uid : null;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(secure) {
  // Strict works with Google's button: it hands the token to our page's
  // JavaScript, which posts it same-site. All API calls are same-site fetches.
  return { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: SESSION_DAYS * 86400_000 };
}

// Tiny in-memory limiter for the login route: max 20 attempts per IP per 15 min.
const attempts = new Map();
export function loginRateLimited(ip, now = Date.now()) {
  const windowMs = 15 * 60_000;
  const recent = (attempts.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > 20;
}

/** Sets req.userId, or answers 401. */
export function requireAuth(secret) {
  return (req, res, next) => {
    const uid = verifySessionToken(req.cookies?.[COOKIE_NAME], secret);
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    req.userId = uid;
    next();
  };
}

/**
 * Returns a function that checks a Google ID token and returns
 * { sub, email, name, picture }, or throws. Only verified emails are accepted.
 */
export function googleVerifier(clientId) {
  const client = new OAuth2Client(clientId);
  return async (credential) => {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email || !p.email_verified) throw new Error("unverified Google account");
    return { sub: p.sub, email: p.email, name: p.name ?? null, picture: p.picture ?? null };
  };
}
