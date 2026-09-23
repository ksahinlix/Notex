import { useEffect, useRef } from 'react'
import { answerConfirm, useConfirmDialog } from '../state/confirm'

/** Renders the dialog opened with confirmDialog() (state/confirm.ts). Enter confirms, Esc cancels. */
export function ConfirmHost() {
  const dialog = useConfirmDialog()
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!dialog) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answerConfirm(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog])

  if (!dialog) return null
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && answerConfirm(false)}>
      <div className="card modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal-title" id="confirm-title">{dialog.title}</div>
        {dialog.message && <div className="confirm-message">{dialog.message}</div>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => answerConfirm(false)}>{dialog.cancelLabel ?? 'Vazgeç'}</button>
          <button ref={confirmRef} className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => answerConfirm(true)}>
            {dialog.confirmLabel ?? 'Tamam'}
          </button>
        </div>
      </div>
    </div>
  )
}
