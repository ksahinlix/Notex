import express from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  COOKIE_NAME, createSessionToken, loginRateLimited, requireAuth,
  sessionCookieOptions, verifyPassword, verifySessionToken,
} from "./auth.js";
import { notesRouter } from "./routes/notes.js";
import { protectedFoldersRouter } from "./routes/protectedFolders.js";

// Builds the Express app. Kept separate from index.js so tests can create it
// with their own database and secrets.
export function createApp({ pool, sessionSecret, passwordHash, secureCookies = false, webDist = null }) {
  const app = express();
  app.set("trust proxy", 1); // Render sits behind a proxy; needed for req.ip / req.secure
  app.use(compression()); // e.g. the AI runtime: 27 MB -> ~7 MB
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

  app.post("/api/auth/login", async (req, res) => {
    if (loginRateLimited(req.ip)) return res.status(429).json({ error: "too many attempts, try again later" });
    const password = req.body?.password;
    if (typeof password !== "string" || !(await verifyPassword(password, passwordHash)))
      return res.status(401).json({ error: "wrong password" });
    res.cookie(COOKIE_NAME, createSessionToken(sessionSecret), sessionCookieOptions(secureCookies));
    res.json({ ok: true });
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    res.json({ authenticated: verifySessionToken(req.cookies?.[COOKIE_NAME], sessionSecret) });
  });

  const auth = requireAuth(sessionSecret);
  app.use("/api/notes", auth, notesRouter(pool));
  app.use("/api/protected-folders", auth, protectedFoldersRouter(pool));
  app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

  // In production the same server also serves the built web app (web/dist),
  // so the browser talks to a single origin: no CORS, strict cookies.
  if (webDist && existsSync(webDist)) {
    // Built files have content hashes in their names, so they never change:
    // let browsers keep them for a year (the AI runtime is downloaded once).
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
