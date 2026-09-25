import { Lock } from 'lucide-react'

interface Props {
  /** The locked folder. */
  path: string[]
  /** How many of the listed notes are in it. */
  count: number
  /** In search results: these notes were skipped, not just hidden. */
  searching?: boolean
  onUnlock: () => void
}

/**
 * One card per locked folder, instead of one grey row per note: says which
 * folder, how many notes, and that tapping opens it.
 */
export default function LockedCard({ path, count, searching, onUnlock }: Props) {
  return (
    <button className="locked-card" onClick={onUnlock}>
      <span className="locked-icon"><Lock size={18} /></span>
      <span className="locked-text">
        <span className="locked-title ellipsis">{path.join(' › ')}</span>
        <span className="locked-sub">
          {searching ? `${count} kilitli not aranmadı. Kilidi açınca onlarda da aranır.` : `${count} kilitli not · açmak için dokun`}
        </span>
      </span>
      <span className="btn btn-primary locked-cta">Kilidi aç</span>
    </button>
  )
}
