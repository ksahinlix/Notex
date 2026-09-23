import { describe, expect, it } from 'vitest'
import { combineDayTime, defaultReminder, reminderPresets, upcomingDays } from './reminderPresets'

const NOW = new Date(2026, 8, 23, 14, 30) // Wed 23 Sep 2026, 14:30

describe('reminder presets', () => {
  it('offers quick choices relative to now', () => {
    const p = Object.fromEntries(reminderPresets(NOW).map((x) => [x.label, x.at(NOW)]))
    expect(p['1 saat sonra']).toEqual(new Date(2026, 8, 23, 15, 30))
    expect(p['2 saat sonra']).toEqual(new Date(2026, 8, 23, 16, 30))
    expect(p['Bu akşam 20:00']).toEqual(new Date(2026, 8, 23, 20, 0))
    expect(p['Yarın 09:00']).toEqual(new Date(2026, 8, 24, 9, 0))
    expect(p['1 hafta sonra']).toEqual(new Date(2026, 8, 30, 9, 0))
    expect(p['Tarihsiz']).toBeNull()
  })

  it('hides "this evening" when it is already evening', () => {
    expect(reminderPresets(new Date(2026, 8, 23, 21, 0)).map((x) => x.label)).not.toContain('Bu akşam 20:00')
  })

  it('defaults to one hour later', () => {
    expect(defaultReminder(NOW)).toEqual(new Date(2026, 8, 23, 15, 30))
  })

  it('lists days without a year and combines day + time', () => {
    const days = upcomingDays(NOW, 3)
    expect(days.map((d) => d.label.slice(0, 5))).toEqual(['Bugün', 'Yarın', days[2].label.slice(0, 5)])
    expect(days[2].label).not.toMatch(/2026/)
    expect(combineDayTime(days[1].value, '07:45')).toEqual(new Date(2026, 8, 24, 7, 45))
    expect(combineDayTime('x', '07:45')).toBeNull()
  })
})
