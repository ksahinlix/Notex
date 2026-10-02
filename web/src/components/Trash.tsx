import { useEffect } from 'react'
import { Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { formatDate } from '../lib/format'
import type { Note } from '../lib/types'
import { confirmDialog } from '../state/confirm'
import { store, useNotex } from '../state/store'
import { showToast } from '../state/toast'

/**
 * The trash (D24). Deleting a note no longer throws its words away: they stay
 * here, restorable, until they age out. Locked notes sit here as ciphertext
 * like anywhere else, so one shows its words only while its folder is open.
 */
export default function Trash() {
  const state = useNotex()

  useEffect(() => {
    if (state.trash === null) void store.loadTrash()
  }, [state.trash])

  if (state.trash === null) {
    return <div className="muted" style={{ padding: '24px 0' }}><Loader2 size={15} className="spin" /> Yükleniyor…</div>
  }
  if (!state.trash.length) {
    return <div className="muted empty">Çöp kutusu boş. Sildiğin notlar {state.trashDays} gün burada bekler.</div>
  }

  const preview = (n: Note) => {
    const c = store.contentOf(n)
    if (!c) return null
    const text = (c.listItemText || c.text || '').replace(/\s+/g, ' ').trim()
    return text || (c.blocks?.some((b) => b.type === 'image') ? '(görsel)' : '(boş not)')
  }

  async function restore(n: Note) {
    if (await store.restore(n.id)) showToast({ message: `Geri alındı: ${n.path.join(' / ')}` })
    else showToast({ message: 'Not geri alınamadı. Tekrar dene.', error: true })
  }

  async function purge(n: Note) {
    const text = preview(n)
    const ok = await confirmDialog({
      title: 'Kalıcı olarak silinsin mi?',
      message: text ? `“${text.length > 90 ? text.slice(0, 90) + '…' : text}” geri alınamaz.` : 'Bu not geri alınamaz.',
      confirmLabel: 'Kalıcı sil',
      danger: true,
    })
    if (!ok) return
    if (!(await store.purge(n.id))) showToast({ message: 'Not silinemedi. Tekrar dene.', error: true })
  }

  return (
    <section className="notes trash-list">
      <p className="trash-note muted">
        Silinen notlar {state.trashDays} gün burada bekler, sonra kendiliğinden silinir.
      </p>
      {state.trash.map((n) => {
        const text = preview(n)
        return (
          <article key={n.id} className="note trash-item">
            <div className="note-row">
              <div className="note-main">
                <div className="note-top">
                  <span className="note-path"><span className="ellipsis">{n.path.join(' › ')}</span></span>
                </div>
                <div className="note-body">
                  {text === null ? <span className="muted">Kilitli not — klasörün kilidini açınca görünür.</span> : <span className="pre">{text}</span>}
                </div>
                <div className="note-meta">{n.deletedAt ? `${formatDate(n.deletedAt)} silindi` : 'silindi'}</div>
              </div>
              <div className="note-actions">
                <button className="btn btn-ghost" onClick={() => void restore(n)} title="Notu geri getir">
                  <RotateCcw size={15} /> Geri al
                </button>
                <button className="icon-btn danger" onClick={() => void purge(n)} title="Kalıcı olarak sil" aria-label="Kalıcı olarak sil">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </article>
        )
      })}
    </section>
  )
}
