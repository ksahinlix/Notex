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

export function protectedFoldersRouter(pool) {
  const r = Router();

  r.get("/", async (_req, res) => {
    const { rows } = await pool.query("SELECT * FROM protected_folders WHERE deleted_at IS NULL ORDER BY path_key");
    res.json({ folders: rows.map(toApi) });
  });

  // PUT /api/protected-folders/:pathKey  (pathKey is URL-encoded, e.g. Personal%2FDiary)
  r.put("/:pathKey", async (req, res) => {
    const { salt, iterations, checkCipher } = req.body || {};
    if (typeof salt !== "string" || !/^[0-9a-f]{32,}$/.test(salt)) return res.status(400).json({ error: "invalid salt" });
    if (!Number.isInteger(iterations) || iterations < 100_000) return res.status(400).json({ error: "invalid iterations" });
    if (typeof checkCipher !== "string" || !checkCipher.includes(":")) return res.status(400).json({ error: "invalid checkCipher" });
    const { rows } = await pool.query(
      `INSERT INTO protected_folders (path_key, salt, iterations, check_cipher)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (path_key) DO UPDATE SET
         salt = EXCLUDED.salt, iterations = EXCLUDED.iterations, check_cipher = EXCLUDED.check_cipher,
         updated_at = now(), deleted_at = NULL
       RETURNING *`,
      [req.params.pathKey, salt, iterations, checkCipher],
    );
    res.json(toApi(rows[0]));
  });

  r.delete("/:pathKey", async (req, res) => {
    const { rowCount } = await pool.query(
      "UPDATE protected_folders SET deleted_at = now(), updated_at = now() WHERE path_key = $1 AND deleted_at IS NULL",
      [req.params.pathKey],
    );
    res.status(rowCount ? 204 : 404).end();
  });

  return r;
}
