import { useState } from 'react'
import { Check, Copy, Link2, Trash2, UserPlus, X } from 'lucide-react'
import { inviteLink, personName, sharesForPath } from '../lib/sharing'
import type { Person, Share } from '../lib/types'
import { store, useNotex } from '../state/store'
import { showToast } from '../state/toast'

interface Props {
  path: string[]
  shares: Share[]
  onClose: () => void
}

/**
 * "Paylaş" for a folder (D18): invite by e-mail, or pick somebody you have
 * shared with before — they don't have to accept a second time (D19).
 * There is no mail server, so the invite link is copied for you to send.
 */
export default function ShareModal({ path, shares, onClose }: Props) {
  const state = useNotex()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const here = sharesForPath(shares, path)
  const own = here.filter((s) => s.path.join('/') === path.join('/'))
  const inherited = here.filter((s) => !own.includes(s))
  const already = new Set(here.map((s) => s.invitedEmail.toLowerCase()))
  const known = state.contacts.filter((c) => !already.has(c.email.toLowerCase()))

  async function invite(address: string) {
    if (busy) return
    setBusy(true)
    setError('')
    const res = await store.share(path, address.trim())
    setBusy(false)
    if ('error' in res) return setError(res.error)
    setEmail('')
    if (res.share.status === 'accepted') showToast({ message: `${personName(res.share.person ?? { name: null, email: res.share.invitedEmail })} bu klasörü görebiliyor.` })
    else await copy(res.share)
  }

  async function copy(share: Share) {
    try {
      await navigator.clipboard.writeText(inviteLink(share.token))
      setCopied(share.id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      showToast({ message: inviteLink(share.token) }) // clipboard blocked: show it to copy by hand
    }
  }

  const label = (p: Person | { name: string | null; email: string }) => personName(p)

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{path.join(' / ')} klasörünü paylaş</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Kapat"><X size={16} /></button>
        </div>
        <p className="muted">
          Paylaştığın kişi bu klasördeki notları ve hatırlatmaları görür, yenisini ekleyebilir ve tamamlayabilir.
        </p>

        <form
          className="share-invite"
          onSubmit={(e) => {
            e.preventDefault()
            void invite(email)
          }}
        >
          <input
            type="email"
            value={email}
            placeholder="arkadasin@gmail.com"
            onChange={(e) => {
              setEmail(e.target.value)
              setError('')
            }}
            autoFocus
          />
          <button className="btn btn-primary" disabled={busy || !email.trim()}>
            <UserPlus size={14} /> Davet et
          </button>
        </form>
        {error && <div className="banner-error">{error}</div>}

        {known.length > 0 && (
          <>
            <div className="share-label">Daha önce paylaştıkların</div>
            <div className="share-known">
              {known.map((c) => (
                <button key={c.email} className="btn btn-ghost" disabled={busy} onClick={() => void invite(c.email)} title={c.email}>
                  <UserPlus size={13} /> {label(c)}
                </button>
              ))}
            </div>
          </>
        )}

        {own.length > 0 && (
          <>
            <div className="share-label">Bu klasörü görenler</div>
            <ul className="share-list">
              {own.map((s) => (
                <li key={s.id}>
                  <span className="ellipsis">
                    {label(s.person ?? { name: null, email: s.invitedEmail })}
                    <span className="muted"> · {s.status === 'pending' ? 'davet bekliyor' : 'katıldı'}</span>
                  </span>
                  {s.status === 'pending' && (
                    <button className="icon-btn" title="Davet bağlantısını kopyala" onClick={() => void copy(s)}>
                      {copied === s.id ? <Check size={14} className="c-ok" /> : <Copy size={14} />}
                    </button>
                  )}
                  <button
                    className="icon-btn danger"
                    title="Paylaşımı kaldır"
                    onClick={async () => {
                      if (await store.unshare(s.id)) showToast({ message: 'Paylaşım kaldırıldı.' })
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {inherited.length > 0 && (
          <p className="muted small">
            <Link2 size={12} /> Üst klasör ({inherited[0].path.join(' / ')}){' '}
            {inherited.map((s) => label(s.person ?? { name: null, email: s.invitedEmail })).join(', ')} ile paylaşıldığı için bu klasör de görünür.
          </p>
        )}
      </div>
    </div>
  )
}
