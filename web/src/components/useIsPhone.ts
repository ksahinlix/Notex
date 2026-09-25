import { useSyncExternalStore } from 'react'

/** Same breakpoint as the phone layout in index.css. */
const QUERY = '(max-width: 680px)'

const subscribe = (fn: () => void) => {
  const m = window.matchMedia(QUERY)
  m.addEventListener('change', fn)
  return () => m.removeEventListener('change', fn)
}

/** True while the phone layout is on screen. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}
