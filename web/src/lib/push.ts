// Turning reminder notifications on for this browser (D21).
//
// The flow: ask the server for its public key, ask the browser for permission,
// get a subscription from the push service, hand it to the server. iOS only
// allows this for an app added to the home screen, so we say so rather than
// failing silently.

import { api } from './api'

export type PushState = 'unsupported' | 'ios-needs-install' | 'not-configured' | 'denied' | 'off' | 'on'

const b64ToBytes = (base64: string) => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** True on an iPhone browser that is not the installed app. */
export function iosNeedsInstall(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
  // `standalone` is the old iOS flag; matchMedia may be missing in odd hosts.
  const installed =
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
    (navigator as { standalone?: boolean }).standalone === true
  return ios && !installed
}

/**
 * `navigator.serviceWorker.ready` waits for a *controlling* worker and can
 * hang for good if registration is blocked, which would leave the button
 * missing rather than explaining itself. Nothing here waits without a limit.
 */
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))])

export async function currentState(): Promise<PushState> {
  if (!supported()) return iosNeedsInstall() ? 'ios-needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const { publicKey } = await api.pushKey()
  if (!publicKey) return 'not-configured'
  // getRegistration answers straight away; a missing worker just means "off".
  // Browsers differ in what they throw here, and a thrown error must not make
  // the button vanish — "off" at least lets someone try.
  try {
    const reg = await withTimeout(navigator.serviceWorker.getRegistration(), 3000)
    return reg && (await reg.pushManager.getSubscription()) ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

/** Asks permission and registers this browser. Returns the new state. */
export async function enable(): Promise<PushState> {
  if (!supported()) return iosNeedsInstall() ? 'ios-needs-install' : 'unsupported'
  const { publicKey } = await api.pushKey()
  if (!publicKey) return 'not-configured'
  if ((await Notification.requestPermission()) !== 'granted') return Notification.permission === 'denied' ? 'denied' : 'off'
  // Subscribing needs a worker that is actually running, so here we do wait
  // for `ready` — but not for ever.
  const reg = await withTimeout(navigator.serviceWorker.ready, 10_000)
  if (!reg) throw new Error('service worker not ready')
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }))
  await api.pushSubscribe(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } })
  return 'on'
}

/** Switches them off for this browser only. */
export async function disable(): Promise<PushState> {
  const reg = await withTimeout(navigator.serviceWorker.getRegistration(), 3000)
  const sub = reg ? await reg.pushManager.getSubscription() : null
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => {})
    await sub.unsubscribe()
  }
  return 'off'
}

/** What the button says, and whether it can be pressed. */
export function pushLabel(state: PushState): { text: string; hint: string; can: boolean } {
  switch (state) {
    case 'on':
      return { text: 'Bildirimler açık', hint: 'Hatırlatma zamanı geldiğinde bu cihaza bildirim gelir. Kapatmak için tıkla.', can: true }
    case 'off':
      return { text: 'Bildirimleri aç', hint: 'Hatırlatma zamanı geldiğinde bu cihaza bildirim gelsin.', can: true }
    case 'denied':
      return { text: 'Bildirimler engelli', hint: 'Tarayıcı bildirimleri engellemiş. Site ayarlarından izin verebilirsin.', can: false }
    case 'ios-needs-install':
      return { text: 'Bildirimler için uygulamayı ekle', hint: "iPhone'da bildirim için Notex'i ana ekrana eklemen gerekiyor.", can: false }
    case 'not-configured':
      return { text: 'Bildirimler kapalı', hint: 'Sunucuda bildirim anahtarları tanımlı değil.', can: false }
    default:
      return { text: 'Bildirimler desteklenmiyor', hint: 'Bu tarayıcı bildirim gönderemiyor.', can: false }
  }
}
