import { useEffect, useState } from 'react'
import { Check, Clock } from 'lucide-react'
import { formatDate } from '../lib/format'
import type { Note, NoteContent } from '../lib/types'
import { store } from '../state/store'

interface Props {
  notes: Note[]
  contentOf: (n: Note) => NoteContent | undefined
}

/**
 * Open reminders: dated ones from the last 24 hours onward (soonest first),
 * then undated ones ("Tarihsiz"). ✓ marks a reminder as done.
 */
export default function Reminders({ notes, contentOf }: Props) {
  // Current time, refreshed every minute so "overdue" updates on its own.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const since = now - 86400_000
  const dated = notes
    .filter((n) => n.reminderAt && !n.checked && Date.parse(n.reminderAt) >= since)
    .sort((a, b) => a.reminderAt!.localeCompare(b.reminderAt!))
  const undated = notes.filter((n) => n.isReminder && !n.reminderAt && !n.checked)
  if (!dated.length && !undated.length) return null

  const row = (n: Note, when: React.ReactNode) => {
    const c = contentOf(n)
    return (
      <div key={n.id} className="reminder-row">
        <button className="reminder-done" title="Tamamlandı" aria-label="Tamamlandı" onClick={() => store.setChecked(n, true)}>
          <Check size={11} />
        </button>
        {when}
        <span className="reminder-text">{c ? c.reminderLabel || c.text : '(kilitli not)'}</span>
      </div>
    )
  }

  return (
    <section className="reminders">
      <div className="reminders-title"><Clock size={13} /> Hatırlatmalar</div>
      {dated.map((n) =>
        row(n, <span className={Date.parse(n.reminderAt!) < now ? 'overdue' : 'c-reminder'}>{formatDate(n.reminderAt!)}</span>),
      )}
      {undated.length > 0 && (
        <>
          {dated.length > 0 && <div className="reminders-sub">Tarihsiz</div>}
          {undated.map((n) => row(n, <span className="c-reminder">tarihsiz</span>))}
        </>
      )}
    </section>
  )
}
