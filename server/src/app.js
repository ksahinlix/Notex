import express from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  COOKIE_NAME, createSessionToken, googleVerifier, loginRateLimited, requireAuth,
  sessionCookieOptions, verifySessionToken,
} from "./auth.js";
import { findUser, toApiUser, upsertGoogleUser } from "./users.js";
import { aiRouter } from "./routes/ai.js";
import { imageProxyRouter } from "./routes/imageProxy.js";
import { notesRouter } from "./routes/notes.js";
import { protectedFoldersRouter } from "./routes/protectedFolders.js";
import { sharesRouter } from "./routes/shares.js";

// Builds the Express app. Kept separate from index.js so tests can create it
// with their own database and secrets.
export function createApp({
  pool, sessionSecret, googleClientId, ownerEmail = null,
  // Tests pass a fake; production verifies with Google's library.
  verifyGoogle = googleClientId ? googleVerifier(googleClientId) : null,
  secureCookies = false, webDist = null, imageProxy = {}, aiService = null, aiDailyLimit,
}) {
  const app = express();
  app.set("trust proxy", 1); // Render sits behind a proxy; needed for req.ip / req.secure
  app.use(compression());
  app.use(express.json({ limit: "10mb" })); // images are still inline data URLs for now
  app.use(cookieParser());

  app.get("/api/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true, db: "up" });
    } catch {
      res.status(503).json({ ok: false, db: "down" });
    }
  });

  // Public: the browser needs the OAuth client ID to show Google's button.
  app.get("/api/auth/config", (_req, res) => res.json({ googleClientId: googleClientId ?? null }));

  // POST /api/auth/google { credential } -> signs in (and signs up) with Google.
  app.post("/api/auth/google", async (req, res) => {
    if (loginRateLimited(req.ip)) return res.status(429).json({ error: "too many attempts, try again later" });
    if (!verifyGoogle) return res.status(503).json({ error: "Google login not configured" });
    const credential = req.body?.credential;
    if (typeof credential !== "string" || credential.length > 5000) return res.status(400).json({ error: "missing credential" });
    let google;
    try {
      google = await verifyGoogle(credential);
    } catch {
      return res.status(401).json({ error: "invalid Google sign-in" });
    }
    const user = await upsertGoogleUser(pool, google, ownerEmail);
    res.cookie(COOKIE_NAME, createSessionToken(sessionSecret, user.id), sessionCookieOptions(secureCookies));
    res.json({ user: toApiUser(user) });
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.json({ ok: true });
  });

  app.get("/api/auth/me", async (req, res) => {
    const uid = verifySessionToken(req.cookies?.[COOKIE_NAME], sessionSecret);
    const user = uid ? await findUser(pool, uid) : null;
    res.json(user ? { authenticated: true, user: toApiUser(user) } : { authenticated: false });
  });

  const auth = requireAuth(sessionSecret);
  app.use("/api/notes", auth, notesRouter(pool));
  app.use("/api/protected-folders", auth, protectedFoldersRouter(pool));
  app.use("/api/shares", auth, sharesRouter(pool, { findUser }));
  app.use("/api/image-proxy", auth, imageProxyRouter(imageProxy));
  app.use("/api/ai", auth, aiRouter(aiService, { pool, dailyLimit: aiDailyLimit }));
  app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

  // In production the same server also serves the built web app (web/dist),
  // so the browser talks to a single origin: no CORS, strict cookies.
  if (webDist && existsSync(webDist)) {
    // Built files have content hashes in their names, so they never change:
    // let browsers keep them for a year.
    app.use("/assets", express.static(path.join(webDist, "assets"), { immutable: true, maxAge: "1y" }));
    app.use(express.static(webDist));
    app.get("/{*splat}", (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : "internal error" });
  });

  return app;
}
