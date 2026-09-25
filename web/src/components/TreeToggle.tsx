import { ChevronDown, ChevronRight, FolderTree } from 'lucide-react'

/**
 * Phones only (CSS decides): folds the folder list away and says what is
 * selected, so the notes start near the top of the screen instead of below a
 * full tree.
 */
export default function TreeToggle({ open, label, count, onToggle }: { open: boolean; label: string; count?: number; onToggle: () => void }) {
  return (
    <button className="tree-toggle" onClick={onToggle} aria-expanded={open}>
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      <FolderTree size={14} />
      <span className="ellipsis">{label}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  )
}
