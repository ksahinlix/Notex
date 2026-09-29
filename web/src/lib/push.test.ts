// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { iosNeedsInstall, pushLabel, supported } from './push'

const ua = (value: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(value)
// jsdom has no matchMedia, so define one rather than spy on it.
const standalone = (matches: boolean) =>
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches }), configurable: true, writable: true })

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('push', () => {
  it('knows when the browser cannot do it at all', () => {
    // jsdom has no PushManager
    expect(supported()).toBe(false)
  })

  it('tells an iPhone to install the app first, but not once it is installed', () => {
    ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1')
    standalone(false)
    expect(iosNeedsInstall()).toBe(true)
    standalone(true)
    expect(iosNeedsInstall()).toBe(false)
  })

  it('does not ask an Android to install anything', () => {
    ua('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36')
    standalone(false)
    expect(iosNeedsInstall()).toBe(false)
  })

  it('says what the button does in each state, and when it can be pressed', () => {
    expect(pushLabel('off')).toMatchObject({ text: 'Bildirimleri aç', can: true })
    expect(pushLabel('on')).toMatchObject({ text: 'Bildirimler açık', can: true })
    // These three cannot be fixed by pressing the button, so it stays disabled.
    expect(pushLabel('denied').can).toBe(false)
    expect(pushLabel('ios-needs-install').can).toBe(false)
    expect(pushLabel('not-configured').can).toBe(false)
    for (const s of ['on', 'off', 'denied', 'ios-needs-install', 'not-configured', 'unsupported'] as const) {
      expect(pushLabel(s).hint.length).toBeGreaterThan(10) // every state explains itself
    }
  })
})
