import { describe, expect, it } from 'vitest'
import { isOutdated, versionDetail } from './version'

const build = { name: 'v1.0.3', commit: 'a1b2c3d', builtAt: '2026-09-24T12:30:00Z' }

describe('version', () => {
  it('spells out the build for the tooltip', () => {
    expect(versionDetail(build)).toMatch(/^v1\.0\.3 · a1b2c3d · /)
    expect(versionDetail({ ...build, builtAt: '' })).toBe('v1.0.3 · a1b2c3d')
    expect(versionDetail({ ...build, builtAt: 'not a date' })).toBe('v1.0.3 · a1b2c3d')
  })

  it('spots a deploy that happened while the tab was open', () => {
    expect(isOutdated('9f8e7d6', build)).toBe(true)
    expect(isOutdated('a1b2c3d', build)).toBe(false)
  })

  it('compares commits, not the version number, so a forgotten bump still shows', () => {
    expect(isOutdated('9f8e7d6', { ...build, name: 'v1.0.3' })).toBe(true)
  })

  it('stays quiet when either side is unknown', () => {
    expect(isOutdated(undefined, build)).toBe(false)
    expect(isOutdated('dev', build)).toBe(false)
    expect(isOutdated('9f8e7d6', { ...build, commit: 'dev' })).toBe(false)
  })
})
