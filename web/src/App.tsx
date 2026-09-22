import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from './lib/api'

type Status = 'loading' | 'loggedOut' | 'loggedIn'

// Step 1 shell: login + connection check. The notes UI (ported from
// docs/prototype.jsx) replaces the logged-in view in the next step.
export default function App() {
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    api.me().then((r) => setStatus(r.authenticated ? 'loggedIn' : 'loggedOut')).catch(() => setStatus('loggedOut'))
  }, [])

  if (status === 'loading') return <main className="center muted">Yükleniyor...</main>
  if (status === 'loggedOut') return <Login onSuccess={() => setStatus('loggedIn')} />
  return <Home onLogout={() => setStatus('loggedOut')} />
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.login(password)
      onSuccess()
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? 'Çok fazla deneme. Biraz bekle.' : 'Şifre yanlış.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="center">
      <form className="card login" onSubmit={submit}>
        <h1>Notex</h1>
        <input type="password" autoFocus placeholder="Şifre" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" disabled={!password || busy}>Giriş</button>
      </form>
    </main>
  )
}

function Home({ onLogout }: { onLogout: () => void }) {
  const [info, setInfo] = useState('Bağlantı kontrol ediliyor...')

  useEffect(() => {
    Promise.all([api.health(), api.listNotes()])
      .then(([h, n]) => setInfo(`Sunucu: çalışıyor · Veritabanı: ${h.db} · Not sayısı: ${n.notes.length}`))
      .catch(() => setInfo('Sunucuya ulaşılamadı.'))
  }, [])

  return (
    <main className="page">
      <header className="topbar">
        <strong>Notlar</strong>
        <button className="btn btn-ghost" onClick={() => api.logout().finally(onLogout)}>Çıkış</button>
      </header>
      <p className="muted">{info}</p>
    </main>
  )
}
