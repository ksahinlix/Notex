// Repeating reminders. A reminder repeats from its first date (the anchor,
// stored as reminderAt): monthly from the 28th = every 28th, weekly from a
// Monday = every Monday, and so on. Months without that day (31st, 29 Feb)
// use their last day.

export type Repeat = 'daily' | 'weekly' | 'monthly' | 'yearly'
export const REPEATS: Repeat[] = ['daily', 'weekly', 'monthly', 'yearly']

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate()

/** The k-th occurrence (k = 0 is the anchor itself). */
export function occurrenceAt(anchor: Date, repeat: Repeat, k: number): Date {
  const d = new Date(anchor)
  if (repeat === 'daily') d.setDate(d.getDate() + k)
  else if (repeat === 'weekly') d.setDate(d.getDate() + 7 * k)
  else {
    const months = repeat === 'monthly' ? k : 12 * k
    const y = anchor.getFullYear() + Math.floor((anchor.getMonth() + months) / 12)
    const m = (anchor.getMonth() + months) % 12
    d.setFullYear(y, m, Math.min(anchor.getDate(), daysInMonth(y, m)))
  }
  return d
}

/**
 * Occurrences between `from` and `to` (inclusive) that are not done yet
 * (after `doneUntil`). A one-time reminder has at most one.
 */
export function occurrences(anchor: Date, repeat: Repeat | null | undefined, from: Date, to: Date, doneUntil?: Date | null): Date[] {
  const open = (d: Date) => d >= from && d <= to && (!doneUntil || d > doneUntil)
  if (!repeat) return open(anchor) ? [anchor] : []
  const out: Date[] = []
  for (let k = 0; k < 2000; k++) {
    const d = occurrenceAt(anchor, repeat, k)
    if (d > to) break
    if (open(d)) out.push(d)
  }
  return out
}

/** The first occurrence after `after` that is not done yet, or null. */
export function nextOccurrence(anchor: Date, repeat: Repeat | null | undefined, after: Date, doneUntil?: Date | null): Date | null {
  const floor = doneUntil && doneUntil > after ? doneUntil : after
  if (!repeat) return anchor > floor ? anchor : null
  for (let k = 0; k < 5000; k++) {
    const d = occurrenceAt(anchor, repeat, k)
    if (d > floor) return d
  }
  return null
}

const WEEKDAYS = ['pazar', 'pazartesi', 'salı', 'çarşamba', 'perşembe', 'cuma', 'cumartesi']

/** "her gün 09:00", "her pazartesi 10:00", "her ayın 28. günü", "her yıl 5 Mart". */
export function repeatLabel(anchor: Date, repeat: Repeat): string {
  const time = anchor.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  if (repeat === 'daily') return `her gün ${time}`
  if (repeat === 'weekly') return `her ${WEEKDAYS[anchor.getDay()]} ${time}`
  if (repeat === 'monthly') return `her ayın ${anchor.getDate()}. günü ${time}`
  return `her yıl ${anchor.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}`
}
