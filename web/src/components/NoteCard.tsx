import { useRef, useState } from 'react'
import { Check, Clock, ImagePlus, Lock, Maximize2, MessageCircle, Minimize2, Pencil, Trash2, X } from 'lucide-react'
import { formatDate, fromLocalInput, toLocalInput } from '../lib/format'
import { fileToDataUrl, imageFilesFrom } from '../lib/images'
import { newId, nowIso, withImages } from '../lib/notes'
import { blocksToText } from '../lib/paste'
import { parsePath } from '../lib/tree'
import type { Note, NoteContent } from '../lib/types'
import { store } from '../state/store'
import { confirmDialog } from '../state/confirm'
import RichEditor, { type RichEditorHandle } from './RichEditor'

interface Props {
  note: Note
  content: NoteContent | undefined
  expanded: boolean
  pathOptionsId: string
  onToggleExpand: () => void
  onSelectPath: (path: string[]) => void
  onImageClick: (src: string) => void
  onUnlock: () => void
}

export default function NoteCard({ note, content, expanded, pathOptionsId, onToggleExpand, onSelectPath, onImageClick, onUnlock }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ path: '', reminder: '' })
  const [imagesLoading, setImagesLoading] = useState(false)
  const editorRef = useRef<RichEditorHandle>(null)
  const [commenting, setCommenting] = useState(false)
  const [comment, setComment] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

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
    setDraft({ path: note.path.join(' / '), reminder: toLocalInput(note.reminderAt) })
    setEditing(true)
  }

  async function saveEdit() {
    const blocks = editorRef.current?.getBlocks() ?? []
    const text = blocksToText(blocks)
    const path = parsePath(draft.path)
    if ((!text && !blocks.length) || !path.length || imagesLoading) return
    const next = { ...c, text, blocks, listItemText: note.isListItem ? text : c.listItemText }
    const reminderAt = fromLocalInput(draft.reminder)
    if (reminderAt && !next.reminderLabel) next.reminderLabel = text.split('\n')[0].slice(0, 80)
    setEditing(false)
    await store.update({ ...note, path, reminderAt }, next)
  }

  async function askDelete() {
    const preview = (c.listItemText || c.text || '').replace(/s+/g, ' ').trim()
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

  const blocks = c.blocks?.length ? c.blocks : [{ type: 'text' as const, content: c.text }]

  return (
    <article
      className={`note ${expanded ? 'expanded' : ''}`}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/notex-note', note.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <div className="note-row">
        {note.isListItem && (
          <button className={`checkbox ${note.checked ? 'on' : ''}`} onClick={() => store.setChecked(note, !note.checked)} aria-label="İşaretle">
            {note.checked && <Check size={11} color="#fff" />}
          </button>
        )}
        <div className="note-main">
          <button className="note-path link" onClick={() => onSelectPath(note.path)} title={note.path.join(' / ')}>
            {note.path[note.path.length - 1]}
            {note.encrypted && <Lock size={9} />}
          </button>

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
                <input list={pathOptionsId} value={draft.path} onChange={(e) => setDraft({ ...draft, path: e.target.value })} placeholder="Kategori / Klasör / Sayfa" />
                <input type="datetime-local" value={draft.reminder} onChange={(e) => setDraft({ ...draft, reminder: e.target.value })} title="Hatırlatma" />
              </div>
              <div className="edit-row">
                <button className="btn btn-primary" onClick={saveEdit} disabled={imagesLoading}>Kaydet</button>
                <button className="btn btn-ghost" onClick={() => setEditing(false)}>Vazgeç</button>
              </div>
            </div>
          ) : (
            <div className={`note-body ${note.checked ? 'done' : ''}`}>
              {note.isListItem
                ? c.listItemText || c.text
                : blocks.map((b, i) =>
                    b.type === 'image' ? (
                      <img key={i} src={b.src} alt={b.alt ?? ''} className="note-img" onClick={() => onImageClick(b.src)} />
                    ) : (
                      <span key={i} className="pre">{b.content}</span>
                    ),
                  )}
            </div>
          )}

          <div className="note-meta">
            {formatDate(note.createdAt)}
            {note.reminderAt && (
              <span className="c-reminder"><Clock size={10} /> {formatDate(note.reminderAt)}</span>
            )}
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
            <button className={`icon-btn ${expanded ? 'active' : 'hover-only'}`} title={expanded ? 'Okuma modundan çık' : 'Okuma modu'} onClick={onToggleExpand}>
              {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button className="icon-btn hover-only" title="Düzenle" onClick={startEdit}><Pencil size={14} /></button>
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
