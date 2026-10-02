// Thin client for the Notex server API. Cookies carry the login session.

import type { Note, Person, ProtectedFolder, Share, TodoFolder } from './types'

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown) {
    super(`API error ${status}`)
    this.status = status
    this.body = body
  }
}

/** Fired when the login session has expired; App returns to the login screen. */
export const UNAUTHORIZED_EVENT = 'notex:unauthorized'

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method,
    signal,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { error: text.slice(0, 200) } // e.g. an HTML error page while Render wakes up
  }
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  if (!res.ok) throw new ApiError(res.status, data)
  return data as T
}

export const api = {
  health: () => request<{ ok: boolean; db: string; version?: string }>('GET', '/api/health'),

  me: () => request<{ authenticated: boolean; user?: User }>('GET', '/api/auth/me'),
  authConfig: () => request<{ googleClientId: string | null }>('GET', '/api/auth/config'),
  /** Signs in (or up) with the ID token from Google's button. */
  loginGoogle: (credential: string) => request<{ user: User }>('POST', '/api/auth/google', { credential }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),

  /** Without `since`: all live notes. With `since`: all changes after it, including deletions. */
  listNotes: (since?: string) =>
    request<{ notes: Note[]; trashCount?: number; serverTime: string }>('GET', since ? `/api/notes?since=${encodeURIComponent(since)}` : '/api/notes'),
  /** Create or replace. Rejects with status 409 if the server has a newer version. */
  saveNote: (note: Note) => request<Note>('PUT', `/api/notes/${encodeURIComponent(note.id)}`, note),
  /** Into the trash: the note keeps its content for 30 days (D24). */
  deleteNote: (id: string) => request<null>('DELETE', `/api/notes/${encodeURIComponent(id)}`),

  // The trash (D24).
  listTrash: () => request<{ notes: Note[]; days: number }>('GET', '/api/notes/trash'),
  restoreNote: (id: string) => request<Note>('POST', `/api/notes/${encodeURIComponent(id)}/restore`),
  /** Wipes the content now instead of waiting for it to age out. */
  purgeNote: (id: string) => request<null>('DELETE', `/api/notes/${encodeURIComponent(id)}/forever`),

  // Shared folders (D18).
  listShares: () => request<{ mine: Share[]; withMe: Share[]; contacts: Person[] }>('GET', '/api/shares'),

  // Reminder notifications (D21).
  pushKey: () => request<{ publicKey: string | null }>('GET', '/api/push/key'),
  pushStatus: () => request<{ configured: boolean; devices: number }>('GET', '/api/push/status'),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) => request<{ ok: true }>('POST', '/api/push/subscribe', sub),
  pushUnsubscribe: (endpoint: string) => request<null>('POST', '/api/push/unsubscribe', { endpoint }),
  /** Sends a notification to your own devices now, to check the chain works. */
  pushTest: () => request<{ sent: number; gone: number }>('POST', '/api/push/test'),
  createShare: (path: string[], email: string) => request<Share>('POST', '/api/shares', { path, email }),
  acceptShare: (by: { token: string } | { id: string }) => request<Share>('POST', '/api/shares/accept', by),
  removeShare: (id: string) => request<null>('DELETE', `/api/shares/${encodeURIComponent(id)}`),
  /** Keeps shares on a folder the owner renamed or moved. */
  moveShares: (from: string[], to: string[]) => request<{ moved: number }>('POST', '/api/shares/move', { from, to }),

  // Folders whose notes can be ticked off (D22). Only the owner sets the mark.
  listTodoFolders: () => request<{ folders: TodoFolder[] }>('GET', '/api/todo-folders'),
  setTodoFolder: (pathKey: string) => request<TodoFolder>('PUT', `/api/todo-folders/${encodeURIComponent(pathKey)}`),
  unsetTodoFolder: (pathKey: string) => request<null>('DELETE', `/api/todo-folders/${encodeURIComponent(pathKey)}`),
  /** Keeps the mark on a folder the owner renamed or moved. */
  moveTodoFolders: (from: string[], to: string[]) => request<{ moved: number }>('POST', '/api/todo-folders/move', { from, to }),

  listProtectedFolders: () => request<{ folders: ProtectedFolder[] }>('GET', '/api/protected-folders'),
  saveProtectedFolder: (f: ProtectedFolder) =>
    request<ProtectedFolder>('PUT', `/api/protected-folders/${encodeURIComponent(f.pathKey)}`, f),
  deleteProtectedFolder: (pathKey: string) => request<null>('DELETE', `/api/protected-folders/${encodeURIComponent(pathKey)}`),

  // AI (D15), done by the server. 503 means AI isn't configured there.
  classify: (text: string, signal?: AbortSignal) => request<Classification>('POST', '/api/ai/classify', { text }, signal),
  search: (q: string, signal?: AbortSignal) =>
    request<{ ids: string[]; reranked: boolean }>('GET', `/api/ai/search?q=${encodeURIComponent(q)}`, undefined, signal),
}

export interface User {
  id: string
  email: string
  name: string | null
  picture: string | null
}

export interface Classification {
  /** The folder the AI picked, existing or new. */
  path: string[]
  isNew: boolean
  /** Existing folders whose notes are most similar. */
  alternatives: string[][]
}
