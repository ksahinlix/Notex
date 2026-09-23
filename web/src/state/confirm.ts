// State for the in-app confirm dialog (replaces the browser's confirm() popup).
// Usage: if (await confirmDialog({ title: 'Not silinsin mi?', ... })) ...
// <ConfirmHost /> (components/ConfirmDialog.tsx) must be rendered once.

import { useSyncExternalStore } from 'react'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button, for destructive actions. */
  danger?: boolean
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void }

let current: Pending | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  current?.resolve(false) // only one dialog at a time
  return new Promise((resolve) => {
    current = { ...options, resolve }
    emit()
  })
}

export function answerConfirm(ok: boolean) {
  const c = current
  current = null
  emit()
  c?.resolve(ok)
}

export function useConfirmDialog(): ConfirmOptions | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
  )
}
