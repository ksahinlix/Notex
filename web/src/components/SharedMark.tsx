import { Users } from 'lucide-react'
import { shareMark } from '../lib/sharing'
import type { Note } from '../lib/types'
import { useNotex } from '../state/store'

/**
 * The 👥 next to a note that other people can see. Hovering (or focusing it
 * with the keyboard) says who: the people you shared the folder with, or
 * whose folder it came from. Nothing is drawn for a private note.
 */
export default function SharedMark({ note }: { note: Note }) {
  const state = useNotex()
  const who = shareMark(note, state.shares, state.sharedWithMe, state.userId)
  if (!who) return null
  return (
    <span className="shared-mark" title={who} tabIndex={0} aria-label={who}>
      <Users size={11} />
    </span>
  )
}
