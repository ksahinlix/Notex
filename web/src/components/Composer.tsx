import { useRef, useState } from 'react'
import { Clock, ImagePlus, ListChecks, Plus, Sparkles, X } from 'lucide-react'
import { useFolderSuggestions, type NoteVectors } from '../ai/useAi'
import { fromLocalInput } from '../lib/format'
import { fileToDataUrl, imageFilesFrom } from '../lib/images'
import { buildBlocks } from '../lib/notes'
import { parsePath } from '../lib/tree'
import type { Note } from '../lib/types'
import { store } from '../state/store'

interface Props {
  selectedPath: string[] | null
  pathOptionsId: string
  notes: Note[]
  vectors: NoteVectors
  aiReady: boolean
}

/** Who set the path field: AI keeps filling it until the user types or picks a folder. */
type PathSource = 'ai' | 'user' | 'selection'

// Bottom bar for writing new notes. With AI on, it suggests existing pages for
// the text being written (D3) and fills the path with the best one.
export default function Composer({ selectedPath, pathOptionsId, notes, vectors, aiReady }: Props) {
  const [text, setText] = useState('')
  const [path, setPath] = useState('')
  const [pathSource, setPathSource] = useState<PathSource>('ai')
  const [images, setImages] = useState<string[]>([])
  const [isListItem, setIsListItem] = useState(false)
  const [showReminder, setShowReminder] = useState(false)
  const [reminder, setReminder] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  // Picking a folder in the sidebar pre-fills the path (adjusting state during
  // render when the prop changes, as the React docs recommend over an effect).
  const [prevSelected, setPrevSelected] = useState(selectedPath)
  if (selectedPath !== prevSelected) {
    setPrevSelected(selectedPath)
    if (selectedPath) {
      setPath(selectedPath.join(' / '))
      setPathSource('selection')
    }
  }

  const suggestions = useFolderSuggestions(text, notes, vectors, aiReady)
  // The path shown (and saved): AI's top pick while the path is AI-controlled.
  const effectivePath = pathSource === 'ai' && suggestions.length ? suggestions[0].path.join(' / ') : path

  async function addFiles(files: File[]) {
    if (!files.length) return
    const urls = await Promise.all(files.map(fileToDataUrl))
    setImages((prev) => [...prev, ...urls])
  }

  async function save() {
    const t = text.trim()
    const p = parsePath(effectivePath)
    if (!t && !images.length) return
    if (!p.length) return setError('Önce bir yol yaz: Kategori / Klasör / Sayfa')
    const reminderAt = showReminder ? fromLocalInput(reminder) : null
    if (showReminder && !reminderAt) return setError('Hatırlatma için tarih ve saat seç.')
    setBusy(true)
    setError('')
    const ok = await store.create(
      p,
      {
        text: t,
        blocks: buildBlocks(t, images),
        listItemText: isListItem ? t : null,
        reminderLabel: reminderAt ? t.split('\n')[0].slice(0, 80) : null,
        comments: [],
      },
      { isListItem, reminderAt },
    )
    setBusy(false)
    if (!ok) return setError('Şifre girilmeden bu klasöre kaydedilemez.')
    setText('')
    setImages([])
    setIsListItem(false)
    setShowReminder(false)
    setReminder('')
    // Next note: let AI suggest again, unless a folder is selected in the tree.
    if (!selectedPath) {
      setPath('')
      setPathSource('ai')
    }
    textRef.current?.focus()
  }

  return (
    <div className="composer-bar">
      <div
        className="composer card"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const files = imageFilesFrom(e.dataTransfer.files)
          if (files.length) {
            e.preventDefault()
            void addFiles(files)
          }
        }}
      >
        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = imageFilesFrom(e.clipboardData.items)
            if (files.length) {
              e.preventDefault()
              void addFiles(files)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save()
          }}
          placeholder="Aklına geleni yaz... (görsel yapıştırabilir ya da sürükleyebilirsin · Ctrl+Enter kaydeder)"
          rows={2}
        />

        {images.length > 0 && (
          <div className="thumbs">
            {images.map((src, i) => (
              <div key={i} className="thumb">
                <img src={src} alt="" />
                <button onClick={() => setImages(images.filter((_, j) => j !== i))} aria-label="Görseli kaldır"><X size={10} /></button>
              </div>
            ))}
          </div>
        )}

        <div className="composer-row">
          <input className="path-input" list={pathOptionsId} placeholder="Kategori / Klasör / Sayfa" value={effectivePath}
            onChange={(e) => {
              setPath(e.target.value)
              setPathSource(e.target.value.trim() ? 'user' : 'ai')
            }}
          />
          <button className={`btn btn-ghost ${isListItem ? 'on' : ''}`} title="Liste öğesi (işaretlenebilir)" onClick={() => setIsListItem(!isListItem)}>
            <ListChecks size={14} />
          </button>
          <button className={`btn btn-ghost ${showReminder ? 'on' : ''}`} title="Hatırlatma ekle" onClick={() => setShowReminder(!showReminder)}>
            <Clock size={14} />
          </button>
          <button className="btn btn-ghost" title="Görsel ekle" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={14} />
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || (!text.trim() && !images.length) || !effectivePath.trim()}>
            <Plus size={14} /> Ekle
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(imageFilesFrom(e.target.files))
              e.target.value = ''
            }}
          />
        </div>

        {suggestions.length > 0 && (
          <div className="suggestions">
            <Sparkles size={12} className="c-accent" />
            {suggestions.map((sg) => {
              const label = sg.path.join(' / ')
              return (
                <button
                  key={label}
                  className={`chip ${label === effectivePath ? 'on' : ''}`}
                  onClick={() => {
                    setPath(label)
                    setPathSource('user')
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        )}

        {showReminder && (
          <div className="composer-row">
            <Clock size={13} className="c-reminder" />
            <input type="datetime-local" value={reminder} onChange={(e) => setReminder(e.target.value)} />
          </div>
        )}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}
