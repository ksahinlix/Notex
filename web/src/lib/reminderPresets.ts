// Quick choices for the manual reminder picker (no year needed).

export interface ReminderPreset {
  label: string
  /** null = a reminder without a date. */
  at: (now: Date) => Date | null
}

const inHours = (h: number) => (now: Date) => {
  const d = new Date(now.getTime() + h * 3600_000)
  d.setSeconds(0, 0)
  return d
}
const at = (days: number, hour: number) => (now: Date) => {
  const d = new Date(now)
  d.setDate(d.getDate() + days)
  d.setHours(hour, 0, 0, 0)
  return d
}

export function reminderPresets(now: Date): ReminderPreset[] {
  const list: ReminderPreset[] = [
    { label: '1 saat sonra', at: inHours(1) },
    { label: '2 saat sonra', at: inHours(2) },
  ]
  if (now.getHours() < 19) list.push({ label: 'Bu akşam 20:00', at: at(0, 20) })
  list.push(
    { label: 'Yarın 09:00', at: at(1, 9) },
    { label: '3 gün sonra', at: at(3, 9) },
    { label: '1 hafta sonra', at: at(7, 9) },
    { label: 'Tarihsiz', at: () => null },
  )
  return list
}

/** The default when the picker opens: one hour from now. */
export const defaultReminder = (now: Date) => inHours(1)(now)

/** Next `n` days for the custom day list: "Bugün", "Yarın", "Cmt 26 Eyl" ... */
export function upcomingDays(now: Date, n = 60): { value: string; label: string }[] {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() + i)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const label = i === 0 ? 'Bugün' : i === 1 ? 'Yarın' : d.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' })
    out.push({ value, label })
  }
  return out
}

/** Combines a day from upcomingDays() and "HH:MM" into a Date (local time). */
export function combineDayTime(day: string, time: string): Date | null {
  const [y, m, d] = day.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  if ([y, m, d, hh, mm].some((x) => Number.isNaN(x))) return null
  return new Date(y, m - 1, d, hh, mm, 0, 0)
}
