import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { UNAUTHORIZED_EVENT } from '../lib/api'
import { showToast } from '../state/toast'

/**
 * Downloads everything you have written as one JSON file (D23). The server
 * builds the same dump it writes to the backup bucket, narrowed to you.
 *
 * Not `api.ts`: that parses JSON, and here the point is to hand the bytes
 * straight to the browser as a file.
 */
export default function ExportButton() {
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    try {
      const res = await fetch('/api/export', { credentials: 'same-origin' })
      if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `notex-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      // Chrome needs the URL to outlive the click; a tick is enough.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      showToast({ message: 'Notların bir dosyaya indirildi.' })
    } catch {
      showToast({ message: 'Yedek indirilemedi. Tekrar dene.', error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className="link export-btn" onClick={() => void run()} disabled={busy} title="Bütün notlarını tek bir JSON dosyası olarak indir">
      {busy ? <Loader2 size={12} className="spin" /> : <Download size={12} />} Notlarını indir
    </button>
  )
}
