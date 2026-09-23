// Thin client for the Notex server API. Cookies carry the login session.

import type { Note, ProtectedFolder } from './types'

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
  health: () => request<{ ok: boolean; db: string }>('GET', '/api/health'),

  me: () => request<{ authenticated: boolean; user?: User }>('GET', '/api/auth/me'),
  authConfig: () => request<{ googleClientId: string | null }>('GET', '/api/auth/config'),
  /** Signs in (or up) with the ID token from Google's button. */
  loginGoogle: (credential: string) => request<{ user: User }>('POST', '/api/auth/google', { credential }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),

  /** Without `since`: all live notes. With `since`: all changes after it, including deletions. */
  listNotes: (since?: string) =>
    request<{ notes: Note[]; serverTime: string }>('GET', since ? `/api/notes?since=${encodeURIComponent(since)}` : '/api/notes'),
  /** Create or replace. Rejects with status 409 if the server has a newer version. */
  saveNote: (note: Note) => request<Note>('PUT', `/api/notes/${encodeURIComponent(note.id)}`, note),
  deleteNote: (id: string) => request<null>('DELETE', `/api/notes/${encodeURIComponent(id)}`),

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
