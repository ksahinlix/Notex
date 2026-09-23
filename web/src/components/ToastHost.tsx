import { X } from 'lucide-react'
import { hideToast, useToast } from '../state/toast'

/** Renders the current toast (state/toast.ts). An action runs once and closes it. */
export function ToastHost() {
  const toast = useToast()
  if (!toast) return null
  return (
    <div className={`toast ${toast.error ? 'error' : ''}`} role="status" aria-live="polite">
      <span className="toast-message">{toast.message}</span>
      {toast.actions?.map((a) => (
        <button
          key={a.label}
          className="toast-action"
          onClick={() => {
            hideToast()
            a.run()
          }}
        >
          {a.label}
        </button>
      ))}
      <button className="icon-btn" aria-label="Kapat" onClick={hideToast}><X size={13} /></button>
    </div>
  )
}
