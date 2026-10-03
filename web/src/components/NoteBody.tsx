import { listNumbers } from '../lib/blocks'
import { highlightParts } from '../lib/highlight'
import type { Block, Note, NoteContent, Span } from '../lib/types'

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
  const blocks: Block[] = note.isListItem
    ? [{ type: 'text' as const, content: c.listItemText || c.text }]
    : c.blocks?.length
      ? c.blocks
      : [{ type: 'text' as const, content: c.text }]

  const numbers = listNumbers(blocks)
  return (
    <div className={`note-body ${note.checked ? 'done' : ''} ${className}`}>
      {blocks.map((b, i) => {
        if (b.type === 'image') {
          return <img key={i} src={b.src} alt={b.alt ?? ''} className="note-img" onClick={() => onImageClick?.(b.src)} />
        }
        const body = <Formatted block={b} terms={terms} />
        if (b.style) {
          const Tag = b.style === 'h1' ? 'h3' : b.style === 'h2' ? 'h4' : 'h5'
          // Heading *levels* are the note's, not the page's: the card already
          // sits under the page title, so these start at <h3>.
          return (
            <Tag key={i} className={`nb-head nb-${b.style}`}>
              {body}
            </Tag>
          )
        }
        if (b.list) {
          return (
            <div key={i} className="nb-item">
              <span className="nb-marker" aria-hidden="true">{b.list === 'number' ? `${numbers[i]}.` : '•'}</span>
              <span className="pre">{body}</span>
            </div>
          )
        }
        return (
          <span key={i} className="pre">
            {body}
          </span>
        )
      })}
    </div>
  )
}

/**
 * One block's text, with its bold/italic runs. While searching, the plain text
 * is shown instead: highlighting across runs would mean splitting them, and
 * seeing what matched matters more there than seeing what was bold.
 */
function Formatted({ block, terms }: { block: Extract<Block, { type: 'text' }>; terms: string[] }) {
  if (!block.spans?.length || terms.length) return <Highlighted text={block.content} terms={terms} />
  return (
    <>
      {block.spans.map((s, i) => (
        <Marked key={i} span={s} />
      ))}
    </>
  )
}

function Marked({ span }: { span: Span }) {
  let node = <>{span.text}</>
  if (span.marks?.includes('i')) node = <em>{node}</em>
  if (span.marks?.includes('b')) node = <strong>{node}</strong>
  return node
}

export function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightParts(text, terms).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text))}
    </>
  )
}
