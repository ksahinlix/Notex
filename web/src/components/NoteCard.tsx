import { useRef, useState } from 'react'
import { BookOpen, Check, Clock, FolderInput, GripVertical, ImagePlus, Lock, MessageCircle, Pencil, Sparkles, Trash2, X } from 'lucide-react'
import { formatDate } from '../lib/format'
import { repeatLabel } from '../lib/recurrence'
import { fileToDataUrl, imageFilesFrom } from '../lib/images'
import { newId, nowIso, withImages } from '../lib/notes'
import { blocksToText } from '../lib/paste'
import { parsePath } from '../lib/tree'
import type { Note, NoteContent } from '../lib/types'
import { confirmDialog } from '../state/confirm'
import { store } from '../state/store'
import MoveMenu from './MoveMenu'
import NoteBody from './NoteBody'
import ReminderPicker, { type ReminderChoice } from './ReminderPicker'
import RichEditor, { type RichEditorHandle } from './RichEditor'

interface Props {
  note: Note
  content: NoteContent | undefined
  pathOptionsId: string
  /** All folder paths, for the "Taşı" menu. */
  folderPaths: string[]
  /** Search words to highlight. */
  terms?: string[]
  /** Found by meaning (AI), not by the typed words. */
  meaningMatch?: boolean
  onOpenReader: () => void
  onSelectPath: (path: string[]) => void
  onImageClick: (src: string) => void
  onUnlock: () => void
}

/** More than a minute between creation and the last change counts as an edit. */
const wasEdited = (n: Note) => Date.parse(n.updatedAt) - Date.parse(n.createdAt) > 60_000

