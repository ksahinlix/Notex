// The Reminders page's agenda: overdue, the next 6 months grouped by month,
// undated reminders and completed ones.
//
// To keep the list readable: monthly and yearly reminders show every
// occurrence in the period (a bill on the 28th appears 6 times), weekly ones
// the next 4 weeks, daily ones only their next occurrence. A repeating
// reminder that was missed shows its latest missed occurrence as overdue.

import { nextOccurrence, occurrences, type Repeat } from './recurrence'
import type { Note } from './types'

export interface AgendaItem {
  note: Note
  /** This occurrence's time (null = undated). */
  at: Date | null
}

export interface AgendaMonth {
  key: string // "2026-09"
  title: string // "Eylül 2026"
  items: AgendaItem[]
}

export interface Agenda {
  overdue: AgendaItem[]
  months: AgendaMonth[]
  undated: AgendaItem[]
  done: AgendaItem[]
}

export const isReminderNote = (n: Note) => !!(n.isReminder || n.reminderAt)

const addMonths = (d: Date, m: number) => new Date(d.getFullYear(), d.getMonth() + m, d.getDate(), d.getHours(), d.getMinutes())

export function buildAgenda(notes: Note[], now: Date, monthsAhead = 6): Agenda {
  const horizon = addMonths(now, monthsAhead)
  const agenda: Agenda = { overdue: [], months: [], undated: [], done: [] }
  const byMonth = new Map<string, AgendaMonth>()
  const put = (item: AgendaItem) => {
    const d = item.at!
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!byMonth.has(key)) {
      const title = d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })
      byMonth.set(key, { key, title: title.charAt(0).toLocaleUpperCase('tr') + title.slice(1), items: [] })
    }
    byMonth.get(key)!.items.push(item)
  }

  for (const note of notes) {
    if (!isReminderNote(note) || note.deletedAt) continue
    if (!note.reminderAt) {
      ;(note.checked ? agenda.done : agenda.undated).push({ note, at: null })
      continue
    }
    const anchor = new Date(note.reminderAt)
    const repeat = (note.repeat ?? null) as Repeat | null
    if (!repeat) {
      if (note.checked) agenda.done.push({ note, at: anchor })
      else if (anchor < now) agenda.overdue.push({ note, at: anchor })
      else if (anchor <= horizon) put({ note, at: anchor })
      continue
    }
    const doneUntil = note.reminderDoneUntil ? new Date(note.reminderDoneUntil) : null
    // latest missed occurrence (within the last 60 days)
    const missed = occurrences(anchor, repeat, new Date(now.getTime() - 60 * 86400_000), now, doneUntil)
    if (missed.length) agenda.overdue.push({ note, at: missed[missed.length - 1] })
    const until = repeat === 'daily' ? null : repeat === 'weekly' ? new Date(now.getTime() + 28 * 86400_000) : horizon
    if (until) for (const at of occurrences(anchor, repeat, now, until, doneUntil)) put({ note, at })
    else {
      const next = nextOccurrence(anchor, repeat, now, doneUntil)
      if (next && next <= horizon) put({ note, at: next })
    }
  }

  const byTime = (a: AgendaItem, b: AgendaItem) => a.at!.getTime() - b.at!.getTime()
  agenda.overdue.sort(byTime)
  agenda.months = [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key))
  for (const m of agenda.months) m.items.sort(byTime)
  agenda.undated.sort((a, b) => b.note.createdAt.localeCompare(a.note.createdAt))
  agenda.done.sort((a, b) => b.note.updatedAt.localeCompare(a.note.updatedAt))
  return agenda
}
