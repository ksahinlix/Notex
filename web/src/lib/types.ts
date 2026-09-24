// Shared data model. Mirrors the server's API shape (server/src/routes/*.js).

export type Block =
  | { type: 'text'; content: string }
  | { type: 'image'; src: string; alt?: string }

export interface Comment {
  id: string
  text: string
  createdAt: string
}

/** Everything that gets encrypted for notes inside a protected folder. */
export interface NoteContent {
  text: string
  listItemText?: string | null
  reminderLabel?: string | null
  blocks?: Block[]
  comments?: Comment[]
  /** When the text was last edited by hand (moves and reminder changes don't count). */
  editedAt?: string
}

export interface Note {
  id: string
  path: string[]
  encrypted: boolean
  /** Set for plain notes, null for encrypted ones. */
  content: NoteContent | null
  /** "ivB64:ciphertextB64" for encrypted notes, null otherwise. */
  cipher: string | null
  isListItem: boolean
  checked: boolean
  reminderAt: string | null
  /** A reminder, with a date (reminderAt) or without one. */
  isReminder?: boolean
  /** Repeating reminder: counted from reminderAt. */
  repeat?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null
  /** Repeating reminder: occurrences up to this time are done. */
  reminderDoneUntil?: string | null
  /** Who the note belongs to: the owner of the folder it lives in (D18). */
  ownerId?: string
  /** Who wrote it — different from ownerId in a folder someone shared with you. */
  authorId?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

/** A folder shared with someone (D18). */
export interface Share {
  id: string
  path: string[]
  invitedEmail: string
  status: 'pending' | 'accepted'
  token: string
  createdAt: string
  /** The invitee, once they have an account. */
  person: Person | null
  /** Set on shares made *with* you: whose folder it is. */
  owner?: Person
}

export interface Person {
  id: string | null
  name: string | null
  email: string
  picture: string | null
}

export interface ProtectedFolder {
  /** Path joined with "/", e.g. "Personal/Diary". */
  pathKey: string
  salt: string
  iterations: number
  /** A known value encrypted with the folder key; used to check the password. */
  checkCipher: string
}
