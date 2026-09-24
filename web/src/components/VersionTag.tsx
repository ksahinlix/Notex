import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { isOutdated, VERSION, versionLabel } from '../lib/version'
import { showToast } from '../state/toast'

/**
 * Which build this page is running, in the corner. It also asks the server
 * on load and whenever the tab regains focus: if a deploy happened while the
 * tab was open, the page offers to reload (an old tab keeps talking to the
 * new server otherwise).
 */
export default function VersionTag() {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    let told = false
    const check = async () => {
      if (document.hidden) return
      try {
        const h = await api.health()
        if (!isOutdated(h.version)) return
        setStale(true)
        if (told) return
        told = true
        showToast({ message: 'Yeni sürüm yayında.', actions: [{ label: 'Yenile', run: () => location.reload() }] })
      } catch {
        /* offline or waking up: ask again next time */
      }
    }
    void check()
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [])

  return (
    <div className="version-tag" title={`Bu sayfa ${VERSION.commit} sürümünü çalıştırıyor`}>
      {stale ? (
        <button className="link" onClick={() => location.reload()}>Yeni sürüm var — yenile</button>
      ) : (
        <span>sürüm {versionLabel()}</span>
      )}
    </div>
  )
}
