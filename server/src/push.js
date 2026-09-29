// Web Push for reminders (D21).
//
// Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY identify this server to the push
// services (Google, Mozilla, Apple). The browser is given only the public one.
// Without them the app simply has no notifications — everything else works.
import webpush from "web-push";
import { dueOccurrence, pushPayload } from "./reminders.js";

/** null when the keys are not set, so the routes can answer "not configured". */
export function createPush({ publicKey, privateKey, subject = "mailto:notex@example.com" }) {
  if (!publicKey || !privateKey) return null;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return {
    publicKey,
    /** Sends to every device of a user; forgets the ones the service rejects. */
    async sendToUsers(pool, userIds, payload) {
      if (!userIds.length) return { sent: 0, gone: 0 };
      const { rows } = await pool.query("SELECT * FROM push_subscriptions WHERE user_id = ANY($1::text[])", [userIds]);
      let sent = 0;
      const gone = [];
      await Promise.all(
        rows.map(async (s) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify(payload),
            );
            sent++;
          } catch (err) {
            // 404/410: the browser dropped the subscription (cleared data,
            // app uninstalled). Anything else is a temporary failure.
            if (err?.statusCode === 404 || err?.statusCode === 410) gone.push(s.endpoint);
          }
        }),
      );
      if (gone.length) await pool.query("DELETE FROM push_subscriptions WHERE endpoint = ANY($1::text[])", [gone]);
      if (sent) await pool.query("UPDATE push_subscriptions SET last_sent_at = now() WHERE user_id = ANY($1::text[])", [userIds]);
      return { sent, gone: gone.length };
    },
  };
}

/** Everyone who can see a note: its owner, plus accepted shares over it (D18). */
export async function recipientsOf(pool, note) {
  const { rows } = await pool.query(
    `SELECT invited_user_id AS id FROM shares
     WHERE status = 'accepted' AND owner_id = $1 AND invited_user_id IS NOT NULL
       AND ($2::text[])[1:cardinality(path)] = path`,
    [note.user_id, note.path],
  );
  return [...new Set([note.user_id, ...rows.map((r) => r.id)])].filter(Boolean);
}

/**
 * Sends every reminder that has come due and records what was sent. Called by
 * an outside scheduler (see /api/reminders/due), because the free Render
 * service sleeps and has no cron of its own.
 */
export async function sendDueReminders(pool, push, now = new Date()) {
  const { rows } = await pool.query(
    `SELECT * FROM notes
     WHERE deleted_at IS NULL AND reminder_at IS NOT NULL
       AND reminder_at <= $1
       AND (last_notified_at IS NULL OR last_notified_at < $1)`,
    [now],
  );
  const result = { due: 0, sent: 0, gone: 0 };
  for (const note of rows) {
    const at = dueOccurrence(note, now);
    if (!at) continue;
    result.due++;
    if (push) {
      const people = await recipientsOf(pool, note);
      const { sent, gone } = await push.sendToUsers(pool, people, pushPayload(note, at));
      result.sent += sent;
      result.gone += gone;
    }
    await pool.query("UPDATE notes SET last_notified_at = $2 WHERE id = $1", [note.id, at]);
  }
  return result;
}
