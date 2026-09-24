// Shared folders (D18). Until now every query was scoped to req.userId; a
// note is now visible to its owner *and* to anyone the owner shared a folder
// with, so the scoping rule lives here and nowhere else.
//
// A share names the invitee by e-mail. invited_user_id is filled in when that
// e-mail signs in (linkInvites), and only status 'accepted' grants anything.
import crypto from "node:crypto";

export const email = (s) => String(s ?? "").trim().toLowerCase();

export function toApiShare(row) {
  return {
    id: row.id,
    path: row.path,
    invitedEmail: row.invited_email,
    status: row.status,
    token: row.token,
    createdAt: row.created_at.toISOString(),
    person: row.person_name || row.person_email ? { id: row.invited_user_id, name: row.person_name, email: row.person_email, picture: row.person_picture } : null,
    owner: row.owner_email ? { id: row.owner_id, name: row.owner_name, email: row.owner_email, picture: row.owner_picture } : undefined,
  };
}

/** Folder paths: same shape as a note's path. */
export function validatePath(path) {
  if (!Array.isArray(path) || path.length < 1 || !path.every((s) => typeof s === "string" && s.trim() && !s.includes("/")))
    return "path must be a non-empty array of non-empty strings without '/'";
  return null;
}

/** SQL for "notes this user may see": their own, plus accepted shared folders. */
export const VISIBLE_NOTES = `(
  n.user_id = $1 OR EXISTS (
    SELECT 1 FROM shares s
    WHERE s.status = 'accepted' AND s.invited_user_id = $1 AND s.owner_id = n.user_id
      AND n.path[1:cardinality(s.path)] = s.path
  )
)`;

/**
 * Who a note written at `path` belongs to, or null if this user may not write
 * there. Own paths belong to the user; a path inside a folder shared with
 * them belongs to that folder's owner, so the note stays with the folder.
 * `ownerId` says which tree is meant, because both may have an "Alışveriş".
 */
export async function writableOwner(pool, userId, path, ownerId) {
  if (!ownerId || ownerId === userId) return userId;
  const { rows } = await pool.query(
    `SELECT 1 FROM shares
     WHERE status = 'accepted' AND invited_user_id = $1 AND owner_id = $2
       AND ($3::text[])[1:cardinality(path)] = path`,
    [userId, ownerId, path],
  );
  return rows.length ? ownerId : null;
}

/** True if this user may write to an existing note. */
export async function canWriteNote(pool, userId, note) {
  if (note.user_id === userId) return true;
  return (await writableOwner(pool, userId, note.path, note.user_id)) === note.user_id;
}

/** Shares the user made, and folders shared with them (accepted or waiting). */
export async function listShares(pool, userId, userEmail) {
  const mine = await pool.query(
    `SELECT s.*, u.name AS person_name, u.email AS person_email, u.picture AS person_picture
     FROM shares s LEFT JOIN users u ON u.id = s.invited_user_id
     WHERE s.owner_id = $1 ORDER BY s.created_at`,
    [userId],
  );
  const withMe = await pool.query(
    `SELECT s.*, o.name AS owner_name, o.email AS owner_email, o.picture AS owner_picture
     FROM shares s JOIN users o ON o.id = s.owner_id
     WHERE s.invited_user_id = $1 OR lower(s.invited_email) = $2
     ORDER BY s.created_at`,
    [userId, email(userEmail)],
  );
  return { mine: mine.rows.map(toApiShare), withMe: withMe.rows.map(toApiShare) };
}

/** Refuses sharing a folder that is (or contains) a password-locked folder. */
export async function hasProtected(pool, userId, path) {
  const key = path.join("/");
  const { rows } = await pool.query(
    `SELECT 1 FROM protected_folders
     WHERE user_id = $1 AND deleted_at IS NULL AND (path_key = $2 OR path_key LIKE $2 || '/%' OR $2 LIKE path_key || '/%')`,
    [userId, key],
  );
  return rows.length > 0;
}

export async function createShare(pool, userId, path, invitedEmail) {
  const token = crypto.randomBytes(24).toString("hex");
  const { rows } = await pool.query(
    `INSERT INTO shares (id, owner_id, path, invited_email, token, invited_user_id)
     VALUES ($1, $2, $3, $4, $5, (SELECT id FROM users WHERE lower(email) = $4))
     ON CONFLICT (owner_id, path, lower(invited_email)) DO UPDATE SET invited_email = EXCLUDED.invited_email
     RETURNING *`,
    [crypto.randomUUID(), userId, path, email(invitedEmail), token],
  );
  return rows[0];
}

/** Accept by token (from the invite link) or by id (from the in-app banner). */
export async function acceptShare(pool, userId, userEmail, { token, id }) {
  const { rows } = await pool.query(
    `UPDATE shares SET status = 'accepted', accepted_at = now(), invited_user_id = $1
     WHERE ($2::text IS NULL OR token = $2) AND ($3::text IS NULL OR id = $3)
       AND lower(invited_email) = $4 AND owner_id <> $1
     RETURNING *`,
    [userId, token ?? null, id ?? null, email(userEmail)],
  );
  return rows[0] ?? null;
}

/** The owner withdraws a share, or the invitee leaves it. Takes effect at once. */
export async function removeShare(pool, userId, userEmail, id) {
  const { rowCount } = await pool.query(
    "DELETE FROM shares WHERE id = $1 AND (owner_id = $2 OR invited_user_id = $2 OR lower(invited_email) = $3)",
    [id, userId, email(userEmail)],
  );
  return rowCount > 0;
}

/** Keeps shares pointing at the right folder when the owner renames or moves it. */
export async function moveShares(pool, userId, from, to) {
  const { rowCount } = await pool.query(
    `UPDATE shares SET path = $3::text[] || path[cardinality($2::text[]) + 1:]
     WHERE owner_id = $1 AND path[1:cardinality($2::text[])] = $2::text[]`,
    [userId, from, to],
  );
  return rowCount;
}

/** Links invites addressed to this e-mail to the account, on every sign-in. */
export async function linkInvites(pool, user) {
  await pool.query("UPDATE shares SET invited_user_id = $1 WHERE lower(invited_email) = $2 AND invited_user_id IS DISTINCT FROM $1", [
    user.id,
    email(user.email),
  ]);
}
