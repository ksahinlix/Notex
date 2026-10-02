import { Router } from "express";
import { backupFile, buildBackup, runBackup } from "../backup.js";

/**
 * Backups (D23). Two doors onto the same dump:
 *
 * - `POST /api/backup` has the server push every user's data to a bucket.
 * - `GET /api/backup` hands the same file back instead, so whatever is doing
 *   the asking can store it — a scheduled job, a machine at home. This is the
 *   one that needs no account anywhere.
 *
 * Both are driven by an outside scheduler and authenticate with CRON_SECRET,
 * not a session, so a signed-in user cannot drive either.
 * - `GET /api/export` hands you your own data as a file, from the button in
 *   the app. A session is required and you only ever get your own.
 */
const authorized = (req, cronSecret) => !!cronSecret && (req.get("x-cron-key") ?? req.query.key) === cronSecret;

/** GET: the backup file itself, for whoever asked to store it. */
export function backupDownloadRoute(pool, { cronSecret, version = null }) {
  return async (req, res) => {
    if (!authorized(req, cronSecret)) return res.status(401).json({ error: "unauthorized" });
    const file = await backupFile(pool, { version });
    res.setHeader("content-type", "application/gzip");
    res.setHeader("content-disposition", `attachment; filename="${file.key.split("/").pop()}"`);
    // What went in, without having to unzip it to find out.
    res.setHeader("x-notex-counts", JSON.stringify(file.counts));
    res.send(file.body);
  };
}

export function backupRoute(pool, { r2, cronSecret, version = null }) {
  return async (req, res) => {
    if (!authorized(req, cronSecret)) return res.status(401).json({ error: "unauthorized" });
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
