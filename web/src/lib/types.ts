// Shared data model. Mirrors the server's API shape (server/src/routes/*.js).

/** Bold and italic, the only inline formatting kept (D27). */
export type Mark = 'b' | 'i'
/** A run of text inside a block that shares the same marks. */
export interface Span {
  text: string
  marks?: Mark[]
}
export type BlockStyle = 'h1' | 'h2' | 'h3'
export type ListKind = 'bullet' | 'number'

export type Block =
  | {
      type: 'text'
      /**
       * The block's plain text, always. Search, the AI classifier and the
       * reminder parser read this, so formatting is only ever extra (D27).
       */
      content: string
      /** A heading rather than a paragraph. */
      style?: BlockStyle
      /** One item of a list. The marker is drawn, not stored in `content`. */
      list?: ListKind
      /** Bold/italic runs. Absent means the whole block is plain. */
      spans?: Span[]
    }
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
  /** Markers from a fixed set (D26): 'onemli', 'acil', 'beklemede', 'fikir'. */
  flags?: string[]
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

/** A folder whose notes can be ticked off (D22). */
export interface TodoFolder {
  /** Whose folder it is: you, or the owner of a folder shared with you. */
  ownerId: string
  /** Path joined with "/", e.g. "Ev/Alışveriş". */
  pathKey: string
}

export interface ProtectedFolder {
  /** Path joined with "/", e.g. "Personal/Diary". */
  pathKey: string
  salt: string
  iterations: number
  /** A known value encrypted with the folder key; used to check the password. */
  checkCipher: string
}
