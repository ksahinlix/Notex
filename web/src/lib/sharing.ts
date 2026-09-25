// Shared folders (D18), the browser's half.
//
// A note now carries `ownerId`: yours, or the owner of a folder somebody
// shared with you. Your own tree is built from your own notes only; shared
// folders are shown apart, under "Paylaşılan", because you may both have an
// "Alışveriş" and merging them would be a lie.

import type { Note, Person, Share } from './types'
import { pathStartsWith } from './tree'

/** One shared folder as it appears in the sidebar. */
export interface SharedFolder {
  share: Share
  /** The folder's path inside the owner's tree. */
  path: string[]
  ownerId: string
  /** "Kaan" (or the e-mail, before they have a name). */
  ownerName: string
  notes: Note[]
}

export const accepted = (shares: Share[]) => shares.filter((s) => s.status === 'accepted')
export const pending = (shares: Share[]) => shares.filter((s) => s.status === 'pending')

export const personName = (p: { name: string | null; email: string } | undefined) => p?.name || p?.email?.split('@')[0] || 'Biri'

/** Your own notes: the ones nobody shared with you. */
export function ownNotes(notes: Note[], userId: string | null): Note[] {
  return notes.filter((n) => !n.ownerId || !userId || n.ownerId === userId)
}

/** The folders shared with you, each with the notes inside it. */
export function sharedFolders(notes: Note[], withMe: Share[]): SharedFolder[] {
  return accepted(withMe)
    .filter((s) => s.owner)
    .map((s) => ({
      share: s,
      path: s.path,
      ownerId: s.owner!.id ?? '',
      ownerName: personName(s.owner),
      notes: notes.filter((n) => n.ownerId === s.owner!.id && pathStartsWith(n.path, s.path)),
    }))
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName, 'tr') || a.path.join('/').localeCompare(b.path.join('/'), 'tr'))
}

/** The share a note belongs to, if it is in a folder shared with you. */
export function shareOf(note: Note, withMe: Share[], userId: string | null): Share | null {
  if (!note.ownerId || note.ownerId === userId) return null
  return accepted(withMe).find((s) => s.owner?.id === note.ownerId && pathStartsWith(note.path, s.path)) ?? null
}

/** Whose folder a new note written at `path` goes to: null = your own. */
export function ownerForNewNote(path: string[], withMe: Share[], target?: { ownerId: string; path: string[] }): string | null {
  if (!target) return null
  const share = accepted(withMe).find((s) => s.owner?.id === target.ownerId && pathStartsWith(path, s.path))
  return share ? target.ownerId : null
}

/** People who can see a folder of yours (its own share plus any parent's). */
export function sharesForPath(mine: Share[], path: string[]): Share[] {
  return mine.filter((s) => pathStartsWith(path, s.path))
}

/** The folder is shared, or sits inside a shared one, so it cannot be locked. */
export const isSharedPath = (mine: Share[], path: string[]) =>
  mine.some((s) => pathStartsWith(path, s.path) || pathStartsWith(s.path, path))

const INVITE = '/davet/'

export const inviteLink = (token: string) => `${location.origin}${INVITE}${token}`

/** The token in /davet/<token>, or null. Also accepts it as a #davet=… hash. */
export function inviteTokenFrom(url: { pathname: string; hash: string }): string | null {
  if (url.pathname.startsWith(INVITE)) return decodeURIComponent(url.pathname.slice(INVITE.length)).replace(/\/+$/, '') || null
  const m = /^#davet=(.+)$/.exec(url.hash)
  return m ? decodeURIComponent(m[1]) : null
}

/** "Ayşe", "Ayşe ve Irmak", "Ayşe, Irmak ve Mehmet". */
export function nameList(names: string[]): string {
  if (names.length < 2) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} ve ${names[names.length - 1]}`
}

/** Turkish summary of who a folder is shared with, for the sidebar tooltip. */
/**
 * One share per person. A note in a shared subfolder matches that folder's
 * share *and* its parent's, so the same person would otherwise be drawn and
 * named twice; an accepted share wins over an invitation still waiting.
 */
export function byPerson(shares: Share[]): Share[] {
  const best = new Map<string, Share>()
  for (const s of shares) {
    const key = s.invitedEmail.trim().toLowerCase()
    const had = best.get(key)
    if (!had || (had.status !== 'accepted' && s.status === 'accepted')) best.set(key, s)
  }
  return [...best.values()]
}

export function shareSummary(shares: Share[]): string {
  const people = byPerson(shares)
  if (!people.length) return ''
  const names = nameList(people.map((s) => personName(s.person ?? { name: null, email: s.invitedEmail })))
  const waiting = people.filter((s) => s.status === 'pending').length
  return `${names} ile paylaşıldı${waiting ? ` · ${waiting} davet bekliyor` : ''}`
}

/**
 * Why a note carries the shared mark, as the tooltip text — who it is shared
 * with, or whose folder it came from. null when it is nobody's business but
 * yours.
 */
export function shareMark(note: Note, mine: Share[], withMe: Share[], userId: string | null): string | null {
  const from = shareOf(note, withMe, userId)
  if (from) return `${personName(from.owner)} paylaştı`
  const here = sharesForPath(mine, note.path)
  return here.length ? shareSummary(here) : null
}

/** "Kaan Berk Şahinli" -> "KB", "ayse@example.com" -> "A". Google's own style. */
export function initials(person: { name?: string | null; email?: string }): string {
  const name = (person.name ?? '').trim()
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean).slice(0, 2)
    return parts.map((w) => w[0]).join('').toLocaleUpperCase('tr')
  }
  return (person.email ?? '?').trim()[0]?.toLocaleUpperCase('tr') ?? '?'
}

/** A steady colour per person, so the same face keeps the same circle. */
export function personColor(key: string): number {
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

export interface SharePeople {
  /** Who to show: the owner of a folder shared with you, or the people you shared with. */
  people: Person[]
  /** The sentence behind the faces. */
  label: string
  /** True when the folder is somebody else's. */
  theirs: boolean
}

/** The faces to draw on a note, or null when nobody else can see it. */
export function sharePeople(note: Note, mine: Share[], withMe: Share[], userId: string | null): SharePeople | null {
  const from = shareOf(note, withMe, userId)
  if (from?.owner) return { people: [from.owner], label: `${personName(from.owner)} paylaştı`, theirs: true }
  const here = byPerson(sharesForPath(mine, note.path))
  if (!here.length) return null
  const people = here.map((sh) => sh.person ?? { id: null, name: null, email: sh.invitedEmail, picture: null })
  return { people, label: shareSummary(here), theirs: false }
}
