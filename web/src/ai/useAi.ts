import { useEffect, useState, useSyncExternalStore } from 'react'
import { matchesQuery } from '../lib/notes'
import type { Note, NoteContent } from '../lib/types'
import { ai, type AiStatus } from './engine'
import { llm, type LlmStatus } from './llm'
import { noteEmbeddingText, rankNotes, suggestFolders, type FolderSuggestion, type Vec } from './vector'

export function useAiStatus(): AiStatus {
  return useSyncExternalStore(ai.subscribe, ai.getSnapshot)
}

export interface NoteVectors {
  notes: Map<string, Vec>
  /** Vectors of page names, keyed by path joined with "/". */
  names: Map<string, Vec>
}

const EMPTY: NoteVectors = { notes: new Map(), names: new Map() }

/**
 * Embeds every readable note (and every page name) in the background.
 * Locked notes are skipped. Returns empty maps while AI is off or loading.
 */
export function useNoteVectors(notes: Note[], contentOf: (n: Note) => NoteContent | undefined, ready: boolean, plainVersion: unknown): NoteVectors {
  const [vectors, setVectors] = useState<NoteVectors>(EMPTY)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const items = notes.flatMap((n) => {
      const c = contentOf(n)
      return c ? [{ id: n.id, text: noteEmbeddingText(n.path, c.listItemText || c.text), persist: !n.encrypted }] : []
    })
    const pages = [...new Map(notes.map((n) => [n.path.join('/'), n.path])).entries()]
    ;(async () => {
      try {
        const [vecs, nameVecs] = await Promise.all([
          ai.embedPassages(items.map((i) => i.text), items.map((i) => i.persist)),
          ai.embedPassages(pages.map(([, p]) => p.join(' / ')), pages.map(() => true)),
        ])
        if (cancelled) return
        setVectors({
          notes: new Map(items.map((it, i) => [it.id, vecs[i]])),
          names: new Map(pages.map(([key], i) => [key, nameVecs[i]])),
        })
      } catch {
        /* AI turned off mid-way; keep previous vectors */
      }
    })()
    return () => {
      cancelled = true
    }
    // plainVersion changes when folders are unlocked/locked; contentOf reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, ready, plainVersion])

  return ready ? vectors : EMPTY
}

/**
 * Meaning-based search: returns note ids in ranked order, or null when AI
 * isn't available (the caller then uses plain keyword search).
 */
export function useSemanticSearch(query: string, candidates: Note[], contentOf: (n: Note) => NoteContent | undefined, vectors: NoteVectors, ready: boolean): string[] | null {
  const [result, setResult] = useState<{ query: string; ids: string[] } | null>(null)
  const q = query.trim()

  useEffect(() => {
    if (!ready || q.length < 2) return
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const qv = await ai.embedQuery(q)
        if (cancelled) return
        const items = candidates.flatMap((n) => {
          const vec = vectors.notes.get(n.id)
          return vec ? [{ id: n.id, vec }] : []
        })
        const keyword = new Set(candidates.filter((n) => matchesQuery(n, contentOf(n), q)).map((n) => n.id))
        setResult({ query: q, ids: rankNotes(qv, items, keyword).map((r) => r.id) })
      } catch {
        /* AI turned off */
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, ready, vectors, candidates])

  return ready && result && result.query === q ? result.ids : null
}

/** Up to 3 existing pages that fit the text being written. */
export function useFolderSuggestions(text: string, notes: Note[], vectors: NoteVectors, ready: boolean): FolderSuggestion[] {
  const [result, setResult] = useState<{ text: string; list: FolderSuggestion[] }>({ text: '', list: [] })
  const t = text.trim()

  useEffect(() => {
    if (!ready || t.length < 4 || vectors.notes.size === 0) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const qv = await ai.embedQuery(t)
        if (cancelled) return
        const items = notes.flatMap((n) => {
          const vec = vectors.notes.get(n.id)
          return vec ? [{ path: n.path, vec }] : []
        })
        setResult({ text: t, list: suggestFolders(qv, items, vectors.names) })
      } catch {
        /* AI turned off */
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [t, notes, vectors, ready])

  // A new note must not inherit the previous note's suggestions.
  if (t.length < 4 && result.text) setResult({ text: '', list: [] })

  // While typing, keep showing the previous suggestions until new ones arrive.
  return ready && t.length >= 4 ? result.list : []
}

export function useLlmStatus(): LlmStatus {
  return useSyncExternalStore(llm.subscribe, llm.getSnapshot)
}

/**
 * The category model's folder for the text being written (D13): asked ~0.8 s
 * after typing stops. Keeps showing the last answer while a new one is computed.
 */
export function useCategorySuggestion(
  text: string,
  folders: string[][],
  ready: boolean,
): { path: string[] | null; loading: boolean; forText: string } {
  const [result, setResult] = useState<{ text: string; path: string[] | null }>({ text: '', path: null })
  const t = text.trim()

  // A new note (text cleared) must not inherit the previous note's answer.
  // (Adjusting state during render, as recommended over an effect.)
  if (t.length < 4 && result.text) setResult({ text: '', path: null })

  useEffect(() => {
    if (!ready || t.length < 4) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const path = await llm.classify(t, folders)
      if (!cancelled) setResult({ text: t, path })
    }, 800)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // `folders` is rebuilt on each render; its content only changes with notes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, ready, folders.length])

  if (!ready || t.length < 4) return { path: null, loading: false, forText: '' }
  // While the user keeps typing the previous answer stays visible, but it is
  // marked as loading until the answer for the current text arrives.
  return { path: result.path, loading: result.text !== t, forText: result.text }
}
