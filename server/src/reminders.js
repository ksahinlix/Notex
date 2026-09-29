// Which reminders are due right now (D21). The browser draws the agenda from
// web/src/lib/recurrence.ts; this is the same rule set for the server, which
// is the side that has to decide when to send a notification.
//
// Times are stepped in UTC. Turkey is a fixed +03 with no daylight saving, so
// a monthly "28th at 09:00" stays the 28th at 09:00 for the owner. In a
// country that changes its clocks, a repeating reminder would fire an hour
// off after the change — noted in the log as something to revisit.

const REPEATS = ["daily", "weekly", "monthly", "yearly"];
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** The k-th occurrence of a repeating reminder (k = 0 is the anchor). */
export function occurrenceAt(anchor, repeat, k) {
  const d = new Date(anchor);
  if (repeat === "daily") d.setUTCDate(d.getUTCDate() + k);
  else if (repeat === "weekly") d.setUTCDate(d.getUTCDate() + 7 * k);
  else {
    const months = repeat === "monthly" ? k : 12 * k;
    const y = anchor.getUTCFullYear() + Math.floor((anchor.getUTCMonth() + months) / 12);
    const m = (anchor.getUTCMonth() + months + 12000) % 12;
    // A month without that day (31st, 29 Feb) uses its last day.
    d.setUTCFullYear(y, m, Math.min(anchor.getUTCDate(), daysInMonth(y, m)));
  }
  return d;
}

/**
 * The occurrence to notify about, or null. It is the most recent one that
 * has arrived, is not already done, and has not been sent before.
 *
 * `grace` keeps a server that was asleep (or a cron that missed a run) from
 * firing yesterday's reminders: anything older than that is let go.
 */
export function dueOccurrence(note, now, grace = 2 * 60 * 60 * 1000) {
  if (!note.reminder_at) return null; // undated: nothing to fire
  const anchor = new Date(note.reminder_at);
  const repeat = REPEATS.includes(note.reminder_repeat) ? note.reminder_repeat : null;
  const floor = new Date(Math.max(now.getTime() - grace, latest(note.reminder_done_until, note.last_notified_at)?.getTime() ?? 0));

  if (!repeat) {
    if (note.checked) return null; // a one-off that is done
    return anchor <= now && anchor > floor ? anchor : null;
  }
  // The newest occurrence that has arrived; walking back from now beats
  // walking forward from an anchor that may be years old.
  let best = null;
  for (let k = 0; k < 5000; k++) {
    const d = occurrenceAt(anchor, repeat, k);
    if (d > now) break;
    if (d > floor) best = d;
  }
  return best;
}

const latest = (...values) => {
  const dates = values.filter(Boolean).map((v) => new Date(v));
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
};

/**
 * What the notification says. An encrypted note's text never leaves the
 * browser, so the server can only say that something is due (D8).
 */
export function pushPayload(note, at) {
  const time = new Date(at).toISOString();
  if (note.encrypted) return { title: "Hatırlatma", body: "Kilitli bir notunda hatırlatman var.", noteId: note.id, at: time };
  const content = note.content ?? {};
  const text = (content.reminderLabel || content.text || "").replace(/\s+/g, " ").trim();
  return {
    title: note.path?.[note.path.length - 1] ? `Hatırlatma · ${note.path[note.path.length - 1]}` : "Hatırlatma",
    body: text.length > 120 ? `${text.slice(0, 117)}…` : text || "Hatırlatman var.",
    noteId: note.id,
    at: time,
  };
}
