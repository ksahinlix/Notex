import { Router } from "express";
import { buildBackup, runBackup } from "../backup.js";

/**
 * Backups (D23). Two doors onto the same dump:
 *
 * - `POST /api/backup` is driven by the same outside scheduler as the
 *   reminders (D21) and authenticates with CRON_SECRET, not a session. It
 *   writes every user's data to Cloudflare R2.
 * - `GET /api/export` hands you your own data as a file, from the button in
 *   the app. A session is required and you only ever get your own.
 */
export function backupRoute(pool, { r2, cronSecret, version = null }) {
  return async (req, res) => {
    const given = req.get("x-cron-key") ?? req.query.key;
    if (!cronSecret || given !== cronSecret) return res.status(401).json({ error: "unauthorized" });
    if (!r2) return res.status(503).json({ error: "backup storage not configured" });
    try {
      res.json(await runBackup(pool, r2, { version }));
    } catch (err) {
      // The scheduler shows the status code, so a failed backup is visible
      // rather than silently never happening.
      console.error("backup failed:", err);
      res.status(502).json({ error: "backup failed", detail: String(err.message ?? err).slice(0, 300) });
    }
  };
}

export function exportRouter(pool) {
  const r = Router();

  r.get("/", async (req, res) => {
    const dump = await buildBackup(pool, { userId: req.userId });
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="notex-${day}.json"`);
    res.send(JSON.stringify(dump, null, 2));
  });

  return r;
}
