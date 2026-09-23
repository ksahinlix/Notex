// A single toast message at the bottom of the screen, e.g. after moving a
// note: "Taşındı: Yazılım / LSA · [Sadece Yazılım'a koy] · [Geri al]".

import { useSyncExternalStore } from 'react'

export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: number
  message: string
  actions?: ToastAction[]
  error?: boolean
}

let current: Toast | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export function showToast(t: Omit<Toast, 'id'>, ms = 8000) {
  current = { ...t, id: nextId++ }
  if (timer) clearTimeout(timer)
  timer = setTimeout(hideToast, ms)
  emit()
}

export function hideToast() {
  current = null
  if (timer) clearTimeout(timer)
  timer = null
  emit()
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
  )
}
