// When a reminder is due, and what the notification may say (D21).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dueOccurrence, occurrenceAt, pushPayload } from "../src/reminders.js";

const at = (iso) => new Date(iso);
const note = (extra) => ({
  id: "n1", path: ["Ev", "Faturalar"], encrypted: false, content: { text: "Kira öde" },
  reminder_at: null, reminder_repeat: null, reminder_done_until: null, last_notified_at: null, checked: false, ...extra,
});

test("a one-off fires once it has arrived, and only once", () => {
  const n = note({ reminder_at: "2026-09-28T09:00:00Z" });
  assert.equal(dueOccurrence(n, at("2026-09-28T08:59:00Z")), null, "not before");
  assert.deepEqual(dueOccurrence(n, at("2026-09-28T09:00:30Z")), at("2026-09-28T09:00:00Z"));
  const sent = { ...n, last_notified_at: "2026-09-28T09:00:00Z" };
  assert.equal(dueOccurrence(sent, at("2026-09-28T09:05:00Z")), null, "not a second time");
});

test("what was missed while the server slept is let go", () => {
  const n = note({ reminder_at: "2026-09-27T09:00:00Z" });
  assert.equal(dueOccurrence(n, at("2026-09-28T09:00:00Z")), null, "a day late: no notification");
  assert.ok(dueOccurrence(n, at("2026-09-27T10:30:00Z")), "an hour and a half late still counts");
});

test("a completed reminder stays quiet", () => {
  assert.equal(dueOccurrence(note({ reminder_at: "2026-09-28T09:00:00Z", checked: true }), at("2026-09-28T09:01:00Z")), null);
});

test("an undated reminder never fires", () => {
  assert.equal(dueOccurrence(note({ reminder_at: null }), at("2026-09-28T09:00:00Z")), null);
});

test("a daily reminder fires today, not for every day since", () => {
  const n = note({ reminder_at: "2026-01-01T06:00:00Z", reminder_repeat: "daily" });
  const due = dueOccurrence(n, at("2026-09-28T06:02:00Z"));
  assert.deepEqual(due, at("2026-09-28T06:00:00Z"), "the newest one that has arrived");
});

test("a monthly reminder keeps its day, and short months use their last", () => {
  const n = note({ reminder_at: "2026-01-31T09:00:00Z", reminder_repeat: "monthly" });
  assert.deepEqual(occurrenceAt(at("2026-01-31T09:00:00Z"), "monthly", 1), at("2026-02-28T09:00:00Z"));
  assert.deepEqual(occurrenceAt(at("2026-01-31T09:00:00Z"), "monthly", 3), at("2026-04-30T09:00:00Z"));
  assert.deepEqual(dueOccurrence(n, at("2026-02-28T09:01:00Z")), at("2026-02-28T09:00:00Z"));
});

test("ticking one occurrence off does not silence the next", () => {
  const n = note({
    reminder_at: "2026-09-01T09:00:00Z", reminder_repeat: "monthly",
    reminder_done_until: "2026-09-01T09:00:00Z",
  });
  assert.equal(dueOccurrence(n, at("2026-09-01T09:30:00Z")), null, "the one just completed stays quiet");
  assert.deepEqual(dueOccurrence(n, at("2026-10-01T09:00:00Z")), at("2026-10-01T09:00:00Z"), "next month still fires");
});

test("weekly and yearly step the way the app draws them", () => {
  assert.deepEqual(occurrenceAt(at("2026-09-28T09:00:00Z"), "weekly", 2), at("2026-10-12T09:00:00Z"));
  // 2028 is a leap year; 2029 is not, so 29 Feb falls back to the 28th.
  assert.deepEqual(occurrenceAt(at("2028-02-29T09:00:00Z"), "yearly", 1), at("2029-02-28T09:00:00Z"));
});

test("an encrypted note only says that something is due", () => {
  const p = pushPayload(note({ encrypted: true, content: null, path: ["Kişisel", "Sağlık"] }), "2026-09-28T09:00:00Z");
  assert.equal(p.body, "Kilitli bir notunda hatırlatman var.");
  assert.ok(!JSON.stringify(p).includes("Sağlık") || p.title === "Hatırlatma", "and does not name the locked folder");
});

test("a plain note says what it is, shortened", () => {
  const p = pushPayload(note({ content: { reminderLabel: "Kira öde" } }), "2026-09-28T09:00:00Z");
  assert.equal(p.title, "Hatırlatma · Faturalar");
  assert.equal(p.body, "Kira öde");
  const long = pushPayload(note({ content: { text: "x".repeat(200) } }), "2026-09-28T09:00:00Z");
  assert.equal(long.body.length, 118);
});
