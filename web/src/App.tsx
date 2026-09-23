import { useEffect, useState, type FormEvent } from 'react'
import NotesPage from './components/NotesPage'
import { api, ApiError, UNAUTHORIZED_EVENT } from './lib/api'
import { ai } from './ai/engine'
import { store } from './state/store'

type Status = 'loading' | 'loggedOut' | 'loggedIn'

export default function App() {
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    api.me().then((r) => setStatus(r.authenticated ? 'loggedIn' : 'loggedOut')).catch(() => setStatus('loggedOut'))
    const onExpired = () => {
      store.reset()
      setStatus('loggedOut')
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onExpired)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onExpired)
  }, [])

  async function logout() {
    await api.logout().catch(() => {})
    store.reset() // drop notes and folder keys from memory
    ai.clearMemory() // and note vectors
    setStatus('loggedOut')
  }

  if (status === 'loading') return <main className="center muted">Yükleniyor...</main>
  if (status === 'loggedOut') return <Login onSuccess={() => setStatus('loggedIn')} />
  return <NotesPage onLogout={logout} />
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
