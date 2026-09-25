import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FolderInput, Lock, LockOpen, MoreHorizontal, Pencil, Plus, Users } from 'lucide-react'
import { pathKeyOf, pathStartsWith, type TreeNode } from '../lib/tree'
import { sharesForPath, shareSummary } from '../lib/sharing'
import type { ProtectedFolder, Share } from '../lib/types'
import { focusComposer } from '../state/composer'
import ShareModal from './ShareModal'
import MoveMenu from './MoveMenu'

const NOTE_TYPE = 'text/notex-note'
const FOLDER_TYPE = 'text/notex-folder'

interface Props {
  tree: TreeNode
  selectedPath: string[] | null
  folders: ProtectedFolder[]
  keys: Record<string, CryptoKey>
  /** Folders you share with someone, for the badge and the Paylaş dialog (D18). */
  shares: Share[]
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
        Tüm notlar <span className="count">{tree.count}</span>
      </div>
      {names.length === 0 ? (
        <div className="muted" style={{ padding: '6px 10px' }}>Henüz klasör yok. İlk notunu yazınca AI oluşturur.</div>
      ) : (
        names.map((name) => (
          <Node key={name} name={name} node={tree.children[name]} path={[name]} depth={0} selectedPath={selectedPath} onSelect={onSelect} {...rest} />
        ))
      )}
    </nav>
  )
}

function Node(props: Omit<Props, 'tree'> & { name: string; node: TreeNode; path: string[]; depth: number }) {
  const { name, node, path, depth, selectedPath, folders, keys, shares, folderPaths, onSelect, onLockClick, onDropNote, onMoveFolder, onRenameFolder } = props
  const [open, setOpen] = useState(depth < 1)
  const [menu, setMenu] = useState<null | 'menu' | 'move' | 'rename' | 'share'>(null)
  const shared = sharesForPath(shares, path)
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

  // The menu closes on a click outside or Esc. Mouse-leave alone isn't
  // enough: on a touch screen there is no hover, so it would never close.
  const nodeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu || menu === 'share') return
    const outside = (e: PointerEvent) => {
      if (!nodeRef.current?.contains(e.target as Node)) setMenu(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', esc)
    }
  }, [menu])

  // Where this folder may move: not into itself or its own subfolders.
  const targets = folderPaths.filter((p) => {
    const parts = p.split(' / ')
    return !pathStartsWith(parts, path) && pathKeyOf(parts) !== pathKeyOf(path.slice(0, -1))
  })

  return (
    <div ref={nodeRef}>
      <div
        className={`tree-row ${isSelected ? 'selected' : ''} ${drop.over ? 'drag-over' : ''}`}
        style={{ paddingLeft: 6 + depth * 18 }}
        {...drop.handlers}
      >
        {menu === 'rename' ? (
          <input
            className="rename-input"
            autoFocus
            value={newName}
            aria-label="Klasörün yeni adı"
            onFocus={(e) => e.target.select()}
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
            {!isLocked && children.length ? (expanded ? <ChevronDown size={16} className="c-muted" /> : <ChevronRight size={16} className="c-muted" />) : <span style={{ width: 16, flex: 'none' }} />}
            <span className="ellipsis">{name}</span>
            {shared.length > 0 && <Users size={13} className="shared-badge" aria-label="paylaşılıyor" />}
          </span>
        )}
        {menu !== 'rename' && (
          <button className="icon-btn" title="Klasör işlemleri" aria-label={`${name} klasörü işlemleri`} aria-expanded={menu === 'menu'} onClick={() => setMenu(menu ? null : 'menu')}>
            <MoreHorizontal size={16} />
          </button>
        )}
        {isLocked ? (
          <button className="lock-pill link" title="Kilidi aç" onClick={() => onLockClick(path)}>
            <Lock size={12} /> Kilitli
          </button>
        ) : (
          <>
            {isUnlocked && (
              <button className="icon-btn" title="Kilitle" aria-label="Kilitle" onClick={() => onLockClick(path)} style={{ color: 'var(--ok)' }}>
                <LockOpen size={15} />
              </button>
            )}
            <span className="count">{node.count}</span>
          </>
        )}
      </div>

      {menu === 'menu' && (
        <div className="folder-menu card" onMouseLeave={() => setMenu(null)}>
          <button
            onClick={() => {
              setMenu(null)
              onSelect(path) // the composer takes its folder from the selection
              focusComposer()
            }}
          >
            <Plus size={12} /> Bu klasöre not ekle
          </button>
          <button
            onClick={() => {
              setNewName(name)
              setMenu('rename')
            }}
          >
            <Pencil size={12} /> Yeniden adlandır
          </button>
          <button onClick={() => setMenu('move')}><FolderInput size={12} /> Taşı…</button>
          <button
            onClick={() => {
              setMenu(null)
              onLockClick(path)
            }}
          >
            {isUnlocked ? <Lock size={12} /> : isProtected ? <LockOpen size={12} /> : <Lock size={12} />}
            {isUnlocked ? 'Kilitle' : isProtected ? 'Kilidi aç' : 'Şifreyle koru…'}
          </button>
          <button
            onClick={() => setMenu(isProtected ? null : 'share')}
            disabled={isProtected}
            title={isProtected ? 'Şifreli klasörler paylaşılamaz' : shareSummary(shared)}
          >
            <Users size={12} /> Paylaş…
          </button>
        </div>
      )}
      {menu === 'share' && <ShareModal path={path} shares={shares} onClose={() => setMenu(null)} />}
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
