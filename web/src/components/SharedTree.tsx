import { useState } from 'react'
import { ChevronDown, ChevronRight, LogOut, Users } from 'lucide-react'
import { confirmDialog } from '../state/confirm'
import { showToast } from '../state/toast'
import { store } from '../state/store'
import type { SharedFolder } from '../lib/sharing'

interface Props {
  folders: SharedFolder[]
  selected: { ownerId: string; path: string[] } | null
  onSelect: (pick: { ownerId: string; path: string[] } | null) => void
}

/**
 * Folders other people share with you (D18), kept apart from your own tree:
 * you may both have an "Alışveriş", and merging them would hide whose is
 * whose. Each row says who it belongs to.
 */
export default function SharedTree({ folders, selected, onSelect }: Props) {
  const [open, setOpen] = useState(true)
  if (!folders.length) return null
  return (
    <div className="shared-tree" data-tour="shared">
      <button className="shared-head" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Users size={12} /> Paylaşılan
      </button>
      {open &&
        folders.map((f) => {
          const isSelected = selected?.ownerId === f.ownerId && selected.path.join('/') === f.path.join('/')
          return (
            <div key={f.share.id} className={`tree-row shared-row ${isSelected ? 'selected' : ''}`}>
              <span className="tree-label" onClick={() => onSelect(isSelected ? null : { ownerId: f.ownerId, path: f.path })}>
                <span className="ellipsis">
                  <span className="shared-owner">{f.ownerName}</span> · {f.path[f.path.length - 1]}
                </span>
              </span>
              <button
                className="icon-btn hover-only"
                title="Paylaşımdan ayrıl"
                aria-label="Paylaşımdan ayrıl"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: 'Paylaşımdan ayrılasın mı?',
                    message: `“${f.path.join(' / ')}” klasörü artık sende görünmeyecek. ${f.ownerName} seni yeniden davet edebilir.`,
                    confirmLabel: 'Ayrıl',
                    danger: true,
                  })
                  if (!ok) return
                  if (isSelected) onSelect(null)
                  if (await store.unshare(f.share.id)) showToast({ message: 'Paylaşımdan ayrıldın.' })
                }}
              >
                <LogOut size={12} />
              </button>
              <span className="count">{f.notes.length}</span>
            </div>
          )
        })}
    </div>
  )
}
