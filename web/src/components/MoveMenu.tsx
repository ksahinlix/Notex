import { useEffect, useRef, useState } from 'react'
import { FolderInput } from 'lucide-react'
import { parsePath } from '../lib/tree'

interface Props {
  current: string[]
  /** All folder paths, "A / B / C". */
  paths: string[]
  onMove: (path: string[]) => void
  onClose: () => void
}

// "Taşı" popover: pick a folder from the list (filterable) or type a new
// path. Works everywhere, including touch screens where dragging doesn't.
export default function MoveMenu({ current, paths, onMove, onClose }: Props) {
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const currentKey = current.join(' / ')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const needle = q.trim().toLocaleLowerCase('tr')
  const matches = paths.filter((p) => p !== currentKey && (!needle || p.toLocaleLowerCase('tr').includes(needle)))
  const typed = parsePath(q)
  const typedIsNew = typed.length > 0 && !paths.includes(typed.join(' / '))

  return (
    <div className="move-menu card" ref={ref} role="dialog" aria-label="Notu taşı">
      <div className="move-title"><FolderInput size={13} /> Taşı: <span className="muted">{currentKey}</span></div>
      <input
        autoFocus
        placeholder="Klasör ara ya da yeni yol yaz (A / B)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          if (matches.length && !typedIsNew) onMove(parsePath(matches[0]))
          else if (typed.length) onMove(typed)
        }}
      />
      <div className="move-list">
        {typedIsNew && (
          <button className="move-item new" onClick={() => onMove(typed)}>
            + Yeni klasör: <b>{typed.join(' / ')}</b>
          </button>
        )}
        {matches.map((p) => (
          <button key={p} className="move-item" onClick={() => onMove(parsePath(p))}>{p}</button>
        ))}
        {!matches.length && !typedIsNew && <div className="muted small" style={{ padding: 6 }}>Klasör bulunamadı</div>}
      </div>
    </div>
  )
}
