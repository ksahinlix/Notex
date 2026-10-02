// The trash (D24).
//
// Deleting a note used to wipe its content in the same statement that
// tombstoned it, so there was nothing to come back to. Now the content stays
// and only `deleted_at` is set; after TRASH_DAYS the content is wiped for
// real, which is what deleting always used to do straight away.
//
// The tombstone row itself is never removed: other devices learn about a
// deletion from it when they sync with `?since=` (D9).

export const TRASH_DAYS = 30;

/**
 * Wipes the content of everything deleted longer ago than `days`. Safe to run
 * as often as you like: a second run finds nothing, because `content = '{}'`
 * no longer matches.
 */
export async function purgeTrash(pool, days = TRASH_DAYS) {
  const { rowCount } = await pool.query(
    `UPDATE notes
        SET encrypted = FALSE, cipher = NULL, content = '{}'::jsonb
      WHERE deleted_at IS NOT NULL
        AND deleted_at < now() - ($1 || ' days')::interval
        AND (cipher IS NOT NULL OR content <> '{}'::jsonb)`,
    [String(days)],
  );
  return rowCount;
}
