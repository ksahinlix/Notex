import { describe, expect, it } from 'vitest'
import { isOutdated, versionLabel } from './version'

describe('version', () => {
  it('shows the commit and when it was built', () => {
    expect(versionLabel({ commit: 'a1b2c3d', builtAt: '2026-09-24T12:30:00Z' })).toMatch(/^a1b2c3d · /)
    expect(versionLabel({ commit: 'a1b2c3d', builtAt: '' })).toBe('a1b2c3d')
    expect(versionLabel({ commit: 'a1b2c3d', builtAt: 'not a date' })).toBe('a1b2c3d')
  })

  it('spots a deploy that happened while the tab was open', () => {
    const mine = { commit: 'a1b2c3d', builtAt: '' }
    expect(isOutdated('9f8e7d6', mine)).toBe(true)
    expect(isOutdated('a1b2c3d', mine)).toBe(false)
  })

  it('stays quiet when either side is unknown', () => {
    expect(isOutdated(undefined, { commit: 'a1b2c3d', builtAt: '' })).toBe(false)
    expect(isOutdated('dev', { commit: 'a1b2c3d', builtAt: '' })).toBe(false)
    expect(isOutdated('9f8e7d6', { commit: 'dev', builtAt: '' })).toBe(false)
  })
})
