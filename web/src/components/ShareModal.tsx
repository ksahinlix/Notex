import { useState } from 'react'
import { Check, Copy, Link2, Trash2, UserPlus, X } from 'lucide-react'
import { inviteLink, sharesForPath } from '../lib/sharing'
import type { Share } from '../lib/types'
import { store } from '../state/store'
import { showToast } from '../state/toast'

interface Props {
  path: string[]
  shares: Share[]
  onClose: () => void
}

/**
 * "Paylaş" for a folder (D18): invite by e-mail, then send the link yourself.
 * There is no mail server; signing in with the invited address accepts it.
 */
export default function ShareModal({ path, shares, onClose }: Props) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const here = sharesForPath(shares, path)
  const own = here.filter((s) => s.path.join('/') === path.join('/'))
  const inherited = here.filter((s) => !own.includes(s))

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    const res = await store.share(path, email.trim())
    setBusy(false)
    if ('error' in res) return setError(res.error)
    setEmail('')
    await copy(res.share)
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

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{path.join(' / ')} klasörünü paylaş</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Kapat"><X size={16} /></button>
        </div>
        <p className="muted">
          Davet ettiğin kişi bu klasördeki notları ve hatırlatmaları görür, yenisini ekleyebilir ve tamamlayabilir.
          Bağlantıyı sen gönderirsin; davet, o e-posta ile giriş yapınca geçerli olur.
        </p>

        <form className="share-invite" onSubmit={invite}>
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

        {own.length > 0 && (
          <ul className="share-list">
            {own.map((s) => (
              <li key={s.id}>
                <span className="ellipsis">
                  {s.person?.name || s.invitedEmail}
                  {s.status === 'pending' && <span className="muted"> · davet bekliyor</span>}
                </span>
                <button className="icon-btn" title="Davet bağlantısını kopyala" onClick={() => void copy(s)}>
                  {copied === s.id ? <Check size={14} className="c-ok" /> : <Copy size={14} />}
                </button>
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
        )}

        {inherited.length > 0 && (
          <p className="muted small">
            <Link2 size={12} /> Üst klasör ({inherited[0].path.join(' / ')}) zaten{' '}
            {inherited.map((s) => s.person?.name || s.invitedEmail).join(', ')} ile paylaşıldığı için bu klasör de görünür.
          </p>
        )}
      </div>
    </div>
  )
}
