// Backups (D23).
//
// One JSON file holding everything needed to rebuild the database: the users,
// their live notes, the records that let a locked folder be unlocked again,
// the to-do marks and the shares. Written to Cloudflare R2 on a schedule, and
// served to the owner of the data by the "Dışa aktar" button.
//
// Locked notes travel as `cipher`, exactly as they sit in the database — the
// server has never had the plaintext and a backup is no reason to start (D8).
// `protected_folders` comes along, so the same password still opens them after
// a restore.
import zlib from "node:zlib";

export const BACKUP_FORMAT = "notex-backup/1";

const iso = (d) => d?.toISOString() ?? null;

function noteOut(row) {
  return {
    id: row.id,
    userId: row.user_id,
    authorId: row.author_id ?? row.user_id,
    path: row.path,
    encrypted: row.encrypted,
    content: row.content,
    cipher: row.cipher,
    isListItem: row.is_list_item,
    checked: row.checked,
    reminderAt: iso(row.reminder_at),
    isReminder: row.is_reminder,
    repeat: row.reminder_repeat,
    reminderDoneUntil: iso(row.reminder_done_until),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/**
 * The whole backup as a plain object. `userId` narrows it to one person's own
 * data — what the export button hands you — while leaving it out takes
 * everybody, which is what the scheduled backup does.
 *
 * Deleted notes are left out: their content was wiped when they were deleted
 * (see routes/notes.js), so a tombstone would restore nothing.
 */
export async function buildBackup(pool, { userId = null, takenAt = new Date(), version = null } = {}) {
  const mine = userId ? " WHERE user_id = $1" : "";
  const args = userId ? [userId] : [];

  const [users, notes, folders, todos, shares] = await Promise.all([
    pool.query(
      `SELECT id, google_sub, email, name, picture, created_at, last_login_at FROM users${userId ? " WHERE id = $1" : ""} ORDER BY created_at`,
      args,
    ),
    pool.query(
      `SELECT * FROM notes WHERE deleted_at IS NULL${userId ? " AND user_id = $1" : ""} ORDER BY created_at`,
      args,
    ),
    pool.query(
      `SELECT user_id, path_key, salt, iterations, check_cipher FROM protected_folders WHERE deleted_at IS NULL${userId ? " AND user_id = $1" : ""} ORDER BY path_key`,
      args,
    ),
    pool.query(`SELECT user_id, path_key, created_at FROM todo_folders${mine} ORDER BY path_key`, args),
    pool.query(
      `SELECT id, owner_id, kind, path, invited_email, invited_user_id, status, token, created_at, accepted_at
       FROM shares${userId ? " WHERE owner_id = $1" : ""} ORDER BY created_at`,
      args,
    ),
  ]);

  return {
    format: BACKUP_FORMAT,
    takenAt: iso(takenAt),
    scope: userId ? "user" : "all",
    serverVersion: version,
    counts: {
      users: users.rowCount,
      notes: notes.rowCount,
      protectedFolders: folders.rowCount,
      todoFolders: todos.rowCount,
      shares: shares.rowCount,
    },
    users: users.rows.map((u) => ({
      id: u.id,
      googleSub: u.google_sub,
      email: u.email,
      name: u.name,
      picture: u.picture,
      createdAt: iso(u.created_at),
      lastLoginAt: iso(u.last_login_at),
    })),
    notes: notes.rows.map(noteOut),
    protectedFolders: folders.rows.map((f) => ({
      userId: f.user_id,
      pathKey: f.path_key,
      salt: f.salt,
      iterations: f.iterations,
      checkCipher: f.check_cipher,
    })),
    todoFolders: todos.rows.map((t) => ({ userId: t.user_id, pathKey: t.path_key, createdAt: iso(t.created_at) })),
    shares: shares.rows.map((s) => ({
      id: s.id,
      ownerId: s.owner_id,
      kind: s.kind,
      path: s.path,
      invitedEmail: s.invited_email,
      invitedUserId: s.invited_user_id,
      status: s.status,
      token: s.token,
      createdAt: iso(s.created_at),
      acceptedAt: iso(s.accepted_at),
    })),
  };
}

/** "notex/2026/notex-20261002T140000Z.json.gz" — sorted by name is sorted by time. */
export function backupKey(takenAt = new Date(), prefix = "notex") {
  const stamp = takenAt.toISOString().replace(/[:-]/g, "").replace(/\.\d+Z$/, "Z");
  return `${prefix}/${takenAt.getUTCFullYear()}/notex-${stamp}.json.gz`;
}

/**
 * The backup as the bytes that get stored: gzipped, because a note's images
 * are base64 and compress to about a quarter.
 */
export async function backupFile(pool, { takenAt = new Date(), version = null } = {}) {
  const dump = await buildBackup(pool, { takenAt, version });
  return {
    key: backupKey(takenAt),
    body: zlib.gzipSync(Buffer.from(JSON.stringify(dump), "utf8")),
    counts: dump.counts,
    takenAt: dump.takenAt,
  };
}

/** Builds the backup and puts it in a bucket (the server pushes). */
export async function runBackup(pool, r2, { takenAt = new Date(), version = null } = {}) {
  const file = await backupFile(pool, { takenAt, version });
  await r2.put(file.key, file.body, "application/gzip");
  return { key: file.key, bytes: file.body.length, counts: file.counts, takenAt: file.takenAt };
}

/**
 * Writes a backup back into a database, inside the caller's transaction.
 *
 * Rows are upserted, so restoring over a database that still holds some of the
 * data is safe and repeatable. Nothing is deleted: a note removed after the
 * backup was taken comes back, a note written after it is left alone. Users go
 * first because everything else points at them.
 */
export async function restoreBackup(client, dump) {
  if (dump?.format !== BACKUP_FORMAT) throw new Error(`not a ${BACKUP_FORMAT} file (found ${dump?.format})`);

  for (const u of dump.users) {
    await client.query(
      `INSERT INTO users (id, google_sub, email, name, picture, created_at, last_login_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture`,
      [u.id, u.googleSub, u.email, u.name, u.picture, u.createdAt, u.lastLoginAt],
    );
  }

  for (const n of dump.notes) {
    await client.query(
      `INSERT INTO notes (id, user_id, author_id, path, encrypted, content, cipher, is_list_item, checked,
                          reminder_at, is_reminder, reminder_repeat, reminder_done_until, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id, author_id = EXCLUDED.author_id, path = EXCLUDED.path,
         encrypted = EXCLUDED.encrypted, content = EXCLUDED.content, cipher = EXCLUDED.cipher,
         is_list_item = EXCLUDED.is_list_item, checked = EXCLUDED.checked, reminder_at = EXCLUDED.reminder_at,
         is_reminder = EXCLUDED.is_reminder, reminder_repeat = EXCLUDED.reminder_repeat,
         reminder_done_until = EXCLUDED.reminder_done_until, updated_at = EXCLUDED.updated_at, deleted_at = NULL`,
      [
        n.id, n.userId, n.authorId, n.path, n.encrypted, n.content, n.cipher, n.isListItem, n.checked,
        n.reminderAt, n.isReminder, n.repeat, n.reminderDoneUntil, n.createdAt, n.updatedAt,
      ],
    );
  }

  for (const f of dump.protectedFolders) {
    await client.query(
      `INSERT INTO protected_folders (user_id, path_key, salt, iterations, check_cipher)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, path_key) DO UPDATE SET
         salt = EXCLUDED.salt, iterations = EXCLUDED.iterations, check_cipher = EXCLUDED.check_cipher, deleted_at = NULL`,
      [f.userId, f.pathKey, f.salt, f.iterations, f.checkCipher],
    );
  }

  for (const t of dump.todoFolders) {
    await client.query(
      "INSERT INTO todo_folders (user_id, path_key, created_at) VALUES ($1,$2,$3) ON CONFLICT (user_id, path_key) DO NOTHING",
      [t.userId, t.pathKey, t.createdAt],
    );
  }

  for (const s of dump.shares) {
    await client.query(
      `INSERT INTO shares (id, owner_id, kind, path, invited_email, invited_user_id, status, token, created_at, accepted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, invited_user_id = EXCLUDED.invited_user_id`,
      [s.id, s.ownerId, s.kind, s.path, s.invitedEmail, s.invitedUserId, s.status, s.token, s.createdAt, s.acceptedAt],
    );
  }

  return dump.counts;
}
