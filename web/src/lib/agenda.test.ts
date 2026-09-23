import { describe, expect, it } from 'vitest'
import { buildAgenda, isReminderNote } from './agenda'
import type { Note } from './types'

const NOW = new Date(2026, 8, 23, 14, 0) // Wed 23 Sep 2026
const iso = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h).toISOString()
let n = 0
function note(extra: Partial<Note>): Note {
  return {
    id: `n${++n}`, path: ['Finans', 'Faturalar'], encrypted: false, content: { text: 'x' }, cipher: null,
    isListItem: false, checked: false, reminderAt: null, isReminder: false, repeat: null, reminderDoneUntil: null,
    createdAt: iso(2026, 9, 1), updatedAt: iso(2026, 9, 1), ...extra,
  }
}
const titles = (a: ReturnType<typeof buildAgenda>) => a.months.map((m) => `${m.title}: ${m.items.map((i) => i.at!.getDate()).join(',')}`)

describe('agenda', () => {
  it('shows a monthly bill every month for the next 6 months', () => {
    const card = note({ reminderAt: iso(2026, 9, 28), repeat: 'monthly', isReminder: true })
    expect(titles(buildAgenda([card], NOW))).toEqual([
      'Eylül 2026: 28', 'Ekim 2026: 28', 'Kasım 2026: 28', 'Aralık 2026: 28', 'Ocak 2027: 28', 'Şubat 2027: 28', 'Mart 2027: 28',
    ].slice(0, 6))
  })

  it('sorts one-time, overdue, undated and done reminders', () => {
    const a = buildAgenda(
      [
        note({ reminderAt: iso(2026, 10, 5), isReminder: true }), // upcoming
        note({ reminderAt: iso(2026, 9, 20), isReminder: true }), // overdue
        note({ reminderAt: iso(2026, 9, 10), isReminder: true, checked: true }), // done
        note({ isReminder: true }), // undated
        note({ reminderAt: iso(2027, 6, 1), isReminder: true }), // beyond 6 months
        note({}), // not a reminder
      ],
      NOW,
    )
    expect(titles(a)).toEqual(['Ekim 2026: 5'])
    expect(a.overdue.map((i) => i.at!.getDate())).toEqual([20])
    expect(a.undated).toHaveLength(1)
    expect(a.done).toHaveLength(1)
  })

  it('a missed monthly occurrence is overdue until marked done', () => {
    const rent = note({ reminderAt: iso(2026, 8, 1), repeat: 'monthly', isReminder: true })
    expect(buildAgenda([rent], NOW).overdue.map((i) => i.at!.getDate())).toEqual([1]) // 1 Sep missed
    const doneSep = { ...rent, reminderDoneUntil: iso(2026, 9, 1) }
    expect(buildAgenda([doneSep], NOW).overdue).toEqual([])
    expect(titles(buildAgenda([doneSep], NOW))[0]).toBe('Ekim 2026: 1')
  })

  it('daily shows only its next time, weekly the next 4 weeks', () => {
    const pill = note({ reminderAt: iso(2026, 9, 1, 8), repeat: 'daily', isReminder: true, reminderDoneUntil: iso(2026, 9, 23, 8) })
    const standup = note({ reminderAt: iso(2026, 9, 21, 10), repeat: 'weekly', isReminder: true, reminderDoneUntil: iso(2026, 9, 21, 10) })
    const a = buildAgenda([pill, standup], NOW)
    const items = a.months.flatMap((m) => m.items.map((i) => `${i.note.repeat} ${i.at!.getDate()}.${i.at!.getMonth() + 1}`))
    expect(items).toEqual(['daily 24.9', 'weekly 28.9', 'weekly 5.10', 'weekly 12.10', 'weekly 19.10'])
  })

  it('knows reminder notes', () => {
    expect(isReminderNote(note({ isReminder: true }))).toBe(true)
    expect(isReminderNote(note({ reminderAt: iso(2026, 9, 30) }))).toBe(true)
    expect(isReminderNote(note({}))).toBe(false)
  })
})
