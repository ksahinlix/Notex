import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { formatDate } from '../lib/format'
import type { Note, NoteContent } from '../lib/types'

interface Props {
  notes: Note[]
  contentOf: (n: Note) => NoteContent | undefined
}

/** Reminders from the last 24 hours onward, soonest first. */
export default function Reminders({ notes, contentOf }: Props) {
  // Current time, refreshed every minute so "overdue" updates on its own.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const since = now - 86400_000
  const items = notes
    .filter((n) => n.reminderAt && !n.checked && Date.parse(n.reminderAt) >= since)
    .sort((a, b) => a.reminderAt!.localeCompare(b.reminderAt!))
  if (!items.length) return null
  return (
    <section className="reminders">
      <div className="reminders-title"><Clock size={13} /> Hatırlatmalar</div>
      {items.map((n) => {
        const c = contentOf(n)
        const overdue = Date.parse(n.reminderAt!) < now
        return (
          <div key={n.id} className="reminder-row">
            <span className={overdue ? 'overdue' : 'c-reminder'}>{formatDate(n.reminderAt!)}</span>
            {' — '}
            {c ? c.reminderLabel || c.text : '(kilitli not)'}
          </div>
        )
      })}
    </section>
  )
}
