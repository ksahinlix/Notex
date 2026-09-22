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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new ApiError(res.status, data)
  return data as T
}

export const api = {
  health: () => request<{ ok: boolean; db: string }>('GET', '/api/health'),

  me: () => request<{ authenticated: boolean }>('GET', '/api/auth/me'),
  login: (password: string) => request<{ ok: true }>('POST', '/api/auth/login', { password }),
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
}
