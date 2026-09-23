import { highlightParts } from '../lib/highlight'
import type { Note, NoteContent } from '../lib/types'

interface Props {
  note: Note
  content: NoteContent
  /** Search words to highlight (already lower-cased, see queryTerms). */
  terms?: string[]
  onImageClick?: (src: string) => void
  className?: string
}

/** A note's text and images, with search words highlighted. Used by the card and the reader. */
export default function NoteBody({ note, content: c, terms = [], onImageClick, className = '' }: Props) {
  const blocks = note.isListItem
    ? [{ type: 'text' as const, content: c.listItemText || c.text }]
    : c.blocks?.length
      ? c.blocks
      : [{ type: 'text' as const, content: c.text }]
  return (
    <div className={`note-body ${note.checked ? 'done' : ''} ${className}`}>
      {blocks.map((b, i) =>
        b.type === 'image' ? (
          <img key={i} src={b.src} alt={b.alt ?? ''} className="note-img" onClick={() => onImageClick?.(b.src)} />
        ) : (
          <span key={i} className="pre">
            <Highlighted text={b.content} terms={terms} />
          </span>
        ),
      )}
    </div>
  )
}

export function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightParts(text, terms).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text))}
    </>
  )
}
