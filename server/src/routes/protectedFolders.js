import { Router } from "express";

function toApi(row) {
  return {
    pathKey: row.path_key,
    salt: row.salt,
    iterations: row.iterations,
    checkCipher: row.check_cipher,
    updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
  };
}

// All routes are per user: req.userId is set by requireAuth.
export function protectedFoldersRouter(pool) {
  const r = Router();

  r.get("/", async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM protected_folders WHERE user_id = $1 AND deleted_at IS NULL ORDER BY path_key", [req.userId]);
    res.json({ folders: rows.map(toApi) });
  });

  // PUT /api/protected-folders/:pathKey  (pathKey is URL-encoded, e.g. Personal%2FDiary)
  r.put("/:pathKey", async (req, res) => {
    const { salt, iterations, checkCipher } = req.body || {};
    if (typeof salt !== "string" || !/^[0-9a-f]{32,}$/.test(salt)) return res.status(400).json({ error: "invalid salt" });
    if (!Number.isInteger(iterations) || iterations < 100_000) return res.status(400).json({ error: "invalid iterations" });
    if (typeof checkCipher !== "string" || !checkCipher.includes(":")) return res.status(400).json({ error: "invalid checkCipher" });
    const { rows } = await pool.query(
      `INSERT INTO protected_folders (user_id, path_key, salt, iterations, check_cipher)
       VALUES ($5, $1, $2, $3, $4)
       ON CONFLICT (user_id, path_key) DO UPDATE SET
         salt = EXCLUDED.salt, iterations = EXCLUDED.iterations, check_cipher = EXCLUDED.check_cipher,
         updated_at = now(), deleted_at = NULL
       RETURNING *`,
      [req.params.pathKey, salt, iterations, checkCipher, req.userId],
    );
    res.json(toApi(rows[0]));
  });

  r.delete("/:pathKey", async (req, res) => {
    const { rowCount } = await pool.query(
      "UPDATE protected_folders SET deleted_at = now(), updated_at = now() WHERE user_id = $2 AND path_key = $1 AND deleted_at IS NULL",
      [req.params.pathKey, req.userId],
    );
    res.status(rowCount ? 204 : 404).end();
  });

  return r;
}
