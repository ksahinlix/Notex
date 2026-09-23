import { useEffect, useRef, useState } from 'react'
import { combineDayTime, defaultReminder, reminderPresets, upcomingDays } from '../lib/reminderPresets'

/** A chosen reminder: a time, or `null` for a reminder without a date. */
export interface ReminderChoice {
  at: Date | null
}

interface Props {
  /** Current value, used to pre-fill the custom day/time. */
  value: Date | null
  onPick: (choice: ReminderChoice) => void
  onClose: () => void
}

const pad = (n: number) => String(n).padStart(2, '0')
const dayValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Popover for setting a reminder by hand: quick choices, or a day (no year)
// and a time. Opens with "1 hour later" pre-filled.
export default function ReminderPicker({ value, onPick, onClose }: Props) {
  const [now] = useState(() => new Date())
  const initial = value ?? defaultReminder(now)
  const [day, setDay] = useState(dayValue(initial))
  const [time, setTime] = useState(`${pad(initial.getHours())}:${pad(initial.getMinutes())}`)
  const ref = useRef<HTMLDivElement>(null)
  const days = upcomingDays(now)

  // Close on Esc or a click outside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  return (
    <div className="reminder-picker card" ref={ref} role="dialog" aria-label="Hatırlatma zamanı">
      <div className="picker-presets">
        {reminderPresets(now).map((p) => (
          <button key={p.label} className="chip" onClick={() => onPick({ at: p.at(now) })}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="picker-custom">
        <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="Gün">
          {days.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Saat" />
        <button
          className="btn btn-primary"
          onClick={() => {
            const at = combineDayTime(day, time)
            if (at) onPick({ at })
          }}
        >
          Ayarla
        </button>
      </div>
    </div>
  )
}
