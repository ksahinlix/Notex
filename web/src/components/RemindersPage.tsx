import { useEffect, useMemo, useState } from 'react'
import { AlarmClock, BookOpen, Check, ChevronDown, ChevronRight, Repeat as RepeatIcon, Trash2 } from 'lucide-react'
import { buildAgenda, isReminderNote, type AgendaItem } from '../lib/agenda'
import { repeatLabel } from '../lib/recurrence'
import { pathKeyOf } from '../lib/tree'
import type { Note, NoteContent } from '../lib/types'
import { confirmDialog } from '../state/confirm'
import { store } from '../state/store'
import ReminderPicker from './ReminderPicker'

interface Props {
  notes: Note[]
  contentOf: (n: Note) => NoteContent | undefined
  onOpenReader: (id: string, list: string[]) => void
}

// The Reminders page (separate from the notes tree): categories on the left,
// and an agenda on the right — overdue, the next 6 months by month, undated,
// completed. ✓ completes (a repeating reminder skips this occurrence),
// ⏰ changes the time or repeat.
export default function RemindersPage({ notes, contentOf, onOpenReader }: Props) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  const [category, setCategory] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [editing, setEditing] = useState<string | null>(null) // key of the item whose picker is open

  const reminders = useMemo(() => notes.filter(isReminderNote), [notes])
  const categories = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of reminders) if (!n.checked) m.set(pathKeyOf(n.path), (m.get(pathKeyOf(n.path)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr'))
  }, [reminders])
  const inCategory = category ? reminders.filter((n) => pathKeyOf(n.path) === category) : reminders
  const agenda = useMemo(() => buildAgenda(inCategory, now), [inCategory, now])
  const allIds = [...agenda.overdue, ...agenda.months.flatMap((m) => m.items), ...agenda.undated].map((i) => i.note.id)
  const readerList = [...new Set(allIds)]

  async function remove(note: Note) {
    const c = contentOf(note)
    const ok = await confirmDialog({
      title: 'Hatırlatma silinsin mi?',
      message: c ? `“${(c.reminderLabel || c.text).replace(/\s+/g, ' ').slice(0, 90)}”` : undefined,
      confirmLabel: 'Sil',
      danger: true,
    })
    if (ok) store.remove(note)
  }

  const row = (item: AgendaItem, overdue = false) => {
    const { note, at } = item
    const c = contentOf(note)
    const key = `${note.id}@${at?.getTime() ?? 'none'}`
    return (
      <div key={key} className={`agenda-item ${overdue ? 'overdue-item' : ''} ${note.checked ? 'done-item' : ''}`}>
        <div className="agenda-date">
          {at ? (
            <>
              <span className="agenda-day">{at.getDate()}</span>
              <span className="agenda-wd">{at.toLocaleDateString('tr-TR', { weekday: 'short' })}</span>
            </>
          ) : (
            <span className="agenda-wd">—</span>
          )}
        </div>
        <div className="agenda-main">
          <div className="agenda-text">{c ? c.reminderLabel || c.text : '(kilitli not)'}</div>
          <div className="agenda-meta">
            {at && <span className={overdue ? 'overdue' : ''}>{at.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>}
            {!at && <span>tarihsiz</span>}
            {note.repeat && note.reminderAt && (
              <span className="agenda-repeat"><RepeatIcon size={10} /> {repeatLabel(new Date(note.reminderAt), note.repeat)}</span>
            )}
            <button className="link agenda-cat" onClick={() => setCategory(pathKeyOf(note.path))}>{note.path.join(' / ')}</button>
          </div>
          {editing === key && (
            <div className="picker-anchor agenda-picker">
              <ReminderPicker
                value={note.reminderAt ? new Date(note.reminderAt) : null}
                repeat={note.repeat ?? null}
                onPick={(choice) => {
                  store.updateMeta(note, {
                    reminderAt: choice.at ? choice.at.toISOString() : null,
                    repeat: choice.at ? (choice.repeat ?? null) : null,
                    isReminder: true,
                    reminderDoneUntil: null,
                    checked: false,
                  })
                  setEditing(null)
                }}
                onClose={() => setEditing(null)}
              />
            </div>
          )}
        </div>
        <div className="agenda-actions">
          {!note.checked && (
            <button className="icon-btn agenda-done" title={note.repeat ? 'Bu seferlik tamamlandı' : 'Tamamlandı'} aria-label="Tamamlandı" onClick={() => store.completeReminder(note, at)}>
              <Check size={14} />
            </button>
          )}
          <button className="icon-btn" title="Zamanı değiştir" onClick={() => setEditing(editing === key ? null : key)}><AlarmClock size={14} /></button>
          <button className="icon-btn" title="Oku" onClick={() => onOpenReader(note.id, readerList.includes(note.id) ? readerList : [note.id])}><BookOpen size={14} /></button>
          <button className="icon-btn danger" title="Sil" onClick={() => void remove(note)}><Trash2 size={14} /></button>
        </div>
      </div>
    )
  }

  const empty = !agenda.overdue.length && !agenda.months.length && !agenda.undated.length
  return (
    <div className="layout">
      <div className="sidebar-wrap">
        <nav className="sidebar card">
          <div className={`tree-row tree-all ${!category ? 'selected' : ''}`} onClick={() => setCategory(null)}>
            Tümü <span className="count">{categories.reduce((a, [, c]) => a + c, 0)}</span>
          </div>
          {categories.map(([key, count]) => (
            <div key={key} className={`tree-row ${category === key ? 'selected' : ''}`} style={{ paddingLeft: 12 }} onClick={() => setCategory(key)}>
              <span className="tree-label"><span className="ellipsis">{key.split('/').join(' / ')}</span></span>
              <span className="count">{count}</span>
            </div>
          ))}
          {!categories.length && <div className="muted" style={{ padding: '6px 8px' }}>Henüz hatırlatma yok</div>}
        </nav>
      </div>

      <section className="notes agenda">
        {category && <div className="crumb">{category.split('/').join(' / ')}</div>}
        {empty && (
          <div className="muted empty">
            Yaklaşan hatırlatma yok. Aşağıya örneğin <b>“Kredi kartı ekstresi her ayın 28'i”</b> ya da <b>“Yarın 10'da dişçiyi hatırlat”</b> yaz.
          </div>
        )}
        {agenda.overdue.length > 0 && (
          <div className="agenda-group">
            <div className="agenda-title overdue">Gecikmiş</div>
            {agenda.overdue.map((i) => row(i, true))}
          </div>
        )}
        {agenda.months.map((m) => (
          <div key={m.key} className="agenda-group">
            <div className="agenda-title">{m.title}</div>
            {m.items.map((i) => row(i))}
          </div>
        ))}
        {agenda.undated.length > 0 && (
          <div className="agenda-group">
            <div className="agenda-title">Tarihsiz</div>
            {agenda.undated.map((i) => row(i))}
          </div>
        )}
        {agenda.done.length > 0 && (
          <div className="agenda-group">
            <button className="agenda-title link" onClick={() => setShowDone(!showDone)}>
              {showDone ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Tamamlananlar ({agenda.done.length})
            </button>
            {showDone && agenda.done.map((i) => row(i))}
          </div>
        )}
      </section>
    </div>
  )
}