export default function NoteCard({ note, content, pathOptionsId, folderPaths, terms, meaningMatch, onOpenReader, onSelectPath, onImageClick, onUnlock }: Props) {
  const [editing, setEditing] = useState(false)
  const [draftPath, setDraftPath] = useState('')
  const [draftReminder, setDraftReminder] = useState<ReminderChoice | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [imagesLoading, setImagesLoading] = useState(false)
  const editorRef = useRef<RichEditorHandle>(null)
  const [commenting, setCommenting] = useState(false)
  const [comment, setComment] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLElement>(null)
  const [moving, setMoving] = useState(false)
  const [dragging, setDragging] = useState(false)

  if (!content) {
    return (
      <div className="note locked" onClick={onUnlock}>
        <Lock size={13} /> Kilitli not — görmek için tıkla
        <span className="note-path">{note.path.join(' / ')}</span>
      </div>
    )
  }
  const c = content

  function startEdit() {
    setDraftPath(note.path.join(' / '))
    setDraftReminder(
      note.isReminder || note.reminderAt ? { at: note.reminderAt ? new Date(note.reminderAt) : null, repeat: note.repeat ?? null } : null,
    )
    setPickerOpen(false)
    setEditing(true)
  }

  async function saveEdit() {
    const blocks = editorRef.current?.getBlocks() ?? []
    const text = blocksToText(blocks)
    const path = parsePath(draftPath)
    if ((!text && !blocks.length) || !path.length || imagesLoading) return
    const next: NoteContent = {
      ...c,
      text,
      blocks,
      listItemText: note.isListItem ? text : c.listItemText,
      reminderLabel: draftReminder ? c.reminderLabel || text.split('\n')[0].slice(0, 80) : null,
    }
    setEditing(false)
    await store.update(
      {
        ...note,
        path,
        reminderAt: draftReminder?.at ? draftReminder.at.toISOString() : null,
        isReminder: !!draftReminder,
        repeat: draftReminder?.at ? (draftReminder.repeat ?? null) : null,
        // a new time or rule starts fresh
        reminderDoneUntil: draftReminder?.at?.toISOString() === note.reminderAt && (draftReminder?.repeat ?? null) === (note.repeat ?? null) ? note.reminderDoneUntil : null,
      },
      next,
    )
  }

  async function askDelete() {
    const preview = (c.listItemText || c.text || '').replace(/\s+/g, ' ').trim()
    const ok = await confirmDialog({
      title: 'Not silinsin mi?',
      message: preview ? `“${preview.length > 90 ? preview.slice(0, 90) + '…' : preview}”` : undefined,
      confirmLabel: 'Sil',
      danger: true,
    })
    if (ok) store.remove(note)
  }

  async function addComment() {
    const text = comment.trim()
    if (!text) return
    await store.update(note, { ...c, comments: [...(c.comments ?? []), { id: newId(), text, createdAt: nowIso() }] })
    setComment('')
    setCommenting(false)
  }

  async function addImages(files: File[]) {
    if (!files.length) return
    const urls = await Promise.all(files.map(fileToDataUrl))
    await store.update(note, withImages(c, urls))
  }

  return (
    <article ref={cardRef} className={`note ${dragging ? 'dragging' : ''}`}>
      <div className="note-row">
        {!editing && (
          // Only this handle drags (the rest of the card stays selectable text).
          <span
            className="drag-handle hover-only"
            draggable
            title="Sürükleyip soldaki bir klasöre bırak"
            onDragStart={(e) => {
              e.dataTransfer.setData('text/notex-note', note.id)
              e.dataTransfer.effectAllowed = 'move'
              if (cardRef.current) e.dataTransfer.setDragImage(cardRef.current, 16, 16)
              document.body.classList.add('dragging-note')
              setDragging(true)
            }}
            onDragEnd={() => {
              document.body.classList.remove('dragging-note')
              setDragging(false)
            }}
          >
            <GripVertical size={14} />
          </span>
        )}
        {note.isListItem && (
          <button className={`checkbox ${note.checked ? 'on' : ''}`} onClick={() => store.setChecked(note, !note.checked)} aria-label="İşaretle">
            {note.checked && <Check size={11} color="#fff" />}
          </button>
        )}
        <div className="note-main">
          <div className="note-top">
            <button className="note-path link" onClick={() => onSelectPath(note.path)} title={note.path.join(' / ')}>
              {note.path[note.path.length - 1]}
              {note.encrypted && <Lock size={9} />}
            </button>
            {meaningMatch && (
              <span className="meaning-tag" title="Aradığın kelimeler geçmiyor ama AI konuyu ilgili buldu">
                <Sparkles size={10} /> anlamca ilgili
              </span>
            )}
          </div>

          {editing ? (
            <div className="edit">
              <RichEditor
                ref={editorRef}
                autoFocus
                className="edit-editor"
                initialBlocks={note.isListItem ? [{ type: 'text', content: c.listItemText || c.text }] : c.blocks?.length ? c.blocks : [{ type: 'text', content: c.text }]}
                onSubmit={() => void saveEdit()}
                onBusyChange={setImagesLoading}
              />
              <div className="edit-row">
                <input list={pathOptionsId} value={draftPath} onChange={(e) => setDraftPath(e.target.value)} placeholder="Kategori / Klasör / Sayfa" />
                <button className={`btn btn-ghost ${draftReminder ? 'on' : ''}`} title="Hatırlatma" onClick={() => setPickerOpen((o) => !o)}>
                  <Clock size={14} />
                </button>
              </div>
              {draftReminder && (
                <div className="reminder-chip">
                  <Clock size={12} />
                  <button className="link" title="Zamanı değiştir" onClick={() => setPickerOpen(true)}>
                    Hatırlatma:{' '}
                    <b>
                      {draftReminder.at && draftReminder.repeat
                        ? repeatLabel(draftReminder.at, draftReminder.repeat)
                        : draftReminder.at
                          ? formatDate(draftReminder.at.toISOString())
                          : 'tarihsiz'}
                    </b>
                  </button>
                  <button className="icon-btn" title="Hatırlatmayı kaldır" onClick={() => setDraftReminder(null)}><X size={12} /></button>
                </div>
              )}
              {pickerOpen && (
                <div className="picker-anchor">
                  <ReminderPicker
                    value={draftReminder?.at ?? null}
                    repeat={draftReminder?.repeat ?? null}
                    onPick={(choice) => {
                      setDraftReminder(choice)
                      setPickerOpen(false)
                    }}
                    onClose={() => setPickerOpen(false)}
                  />
                </div>
              )}
              <div className="edit-row">
                <button className="btn btn-primary" onClick={saveEdit} disabled={imagesLoading}>Kaydet</button>
                <button className="btn btn-ghost" onClick={() => setEditing(false)}>Vazgeç</button>
              </div>
            </div>
          ) : (
            <NoteBody note={note} content={c} terms={terms} onImageClick={onImageClick} />
          )}

          <div className="note-meta">
            {formatDate(note.createdAt)}
            {wasEdited(note) && <span title={`Son düzenleme: ${formatDate(note.updatedAt)}`}>· düzenlendi {formatDate(note.updatedAt)}</span>}
            {note.reminderAt && note.repeat ? (
              <span className="c-reminder"><Clock size={10} /> {repeatLabel(new Date(note.reminderAt), note.repeat)}</span>
            ) : note.reminderAt ? (
              <span className="c-reminder"><Clock size={10} /> {formatDate(note.reminderAt)}</span>
            ) : note.isReminder ? (
              <span className="c-reminder"><Clock size={10} /> hatırlatma</span>
            ) : null}
          </div>

          {!!c.comments?.length && (
            <div className="comments">
              {c.comments.map((cm) => (
                <div key={cm.id} className="comment">
                  <div>
                    <span className="muted small">{formatDate(cm.createdAt)}</span>
                    <div className="pre">{cm.text}</div>
                  </div>
                  <button
                    className="icon-btn"
                    aria-label="Yorumu sil"
                    onClick={() => store.update(note, { ...c, comments: c.comments!.filter((x) => x.id !== cm.id) })}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {moving && (
            <div className="picker-anchor">
              <MoveMenu
                current={note.path}
                paths={folderPaths}
                onMove={(path) => {
                  setMoving(false)
                  void store.move(note, path)
                }}
                onClose={() => setMoving(false)}
              />
            </div>
          )}

          {commenting && (
            <div className="edit-row">
              <input
                autoFocus
                placeholder="Yorumunu yaz..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addComment()
                  if (e.key === 'Escape') setCommenting(false)
                }}
              />
              <button className="btn btn-primary" onClick={addComment}>Ekle</button>
            </div>
          )}
        </div>

        {!editing && (
          <div className="note-actions">
            <button className="icon-btn hover-only" title="Okuma modu" onClick={onOpenReader}><BookOpen size={14} /></button>
            <button className="icon-btn hover-only" title="Düzenle" onClick={startEdit}><Pencil size={14} /></button>
            <button className="icon-btn hover-only" title="Taşı" onClick={() => setMoving((v) => !v)}><FolderInput size={14} /></button>
            <button className="icon-btn hover-only" title="Yorum ekle" onClick={() => setCommenting((v) => !v)}><MessageCircle size={14} /></button>
            <button className="icon-btn hover-only" title="Görsel ekle" onClick={() => fileRef.current?.click()}><ImagePlus size={14} /></button>
            <button className="icon-btn hover-only danger" title="Sil" onClick={() => void askDelete()}><Trash2 size={14} /></button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void addImages(imageFilesFrom(e.target.files))
                e.target.value = ''
              }}
            />
          </div>
        )}
      </div>
    </article>
  )
}
