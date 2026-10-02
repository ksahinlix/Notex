import { Router } from "express";

/**
 * Folders whose notes are checkable (D22). A folder is marked by its owner;
 * everyone who can see the folder sees it the same way, so a shared shopping
 * list has checkboxes for both people.
 */
export function todoFoldersRouter(pool) {
  const r = Router();

  // Mine, plus the ones on folders shared with me (D18) — keyed by owner, so
  // my "Alışveriş" and someone else's stay apart.
  r.get("/", async (req, res) => {
    const { rows } = await pool.query(
      `SELECT t.user_id, t.path_key FROM todo_folders t
       WHERE t.user_id = $1 OR EXISTS (
         SELECT 1 FROM shares s
         WHERE s.status = 'accepted' AND s.invited_user_id = $1 AND s.owner_id = t.user_id
           AND (string_to_array(t.path_key, '/'))[1:cardinality(s.path)] = s.path
       )
       ORDER BY t.path_key`,
      [req.userId],
    );
    res.json({ folders: rows.map((row) => ({ ownerId: row.user_id, pathKey: row.path_key })) });
  });

  // Only the owner marks a folder: it is a property of the folder, not of the
  // person looking at it.
  r.put("/:pathKey", async (req, res) => {
    const pathKey = req.params.pathKey;
    if (!pathKey.trim()) return res.status(400).json({ error: "pathKey required" });
    await pool.query(
      "INSERT INTO todo_folders (user_id, path_key) VALUES ($1, $2) ON CONFLICT (user_id, path_key) DO NOTHING",
      [req.userId, pathKey],
    );
    res.status(201).json({ ownerId: req.userId, pathKey });
  });

  r.delete("/:pathKey", async (req, res) => {
    const { rowCount } = await pool.query("DELETE FROM todo_folders WHERE user_id = $1 AND path_key = $2", [req.userId, req.params.pathKey]);
    res.status(rowCount ? 204 : 404).end();
  });

  /** The owner renamed or moved the folder; the mark follows it, and its subfolders. */
  r.post("/move", async (req, res) => {
    const { from, to } = req.body ?? {};
    if (!Array.isArray(from) || !Array.isArray(to) || !from.length || !to.length) return res.status(400).json({ error: "from and to are required" });
    const [a, b] = [from.join("/"), to.join("/")];
    const { rowCount } = await pool.query(
      `UPDATE todo_folders SET path_key = $3 || substring(path_key from length($2) + 1)
       WHERE user_id = $1 AND (path_key = $2 OR path_key LIKE $2 || '/%')`,
      [req.userId, a, b],
    );
    res.json({ moved: rowCount });
  });

  return r;
}
