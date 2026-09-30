import { Router } from "express";
import { sendDueReminders } from "../push.js";

/**
 * Notifications (D21): the browser asks for the public key, sends back the
 * subscription its push service gave it, and an outside scheduler calls
 * /due to make the server send whatever has come due.
 */
export function pushRouter(pool, { push, requireAuth, cronSecret }) {
  const r = Router();

  // The browser needs this before it can subscribe. No key = no notifications.
  r.get("/key", (_req, res) => res.json({ publicKey: push?.publicKey ?? null }));

  r.post("/subscribe", requireAuth, async (req, res) => {
    const { endpoint, keys } = req.body ?? {};
    if (typeof endpoint !== "string" || !endpoint.startsWith("https://") || !keys?.p256dh || !keys?.auth)
      return res.status(400).json({ error: "invalid subscription" });
    await pool.query(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [endpoint, req.userId, keys.p256dh, keys.auth],
    );
    res.status(201).json({ ok: true });
  });

  // Turning notifications off on this device.
  r.post("/unsubscribe", requireAuth, async (req, res) => {
    const { endpoint } = req.body ?? {};
    if (typeof endpoint !== "string") return res.status(400).json({ error: "endpoint required" });
    await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2", [endpoint, req.userId]);
    res.status(204).end();
  });

  /** Which of this user's devices are switched on (to show the state). */
  r.get("/status", requireAuth, async (req, res) => {
    const { rows } = await pool.query("SELECT count(*)::int AS devices FROM push_subscriptions WHERE user_id = $1", [req.userId]);
    res.json({ configured: !!push, devices: rows[0].devices });
  });

  /**
   * Sends a notification to your own devices, now. It answers the question a
   * reminder cannot: whether the chain from here to the screen works, without
   * waiting for a reminder to come due — and it tells the two failures apart,
   * because a notification that was sent but never seen is the operating
   * system hiding it.
   */
  r.post("/test", requireAuth, async (req, res) => {
    if (!push) return res.status(503).json({ error: "push not configured" });
    const result = await push.sendToUsers(pool, [req.userId], {
      title: "Notex",
      body: "Test bildirimi. Bunu gördüysen hatırlatmalar da gelecek.",
      noteId: null,
      at: new Date().toISOString(),
    });
    res.json(result);
  });

  return r;
}

/**
 * POST /api/reminders/due — called every few minutes by an outside scheduler
 * (cron-job.org), because a free Render service sleeps and has no cron. The
 * shared secret keeps strangers from driving it; without CRON_SECRET set, the
 * endpoint stays closed.
 */
export function remindersDueRoute(pool, { push, cronSecret }) {
  return async (req, res) => {
    const given = req.get("x-cron-key") ?? req.query.key;
    if (!cronSecret || given !== cronSecret) return res.status(401).json({ error: "unauthorized" });
    res.json(await sendDueReminders(pool, push));
  };
}
