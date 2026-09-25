import { useEffect, useMemo, useState } from 'react'
import { AlarmClock, BookOpen, Check, ChevronDown, ChevronRight, MoreHorizontal, Pencil, Repeat as RepeatIcon, Trash2, Users } from 'lucide-react'
import { buildAgenda, isReminderNote, type AgendaItem } from '../lib/agenda'
import { repeatLabel } from '../lib/recurrence'
import { pathKeyOf } from '../lib/tree'
import type { Note, NoteContent } from '../lib/types'
import { sharesForPath } from '../lib/sharing'
import { confirmDialog } from '../state/confirm'
import { store, useNotex } from '../state/store'
import ReminderPicker from './ReminderPicker'
import ShareModal from './ShareModal'
import NoteCard from './NoteCard'
import TreeToggle from './TreeToggle'

interface Props {
  notes: Note[]
  contentOf: (n: Note) => NoteContent | undefined
  onOpenReader: (id: string, list: string[]) => void
  /** For the editor inside a reminder: the folder list and its datalist. */
  pathOptionsId: string
  folderPaths: string[]
  /** Renames a folder with everything in it (same as the notes sidebar). */
  onRenameFolder: (folder: string[], name: string) => void
}

// The Reminders page (separate from the notes tree): categories on the left,
// and an agenda on the right — overdue, the next 6 months by month, undated,
// completed. ✓ completes (a repeating reminder skips this occurrence),
// ⏰ changes the time or repeat.
export default function RemindersPage({ notes, contentOf, onOpenReader, pathOptionsId, folderPaths, onRenameFolder }: Props) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  const [category, setCategory] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [editing, setEditing] = useState<string | null>(null) // key of the item whose picker is open
  const [sharing, setSharing] = useState<string[] | null>(null) // path whose Paylaş dialog is open
  const [editingNote, setEditingNote] = useState<string | null>(null) // note being edited in place
  const [folderMenu, setFolderMenu] = useState<string | null>(null) // category key whose ⋯ menu is open
  const [renaming, setRenaming] = useState<{ key: string; name: string } | null>(null)
  const [treeOpen, setTreeOpen] = useState(false)
  const state = useNotex()

  const reminders = useMemo(() => notes.filter(isReminderNote), [notes])
  // Folders on the left. A folder someone shared with you is kept separate
  // from your own folder of the same name, and named after its owner (D18).
  const categories = useMemo(() => {
    const owners = new Map(state.sharedWithMe.map((sh) => [sh.owner?.id ?? '', sh.owner?.name || sh.owner?.email?.split('@')[0] || 'Biri']))
    const m = new Map<string, { key: string; path: string[]; label: string; mine: boolean; count: number }>()
    for (const n of reminders) {
      if (n.checked) continue
      const mine = !n.ownerId || n.ownerId === state.userId
      const key = `${mine ? '' : n.ownerId}::${pathKeyOf(n.path)}`
      const label = (mine ? '' : `${owners.get(n.ownerId ?? '') ?? 'Biri'} · `) + n.path.join(' / ')
      const at = m.get(key) ?? { key, path: n.path, label, mine, count: 0 }
      at.count++
      m.set(key, at)
    }
    return [...m.values()].sort((a, b) => Number(a.mine) - Number(b.mine) || a.label.localeCompare(b.label, 'tr'))
  }, [reminders, state.sharedWithMe, state.userId])
  const picked = categories.find((c) => c.key === category) ?? null
  const inCategory = picked
    ? reminders.filter((n) => `${!n.ownerId || n.ownerId === state.userId ? '' : n.ownerId}::${pathKeyOf(n.path)}` === picked.key)
    : reminders
  const agenda = useMemo(() => buildAgenda(inCategory, now), [inCategory, now])
  const allIds = [...agenda.overdue, ...agenda.months.flatMap((m) => m.items), ...agenda.undated].map((i) => i.note.id)
  const readerList = [...new Set(allIds)]

  /** Applies a folder rename typed in the list (empty or unchanged = nothing). */
  function commitRename(path: string[]) {
    const name = renaming?.name.trim()
    setRenaming(null)
    if (name && name !== path[path.length - 1]) onRenameFolder(path, name)
  }

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
    // Editing reuses the note card, so a reminder is edited with the same
    // editor (text, images, folder, time) as anywhere else.
    if (editingNote === note.id)
      return (
        <div key={key} className="agenda-edit">
          <NoteCard
            note={note}
            content={c}
            pathOptionsId={pathOptionsId}
            folderPaths={folderPaths}
            startEditing
            onEditDone={() => setEditingNote(null)}
            onOpenReader={() => onOpenReader(note.id, [note.id])}
            onMove={() => {}}
            onSelectPath={() => {}}
            onImageClick={() => {}}
            onUnlock={() => {}}
          />
        </div>
      )
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
            <button
              className="link agenda-cat"
              onClick={() => setCategory(`${!note.ownerId || note.ownerId === state.userId ? '' : note.ownerId}::${pathKeyOf(note.path)}`)}
            >
              {note.path.join(' / ')}
            </button>
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
          <button className="icon-btn" title="Düzenle" onClick={() => setEditingNote(note.id)} disabled={!c}><Pencil size={14} /></button>
          <button className="icon-btn" title="Oku" onClick={() => onOpenReader(note.id, readerList.includes(note.id) ? readerList : [note.id])}><BookOpen size={14} /></button>
          <button className="icon-btn danger" title="Sil" onClick={() => void remove(note)}><Trash2 size={14} /></button>
        </div>
      </div>
    )
  }

  const empty = !agenda.overdue.length && !agenda.months.length && !agenda.undated.length
  return (
    <div className="layout" onClick={() => folderMenu && setFolderMenu(null)}>
      <div className={`sidebar-wrap ${treeOpen ? 'open' : ''}`}>
        <TreeToggle
          open={treeOpen}
          label={picked ? picked.label : 'Tüm klasörler'}
          count={inCategory.filter((n) => !n.checked).length}
          onToggle={() => setTreeOpen((o) => !o)}
        />
        <nav className="sidebar card">
          <div className={`tree-row tree-all ${!category ? 'selected' : ''}`} onClick={() => setCategory(null)}>
            Tümü <span className="count">{categories.reduce((a, c) => a + c.count, 0)}</span>
          </div>
          {categories.map((c) => {
            // Paylaş is only for your own folders: you can't share someone
            // else's, and a locked folder's notes are unreadable to them (D8).
            const locked = state.folders.some((f) => f.pathKey === pathKeyOf(c.path) && !!f.pathKey)
            const shared = sharesForPath(state.shares, c.path)
            return (
              <div key={c.key}>
              <div className={`tree-row ${category === c.key ? 'selected' : ''}`} style={{ paddingLeft: 12 }} onClick={() => { setCategory(c.key); setTreeOpen(false) }}>
                {renaming?.key === c.key ? (
                  <input
                    className="rename-input"
                    autoFocus
                    aria-label="Klasörün yeni adı"
                    value={renaming.name}
                    onFocus={(e) => e.target.select()}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenaming({ key: c.key, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(c.path)
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    onBlur={() => commitRename(c.path)}
                  />
                ) : (
                  <span className="tree-label">
                    <span className="ellipsis">{c.label}</span>
                    {shared.length > 0 && <Users size={10} className="shared-badge" />}
                  </span>
                )}
                {c.mine && (
                  <button
                    className="icon-btn hover-only"
                    title="Klasör işlemleri"
                    aria-label="Klasör işlemleri"
                    onClick={(e) => {
                      e.stopPropagation()
                      setFolderMenu(folderMenu === c.key ? null : c.key)
                    }}
                  >
                    <MoreHorizontal size={13} />
                  </button>
                )}
                <span className="count">{c.count}</span>
              </div>
                {folderMenu === c.key && (
                  <div className="folder-menu card" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => {
                        setRenaming({ key: c.key, name: c.path[c.path.length - 1] })
                        setFolderMenu(null)
                      }}
                    >
                      <Pencil size={12} /> Yeniden adlandır
                    </button>
                    <button
                      onClick={() => {
                        setSharing(c.path)
                        setFolderMenu(null)
                      }}
                      disabled={locked}
                      title={locked ? 'Şifreli klasörler paylaşılamaz' : ''}
                    >
                      <Users size={12} /> Paylaş…
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {sharing && <ShareModal path={sharing} shares={state.shares} onClose={() => setSharing(null)} />}
          {!categories.length && <div className="muted" style={{ padding: '6px 8px' }}>Henüz hatırlatma yok</div>}
        </nav>
      </div>

      <section className="notes agenda">
        {picked && <div className="crumb">{picked.label}</div>}
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
