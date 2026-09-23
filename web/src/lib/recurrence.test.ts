import { describe, expect, it } from 'vitest'
import { nextOccurrence, occurrenceAt, occurrences, repeatLabel } from './recurrence'

const d = (y: number, m: number, day: number, h = 9, min = 0) => new Date(y, m - 1, day, h, min)

describe('recurrence', () => {
  it('monthly keeps the day, using the last day in short months', () => {
    const anchor = d(2026, 1, 31)
    expect([0, 1, 2, 3].map((k) => occurrenceAt(anchor, 'monthly', k))).toEqual([d(2026, 1, 31), d(2026, 2, 28), d(2026, 3, 31), d(2026, 4, 30)])
  })

  it('yearly on 29 February uses 28 February in other years', () => {
    expect(occurrenceAt(d(2028, 2, 29), 'yearly', 1)).toEqual(d(2029, 2, 28))
    expect(occurrenceAt(d(2028, 2, 29), 'yearly', 4)).toEqual(d(2032, 2, 29))
  })

  it('lists the next 6 months of a monthly bill', () => {
    const occ = occurrences(d(2026, 9, 28), 'monthly', d(2026, 9, 23), d(2027, 3, 23))
    expect(occ).toEqual([d(2026, 9, 28), d(2026, 10, 28), d(2026, 11, 28), d(2026, 12, 28), d(2027, 1, 28), d(2027, 2, 28)])
  })

  it('skips occurrences that are done', () => {
    const occ = occurrences(d(2026, 9, 28), 'monthly', d(2026, 9, 1), d(2026, 12, 31), d(2026, 10, 28))
    expect(occ).toEqual([d(2026, 11, 28), d(2026, 12, 28)])
    expect(nextOccurrence(d(2026, 9, 28), 'monthly', d(2026, 9, 1), d(2026, 10, 28))).toEqual(d(2026, 11, 28))
  })

  it('weekly and daily', () => {
    expect(occurrences(d(2026, 9, 21), 'weekly', d(2026, 9, 22), d(2026, 10, 10))).toEqual([d(2026, 9, 28), d(2026, 10, 5)])
    expect(occurrences(d(2026, 9, 23, 8), 'daily', d(2026, 9, 23, 12), d(2026, 9, 25, 23))).toEqual([d(2026, 9, 24, 8), d(2026, 9, 25, 8)])
  })

  it('one-time reminders have at most one occurrence', () => {
    expect(occurrences(d(2026, 9, 28), null, d(2026, 9, 1), d(2026, 12, 1))).toEqual([d(2026, 9, 28)])
    expect(occurrences(d(2026, 9, 28), null, d(2026, 10, 1), d(2026, 12, 1))).toEqual([])
    expect(nextOccurrence(d(2026, 9, 28), null, d(2026, 10, 1))).toBeNull()
  })

  it('describes the rule in Turkish', () => {
    expect(repeatLabel(d(2026, 9, 28, 9), 'monthly')).toBe('her ayın 28. günü 09:00')
    expect(repeatLabel(d(2026, 9, 28, 10, 30), 'weekly')).toBe('her pazartesi 10:30')
    expect(repeatLabel(d(2026, 9, 28, 8), 'daily')).toBe('her gün 08:00')
    expect(repeatLabel(d(2026, 3, 5), 'yearly')).toBe('her yıl 5 Mart')
  })
})
