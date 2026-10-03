// Flags on notes (D26).
//
// A fixed set rather than free labels: nothing to invent, nothing to tidy up
// later, and each one can have its own colour and a row in the sidebar. They
// live beside `checked` and `reminderAt` in plaintext, so a note in a locked
// folder can still be marked and filtered without unlocking it — a flag is
// one of four known words, not the note's content (D8).

import type { Note } from './types'

export type Flag = 'onemli' | 'acil' | 'beklemede' | 'fikir'

export interface FlagInfo {
  id: Flag
  label: string
  /** Hue for the chip; the theme decides how light or dark it is. */
  hue: number
}

/** "Bitti" is deliberately not here: it would mean two things at once next to
 *  a to-do folder's tick box (D22). */
export const FLAGS: FlagInfo[] = [
  { id: 'onemli', label: 'Önemli', hue: 4 },
  { id: 'acil', label: 'Acil', hue: 28 },
  { id: 'beklemede', label: 'Beklemede', hue: 212 },
  { id: 'fikir', label: 'Fikir', hue: 265 },
]

const BY_ID = new Map(FLAGS.map((f) => [f.id, f]))

export const flagInfo = (id: string): FlagInfo | undefined => BY_ID.get(id as Flag)

/** Only the flags we know about, in the order they are listed above. */
export function flagsOf(note: Pick<Note, 'flags'>): FlagInfo[] {
  const on = new Set(note.flags ?? [])
  return FLAGS.filter((f) => on.has(f.id))
}

export const hasFlag = (note: Pick<Note, 'flags'>, id: Flag) => (note.flags ?? []).includes(id)

/** The note's flags with `id` switched on or off, kept in the listed order. */
export function toggleFlag(note: Pick<Note, 'flags'>, id: Flag): Flag[] {
  const on = new Set((note.flags ?? []) as Flag[])
  if (on.has(id)) on.delete(id)
  else on.add(id)
  return FLAGS.filter((f) => on.has(f.id)).map((f) => f.id)
}

/** How many of the given notes carry each flag, for the sidebar. */
export function flagCounts(notes: Pick<Note, 'flags'>[]): Record<Flag, number> {
  const counts = { onemli: 0, acil: 0, beklemede: 0, fikir: 0 }
  for (const n of notes) for (const f of n.flags ?? []) if (f in counts) counts[f as Flag]++
  return counts
}
