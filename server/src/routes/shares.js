import { Router } from "express";
import { acceptShare, createShare, email, hasProtected, listShares, moveShares, removeShare, toApiShare, validatePath } from "../shares.js";

// Sharing a folder with someone (D18). req.userId is set by requireAuth;
// req.user carries the signed-in e-mail, which is how invitees are named.
export function sharesRouter(pool, { findUser }) {
  const r = Router();

  const me = async (req) => (req.user ??= await findUser(pool, req.userId));

  // Everything this user shares, and everything shared with them.
  r.get("/", async (req, res) => {
    const user = await me(req);
    res.json(await listShares(pool, req.userId, user.email));
  });

  // POST /api/shares { path, email } -> invite someone to a folder.
  r.post("/", async (req, res) => {
    const { path } = req.body ?? {};
    const invited = email(req.body?.email);
    const bad = validatePath(path);
    if (bad) return res.status(400).json({ error: bad });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invited)) return res.status(400).json({ error: "invalid email" });
    const user = await me(req);
    if (invited === email(user.email)) return res.status(400).json({ error: "that is you" });
    // Locked folders are encrypted in the browser with a password we never
    // see, so the other person could not read a single note (D8).
    if (await hasProtected(pool, req.userId, path)) return res.status(400).json({ error: "locked folders cannot be shared" });
    res.status(201).json(toApiShare(await createShare(pool, req.userId, path, invited)));
  });

  // POST /api/shares/accept { token } or { id }
  r.post("/accept", async (req, res) => {
    const { token, id } = req.body ?? {};
    if (!token && !id) return res.status(400).json({ error: "token or id required" });
    const user = await me(req);
    const share = await acceptShare(pool, req.userId, user.email, { token, id });
    if (!share) return res.status(404).json({ error: "no invite for this account" });
    res.json(toApiShare(share));
  });

  // The owner withdraws a share; the invitee can use it to leave.
  r.delete("/:id", async (req, res) => {
    const user = await me(req);
    res.status((await removeShare(pool, req.userId, user.email, req.params.id)) ? 204 : 404).end();
  });

  // POST /api/shares/move { from, to } -> the owner renamed or moved a shared
  // folder; keep the shares pointing at it (the client sends this with the
  // note updates, see store.moveFolder).
  r.post("/move", async (req, res) => {
    const { from, to } = req.body ?? {};
    const bad = validatePath(from) ?? validatePath(to);
    if (bad) return res.status(400).json({ error: bad });
    res.json({ moved: await moveShares(pool, req.userId, from, to) });
  });

  return r;
}
