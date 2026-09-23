// AI routes (login required):
//   POST /api/ai/classify  { text }  -> { path, isNew, alternatives }
//   GET  /api/ai/search?q=...        -> { ids, reranked }
// Returns 503 when Cloudflare isn't configured, so the app keeps working
// without AI (paths typed by hand, keyword search).
//
// Limits (D16): anyone can sign up, and all users share Cloudflare's free
// daily allowance, so each user gets AI_DAILY_LIMIT requests per day (UTC)
// and at most PER_MINUTE per minute.
import { Router } from "express";

const PER_MINUTE = 40;
export const DEFAULT_DAILY_LIMIT = 150;

export function aiRouter(service, { pool, dailyLimit = DEFAULT_DAILY_LIMIT } = {}) {
  const r = Router();
  const recent = new Map(); // userId -> timestamps in the last minute

  r.use((_req, res, next) => (service ? next() : res.status(503).json({ error: "ai not configured" })));

  /** Counts a request against the user's limits; answers 429 and returns false when over. */
  async function allow(req, res) {
    const now = Date.now();
    const calls = (recent.get(req.userId) ?? []).filter((t) => now - t < 60_000);
    if (calls.length >= PER_MINUTE) {
      res.status(429).json({ error: "too many AI requests, wait a minute" });
      return false;
    }
    calls.push(now);
    recent.set(req.userId, calls);
    const { rows } = await pool.query(
      `INSERT INTO ai_usage (user_id, day, calls) VALUES ($1, (now() AT TIME ZONE 'utc')::date, 1)
       ON CONFLICT (user_id, day) DO UPDATE SET calls = ai_usage.calls + 1
       RETURNING calls`,
      [req.userId],
    );
    if (rows[0].calls > dailyLimit) {
      res.status(429).json({ error: "daily AI limit reached", limit: dailyLimit });
      return false;
    }
    return true;
  }

  const fail = (res, e) => res.status(e.status === 429 ? 429 : 502).json({ error: e.message || "ai failed" });

  r.post("/classify", async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (text.length < 3) return res.status(400).json({ error: "text too short" });
    if (!(await allow(req, res))) return;
    try {
      res.json(await service.classify(req.userId, text));
    } catch (e) {
      fail(res, e);
    }
  });

  r.get("/search", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    if (q.length < 2) return res.status(400).json({ error: "query too short" });
    if (!(await allow(req, res))) return;
    try {
      res.json(await service.search(req.userId, q));
    } catch (e) {
      fail(res, e);
    }
  });

  return r;
}
