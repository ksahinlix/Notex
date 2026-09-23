// Users (D16).
import crypto from "node:crypto";

export function toApiUser(row) {
  return { id: row.id, email: row.email, name: row.name, picture: row.picture };
}

/**
 * Finds or creates the user for a verified Google account. The first time
 * OWNER_EMAIL signs in, notes and protected folders from the single-user era
 * (user_id IS NULL) are given to that account.
 */
export async function upsertGoogleUser(pool, google, ownerEmail) {
  const { rows } = await pool.query(
    `INSERT INTO users (id, google_sub, email, name, picture)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (google_sub) DO UPDATE SET
       email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture, last_login_at = now()
     RETURNING *`,
    [crypto.randomUUID(), google.sub, google.email, google.name, google.picture],
  );
  const user = rows[0];
  if (ownerEmail && user.email.toLowerCase() === ownerEmail.trim().toLowerCase()) {
    await pool.query("UPDATE notes SET user_id = $1 WHERE user_id IS NULL", [user.id]);
    await pool.query("UPDATE protected_folders SET user_id = $1 WHERE user_id IS NULL", [user.id]);
  }
  return user;
}

export async function findUser(pool, id) {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] ?? null;
}
