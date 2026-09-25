import { ChevronDown, FolderClosed } from 'lucide-react'

/**
 * Phones only (CSS decides): says which folder is open and opens the folder
 * list, so the notes start near the top of the screen instead of below a
 * full tree.
 */
export default function TreeToggle({ open, label, count, onToggle }: { open: boolean; label: string; count?: number; onToggle: () => void }) {
  return (
    <button className="tree-toggle" onClick={onToggle} aria-expanded={open}>
      <FolderClosed size={18} />
      <span className="ellipsis">{label}</span>
      {count !== undefined && <span className="count">{count}</span>}
      <ChevronDown size={18} />
    </button>
  )
}
