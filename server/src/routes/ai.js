// AI routes (login required):
//   POST /api/ai/classify  { text }  -> { path, isNew, alternatives }
//   GET  /api/ai/search?q=...        -> { ids, reranked }
// Returns 503 when Cloudflare isn't configured, so the app keeps working
// without AI (paths typed by hand, keyword search).
import { Router } from "express";

const PER_MINUTE = 40; // protects the free daily allowance from runaway loops

export function aiRouter(service) {
  const r = Router();
  const calls = [];

  r.use((req, res, next) => {
    if (!service) return res.status(503).json({ error: "ai not configured" });
    const now = Date.now();
    while (calls.length && now - calls[0] > 60_000) calls.shift();
    if (calls.length >= PER_MINUTE) return res.status(429).json({ error: "too many AI requests, wait a minute" });
    calls.push(now);
    next();
  });

  const fail = (res, e) => res.status(e.status === 429 ? 429 : 502).json({ error: e.message || "ai failed" });

  r.post("/classify", async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (text.length < 3) return res.status(400).json({ error: "text too short" });
    try {
      res.json(await service.classify(text));
    } catch (e) {
      fail(res, e);
    }
  });

  r.get("/search", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    if (q.length < 2) return res.status(400).json({ error: "query too short" });
    try {
      res.json(await service.search(q));
    } catch (e) {
      fail(res, e);
    }
  });

  return r;
}
