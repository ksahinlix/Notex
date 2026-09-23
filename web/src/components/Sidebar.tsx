import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FolderInput, Lock, LockOpen, MoreHorizontal, Pencil } from 'lucide-react'
import { pathKeyOf, pathStartsWith, type TreeNode } from '../lib/tree'
import type { ProtectedFolder } from '../lib/types'
import MoveMenu from './MoveMenu'

const NOTE_TYPE = 'text/notex-note'
const FOLDER_TYPE = 'text/notex-folder'

interface Props {
  tree: TreeNode
  selectedPath: string[] | null
  folders: ProtectedFolder[]
  keys: Record<string, CryptoKey>
  /** All folder paths "A / B", for the folder "Taşı" menu. */
  folderPaths: string[]
  onSelect: (path: string[] | null) => void
  onLockClick: (path: string[]) => void
  onDropNote: (noteId: string, path: string[]) => void
  /** Move a folder into `parent` (null = top level). */
  onMoveFolder: (folder: string[], parent: string[] | null) => void
  onRenameFolder: (folder: string[], name: string) => void
}

type DropHandlers = Pick<React.HTMLAttributes<HTMLDivElement>, 'onDragOver' | 'onDragEnter' | 'onDragLeave' | 'onDrop'>

/**
 * Drop target behaviour shared by folder rows and "Tümü": accepts notes and
 * folders. dragenter/dragleave also fire over a row's own children, so they
 * are counted instead of toggled (no flicker).
 */
function useDropTarget(onNote: ((id: string) => void) | null, onFolder: (key: string) => void, onLongHover?: () => void) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(FOLDER_TYPE) || (!!onNote && e.dataTransfer.types.includes(NOTE_TYPE))
  const end = () => {
    depth.current = 0
    setOver(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const handlers: DropHandlers = {
    onDragOver: (e) => {
      if (!accepts(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    },
    onDragEnter: (e) => {
      if (!accepts(e)) return
      e.preventDefault()
      if (depth.current++ === 0) {
        setOver(true)
        if (onLongHover) timer.current = setTimeout(onLongHover, 600)
      }
    },
    onDragLeave: () => {
      if (--depth.current <= 0) end()
    },
    onDrop: (e) => {
      e.preventDefault()
      end()
      document.body.classList.remove('dragging-note') // the dragged item may unmount before its dragend
      const folder = e.dataTransfer.getData(FOLDER_TYPE)
      const note = e.dataTransfer.getData(NOTE_TYPE)
      if (folder) onFolder(folder)
      else if (note && onNote) onNote(note)
    },
  }
  return { over, handlers }
}

export default function Sidebar({ tree, selectedPath, onSelect, ...rest }: Props) {
  const names = Object.keys(tree.children)
  // Dropping a folder on "Tümü" moves it to the top level.
  const root = useDropTarget(null, (key) => rest.onMoveFolder(key.split('/'), null))
  return (
    <nav className="sidebar card">
      <div className={`tree-row tree-all ${!selectedPath ? 'selected' : ''} ${root.over ? 'drag-over' : ''}`} onClick={() => onSelect(null)} {...root.handlers}>
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
  const { name, node, path, depth, selectedPath, folders, keys, folderPaths, onSelect, onLockClick, onDropNote, onMoveFolder, onRenameFolder } = props
  const [open, setOpen] = useState(depth < 1)
  const [menu, setMenu] = useState<null | 'menu' | 'move' | 'rename'>(null)
  const [newName, setNewName] = useState(name)
  const children = Object.keys(node.children)
  const pk = pathKeyOf(path)
  const isProtected = folders.some((f) => f.pathKey === pk)
  const isUnlocked = isProtected && !!keys[pk]
  const isLocked = isProtected && !isUnlocked
  const isSelected = !!selectedPath && pathKeyOf(selectedPath) === pk
  const expanded = !isLocked && (open || (!!selectedPath && selectedPath.length > path.length && pathStartsWith(selectedPath, path)))

  const drop = useDropTarget(
    (noteId) => onDropNote(noteId, path),
    (key) => {
      if (key !== pk) onMoveFolder(key.split('/'), path)
    },
    // hovering a collapsed folder opens it, so its subfolders become targets
    () => children.length && setOpen(true),
  )

  function submitRename() {
    const n = newName.trim()
    setMenu(null)
    if (n && n !== name) onRenameFolder(path, n)
  }

  // Where this folder may move: not into itself or its own subfolders.
  const targets = folderPaths.filter((p) => {
    const parts = p.split(' / ')
    return !pathStartsWith(parts, path) && pathKeyOf(parts) !== pathKeyOf(path.slice(0, -1))
  })

  return (
    <div>
      <div
        className={`tree-row ${isSelected ? 'selected' : ''} ${drop.over ? 'drag-over' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        {...drop.handlers}
      >
        {menu === 'rename' ? (
          <input
            className="rename-input"
            autoFocus
            value={newName}
            aria-label="Klasörün yeni adı"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename()
              if (e.key === 'Escape') setMenu(null)
            }}
            onBlur={submitRename}
          />
        ) : (
          <span
            className="tree-label"
            draggable={!isLocked}
            title="Sürükleyerek başka bir klasörün içine taşı"
            onDragStart={(e) => {
              e.dataTransfer.setData(FOLDER_TYPE, pk)
              e.dataTransfer.effectAllowed = 'move'
              document.body.classList.add('dragging-note')
            }}
            onDragEnd={() => document.body.classList.remove('dragging-note')}
            onClick={() => {
              if (isLocked) return onLockClick(path)
              onSelect(path)
              if (children.length) setOpen((o) => (isSelected ? !o : true))
            }}
          >
            {isLocked ? <Lock size={11} className="c-reminder" /> : children.length ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span style={{ width: 12 }} />}
            <span className="ellipsis">{name}</span>
          </span>
        )}
        {menu !== 'rename' && (
          <button className="icon-btn hover-only" title="Klasör işlemleri" aria-label="Klasör işlemleri" onClick={() => setMenu(menu ? null : 'menu')}>
            <MoreHorizontal size={13} />
          </button>
        )}
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

      {menu === 'menu' && (
        <div className="folder-menu card" onMouseLeave={() => setMenu(null)}>
          <button
            onClick={() => {
              setNewName(name)
              setMenu('rename')
            }}
          >
            <Pencil size={12} /> Yeniden adlandır
          </button>
          <button onClick={() => setMenu('move')}><FolderInput size={12} /> Taşı…</button>
        </div>
      )}
      {menu === 'move' && (
        <div className="picker-anchor">
          <MoveMenu
            current={path}
            paths={targets}
            allowTop={path.length > 1}
            title="Klasörü taşı"
            onMove={(parent) => {
              setMenu(null)
              onMoveFolder(path, parent.length ? parent : null)
            }}
            onClose={() => setMenu(null)}
          />
        </div>
      )}

      {expanded &&
        children.map((c) => <Node key={c} {...props} name={c} node={node.children[c]} path={[...path, c]} depth={depth + 1} />)}
    </div>
  )
}
