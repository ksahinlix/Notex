import { Router } from "express";

// DB row -> API object (camelCase).
export function toApi(row) {
  return {
    id: row.id,
    path: row.path,
    encrypted: row.encrypted,
    content: row.content,
    cipher: row.cipher,
    isListItem: row.is_list_item,
    checked: row.checked,
    reminderAt: row.reminder_at?.toISOString() ?? null,
    // A reminder with or without a date (reminderAt null = "undated").
    isReminder: row.is_reminder || !!row.reminder_at,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
  };
}

const isIso = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));

// Returns an error message, or null if the note body is valid.
export function validateNote(body) {
  if (!body || typeof body !== "object") return "body must be an object";
  const { path, encrypted, content, cipher, reminderAt, createdAt, updatedAt } = body;
  if (!Array.isArray(path) || path.length < 1 || !path.every((s) => typeof s === "string" && s.trim() && !s.includes("/")))
    return "path must be a non-empty array of non-empty strings without '/'";
  if (typeof encrypted !== "boolean") return "encrypted must be a boolean";
  if (encrypted && (typeof cipher !== "string" || content != null)) return "encrypted notes need cipher and no content";
  if (!encrypted && (typeof content !== "object" || content === null || cipher != null)) return "plain notes need content and no cipher";
  if (reminderAt != null && !isIso(reminderAt)) return "reminderAt must be an ISO date or null";
  if (body.isReminder !== undefined && typeof body.isReminder !== "boolean") return "isReminder must be a boolean";
  if (!isIso(createdAt) || !isIso(updatedAt)) return "createdAt and updatedAt must be ISO dates";
  return null;
}

/** Storage per user (D16): note content incl. inline images. Neon's free tier is 0.5 GB in total. */
export const MAX_BYTES_PER_USER = 50 * 1024 * 1024;

// All routes are per user: req.userId is set by requireAuth.
export function notesRouter(pool) {
  const r = Router();

  // GET /api/notes            -> all live notes
  // GET /api/notes?since=ISO  -> everything changed after `since`, including deletions
  r.get("/", async (req, res) => {
    const { since } = req.query;
    if (since !== undefined && !isIso(since)) return res.status(400).json({ error: "invalid since" });
    const { rows } = since
      ? await pool.query("SELECT * FROM notes WHERE user_id = $1 AND updated_at > $2 ORDER BY updated_at", [req.userId, since])
      : await pool.query("SELECT * FROM notes WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC", [req.userId]);
    res.json({ notes: rows.map(toApi), serverTime: new Date().toISOString() });
  });

  // PUT /api/notes/:id -> create or replace (last write wins by updatedAt).
  r.put("/:id", async (req, res) => {
    const error = validateNote(req.body);
    if (error) return res.status(400).json({ error });
    const n = req.body;
    const payload = n.encrypted ? n.cipher : JSON.stringify(n.content);

    const used = await pool.query(
      `SELECT coalesce(sum(octet_length(coalesce(content::text, cipher))), 0)::bigint AS bytes
       FROM notes WHERE user_id = $1 AND deleted_at IS NULL AND id <> $2`,
      [req.userId, req.params.id],
    );
    if (Number(used.rows[0].bytes) + Buffer.byteLength(payload) > MAX_BYTES_PER_USER)
      return res.status(413).json({ error: "storage quota exceeded" });

    const { rows } = await pool.query(
      `INSERT INTO notes (id, user_id, path, encrypted, content, cipher, is_list_item, checked, reminder_at, created_at, updated_at, is_reminder, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL)
       ON CONFLICT (id) DO UPDATE SET
         path = EXCLUDED.path, encrypted = EXCLUDED.encrypted, content = EXCLUDED.content, cipher = EXCLUDED.cipher,
         is_list_item = EXCLUDED.is_list_item, checked = EXCLUDED.checked, reminder_at = EXCLUDED.reminder_at,
         updated_at = EXCLUDED.updated_at, is_reminder = EXCLUDED.is_reminder, deleted_at = NULL
       -- only the owner can overwrite a note, and only with a newer version
       WHERE notes.user_id = EXCLUDED.user_id AND notes.updated_at <= EXCLUDED.updated_at
       RETURNING *`,
      [req.params.id, req.userId, n.path, n.encrypted, n.encrypted ? null : n.content, n.encrypted ? n.cipher : null,
        !!n.isListItem, !!n.checked, n.reminderAt ?? null, n.createdAt, n.updatedAt, !!n.isReminder || !!n.reminderAt],
    );
    if (rows.length) return res.json(toApi(rows[0]));
    const current = await pool.query("SELECT * FROM notes WHERE id = $1", [req.params.id]);
    if (current.rows[0]?.user_id !== req.userId) return res.status(403).json({ error: "not your note" });
    // The server already has a newer version: tell the client which one.
    res.status(409).json({ error: "stale update", current: toApi(current.rows[0]) });
  });

  // DELETE /api/notes/:id -> tombstone; content is wiped.
  r.delete("/:id", async (req, res) => {
    const { rowCount } = await pool.query(
      `UPDATE notes SET deleted_at = now(), updated_at = now(), encrypted = FALSE, cipher = NULL, content = '{}'::jsonb
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [req.params.id, req.userId],
    );
    res.status(rowCount ? 204 : 404).end();
  });

  return r;
}
