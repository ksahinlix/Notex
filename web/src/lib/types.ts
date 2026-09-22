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
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export interface ProtectedFolder {
  /** Path joined with "/", e.g. "Personal/Diary". */
  pathKey: string
  salt: string
  iterations: number
  /** A known value encrypted with the folder key; used to check the password. */
  checkCipher: string
}
