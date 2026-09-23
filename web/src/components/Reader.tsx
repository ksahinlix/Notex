import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Clock, Minus, Plus, X } from 'lucide-react'
import { formatDate } from '../lib/format'
import type { Note, NoteContent } from '../lib/types'
import NoteBody from './NoteBody'

interface Props {
  note: Note
  content: NoteContent
  terms?: string[]
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onImageClick: (src: string) => void
}

const SIZES = [16, 18, 20, 22, 25, 28]
const SIZE_KEY = 'notex-reader-size'

function readSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY))
    return SIZES.includes(n) ? n : 20
  } catch {
    return 20
  }
}

// Full-screen reading mode (like Word's): the note gets a wide, centered
// column with large text; everything else steps aside. Esc closes, ← → move
// between notes, A−/A+ change the text size (remembered in this browser).
export default function Reader({ note, content, terms, hasPrev, hasNext, onPrev, onNext, onClose, onImageClick }: Props) {
  const [size, setSize] = useState(readSize)

  useEffect(() => {
    try {
      localStorage.setItem(SIZE_KEY, String(size))
    } catch {
      /* private mode */
    }
  }, [size])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && hasPrev) onPrev()
      else if (e.key === 'ArrowRight' && hasNext) onNext()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden' // the page behind must not scroll
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, onPrev, onNext, hasPrev, hasNext])

  const step = (d: number) => setSize((s) => SIZES[Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(s) + d))])

  return (
    <div className="reader" role="dialog" aria-modal="true" aria-label="Okuma modu">
      <div className="reader-bar">
        <span className="reader-path">{note.path.join(' / ')}</span>
        <div className="reader-tools">
          <button className="icon-btn" title="Önceki not (←)" disabled={!hasPrev} onClick={onPrev}><ChevronLeft size={16} /></button>
          <button className="icon-btn" title="Sonraki not (→)" disabled={!hasNext} onClick={onNext}><ChevronRight size={16} /></button>
          <span className="reader-sep" />
          <button className="icon-btn" title="Yazıyı küçült" onClick={() => step(-1)}><Minus size={14} /></button>
          <span className="reader-size">A</span>
          <button className="icon-btn" title="Yazıyı büyüt" onClick={() => step(1)}><Plus size={14} /></button>
          <span className="reader-sep" />
          <button className="icon-btn" title="Kapat (Esc)" onClick={onClose}><X size={18} /></button>
        </div>
      </div>
      <div className="reader-scroll" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <article className="reader-page" style={{ fontSize: size }}>
          <div className="reader-meta">
            {formatDate(note.createdAt)}
            {note.reminderAt && <span className="c-reminder"><Clock size={12} /> {formatDate(note.reminderAt)}</span>}
          </div>
          <NoteBody note={note} content={content} terms={terms} onImageClick={onImageClick} className="reader-body" />
          {!!content.comments?.length && (
            <div className="reader-comments">
              {content.comments.map((cm) => (
                <div key={cm.id} className="reader-comment">
                  <div className="muted small">{formatDate(cm.createdAt)}</div>
                  <div className="pre">{cm.text}</div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </div>
  )
}
