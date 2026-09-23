// React hooks for the AI features, which run on the server (D15):
// folder suggestions while writing, and search by meaning.
// Both wait until typing pauses, cancel outdated requests, and cache answers,
// so a note costs about one AI call (the free daily allowance is limited).

import { useEffect, useState } from 'react'
import { api, type Classification } from '../lib/api'

const classifyCache = new Map<string, Classification>()
const searchCache = new Map<string, string[]>()

/** Server said AI is not configured (503): stop asking for this session. */
let aiUnavailable = false

export interface CategorySuggestion {
  result: Classification | null
  /** An answer for the current text is on its way. */
  loading: boolean
  /** The text the current result belongs to. */
  forText: string
}

/**
 * Folder suggestion for the text being written, ~1.2 s after typing stops.
 * `enabled` is false when the note goes into a protected folder (its text
 * must not be sent anywhere) or the user already chose a path.
 */
export function useCategorySuggestion(text: string, enabled: boolean): CategorySuggestion {
  const t = text.trim()
  const [state, setState] = useState<{ text: string; result: Classification | null }>({ text: '', result: null })

  // A new note must not inherit the previous note's answer.
  // (Adjusting state during render, as recommended over an effect.)
  if (t.length < 4 && state.text) setState({ text: '', result: null })

  const active = enabled && !aiUnavailable && t.length >= 4
  useEffect(() => {
    if (!active) return
    const cached = classifyCache.get(t)
    const ctrl = new AbortController()
    const timer = setTimeout(
      async () => {
        try {
          const result = cached ?? (await api.classify(t, ctrl.signal))
          classifyCache.set(t, result)
          setState({ text: t, result })
        } catch (e) {
          if (ctrl.signal.aborted) return
          if ((e as { status?: number }).status === 503) aiUnavailable = true
          setState({ text: t, result: null }) // no suggestion; the user types a path
        }
      },
      cached ? 0 : 1200,
    )
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [t, active])

  if (!active) return { result: null, loading: false, forText: '' }
  // While typing continues the previous answer stays visible, marked as loading.
  return { result: state.result, loading: state.text !== t, forText: state.text }
}

/**
 * Note ids matching `query` by meaning, best first, or null while unknown or
 * when AI is unavailable (the caller then shows keyword matches only).
 */
export function useSemanticSearch(query: string): { ids: string[] | null; loading: boolean } {
  const q = query.trim()
  const [state, setState] = useState<{ q: string; ids: string[] | null }>({ q: '', ids: null })
  const active = !aiUnavailable && q.length >= 2

  useEffect(() => {
    if (!active) return
    const cached = searchCache.get(q)
    const ctrl = new AbortController()
    const timer = setTimeout(
      async () => {
        try {
          const ids = cached ?? (await api.search(q, ctrl.signal)).ids
          searchCache.set(q, ids)
          setState({ q, ids })
        } catch (e) {
          if (ctrl.signal.aborted) return
          if ((e as { status?: number }).status === 503) aiUnavailable = true
          setState({ q, ids: null })
        }
      },
      cached ? 0 : 500,
    )
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [q, active])

  if (!active) return { ids: null, loading: false }
  return { ids: state.q === q ? state.ids : null, loading: state.q !== q }
}

/** Notes changed: cached search results may be outdated. */
export function clearSearchCache() {
  searchCache.clear()
}

/** Logout: forget everything cached for the previous user. */
export function clearAiCaches() {
  classifyCache.clear()
  searchCache.clear()
  aiUnavailable = false
}
