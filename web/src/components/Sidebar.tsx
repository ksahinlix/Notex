import { useState } from 'react'
import { ChevronDown, ChevronRight, Lock, LockOpen } from 'lucide-react'
import { pathKeyOf, pathStartsWith, type TreeNode } from '../lib/tree'
import type { ProtectedFolder } from '../lib/types'

interface Props {
  tree: TreeNode
  selectedPath: string[] | null
  folders: ProtectedFolder[]
  keys: Record<string, CryptoKey>
  onSelect: (path: string[] | null) => void
  onLockClick: (path: string[]) => void
  onDropNote: (noteId: string, path: string[]) => void
}

export default function Sidebar({ tree, selectedPath, onSelect, ...rest }: Props) {
  const names = Object.keys(tree.children)
  return (
    <nav className="sidebar card">
      <div className={`tree-row tree-all ${!selectedPath ? 'selected' : ''}`} onClick={() => onSelect(null)}>
        Tümü <span className="count">{tree.count}</span>
      </div>
      {names.length === 0 ? (
        <div className="muted" style={{ padding: '6px 8px' }}>Henüz kategori yok</div>
      ) : (
        names.map((name) => (
          <Node key={name} name={name} node={tree.children[name]} path={[name]} depth={0} selectedPath={selectedPath} onSelect={onSelect} {...rest} />
        ))
      )}
    </nav>
  )
}

function Node(props: Omit<Props, 'tree'> & { name: string; node: TreeNode; path: string[]; depth: number }) {
  const { name, node, path, depth, selectedPath, folders, keys, onSelect, onLockClick, onDropNote } = props
  const [open, setOpen] = useState(depth < 1)
  const [dragOver, setDragOver] = useState(false)
  const children = Object.keys(node.children)
  const pk = pathKeyOf(path)
  const isProtected = folders.some((f) => f.pathKey === pk)
  const isUnlocked = isProtected && !!keys[pk]
  const isLocked = isProtected && !isUnlocked
  const isSelected = !!selectedPath && pathKeyOf(selectedPath) === pk
  const expanded = !isLocked && (open || (!!selectedPath && selectedPath.length > path.length && pathStartsWith(selectedPath, path)))

  return (
    <div>
      <div
        className={`tree-row ${isSelected ? 'selected' : ''} ${dragOver ? 'drag-over' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const id = e.dataTransfer.getData('text/notex-note')
          if (id) onDropNote(id, path)
        }}
      >
        <span
          className="tree-label"
          onClick={() => {
            if (isLocked) return onLockClick(path)
            onSelect(path)
            if (children.length) setOpen((o) => (isSelected ? !o : true))
          }}
        >
          {isLocked ? <Lock size={11} className="c-reminder" /> : children.length ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span style={{ width: 12 }} />}
          <span className="ellipsis">{name}</span>
        </span>
        <button
          className={`icon-btn ${isProtected ? '' : 'hover-only'}`}
          title={isProtected ? (isUnlocked ? 'Kilitle' : 'Kilidi aç') : 'Bu klasörü şifreyle koru'}
          onClick={() => onLockClick(path)}
          style={{ color: isProtected ? (isUnlocked ? 'var(--ok)' : 'var(--reminder)') : undefined }}
        >
          {isUnlocked ? <LockOpen size={12} /> : <Lock size={12} />}
        </button>
        {!isLocked && <span className="count">{node.count}</span>}
      </div>
      {expanded &&
        children.map((c) => <Node key={c} {...props} name={c} node={node.children[c]} path={[...path, c]} depth={depth + 1} />)}
    </div>
  )
}
