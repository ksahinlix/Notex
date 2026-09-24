import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Clock } from 'lucide-react'
import { buildAgenda, stripItems } from '../lib/agenda'
import type { Note, NoteContent } from '../lib/types'
import { store } from '../state/store'

interface Props {
  notes: Note[]
  contentOf: (n: Note) => NoteContent | undefined
  onShowAll: () => void
}

const SHOW = 4

/** Small strip on the notes page: overdue, undated and the coming week (see stripItems); the rest is on the Reminders page. */
export default function UpcomingStrip({ notes, contentOf, onShowAll }: Props) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  const agenda = useMemo(() => buildAgenda(notes, now), [notes, now])
  const items = stripItems(agenda, now)
  const total = agenda.overdue.length + agenda.months.reduce((a, m) => a + m.items.length, 0) + agenda.undated.length
  if (!total) return null
  return (
    <section className="reminders">
      <div className="reminders-title">
        <Clock size={13} /> Yaklaşan hatırlatmalar
        <button className="link strip-all" onClick={onShowAll}>
          Tümü ({total}) <ArrowRight size={12} />
        </button>
      </div>
      {items.slice(0, SHOW).map(({ note, at }) => {
        const c = contentOf(note)
        const overdue = !!at && at < now
        return (
          <div key={`${note.id}@${at?.getTime() ?? 'none'}`} className="reminder-row">
            <button className="reminder-done" title="Tamamlandı" aria-label="Tamamlandı" onClick={() => store.completeReminder(note, at)}>
              <Check size={11} />
            </button>
            <span className={overdue ? 'overdue' : at ? 'c-reminder' : 'muted'}>
              {at ? at.toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Tarihsiz'}
            </span>
            <span className="reminder-text">{c ? c.reminderLabel || c.text : '(kilitli not)'}</span>
          </div>
        )
      })}
      {items.length > SHOW && (
        <button className="link muted small" onClick={onShowAll}>+{items.length - SHOW} daha</button>
      )}
    </section>
  )
}
