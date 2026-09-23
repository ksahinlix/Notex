// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, isDark, loadTheme, nextTheme, parseTheme, saveTheme } from './theme'

describe('theme', () => {
  beforeEach(() => localStorage.clear())

  it('cycles Sistem → Açık → Koyu → Sistem', () => {
    expect(nextTheme('system')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('system')
  })

  it('treats unknown saved values as system', () => {
    expect(parseTheme(null)).toBe('system')
    expect(parseTheme('purple')).toBe('system')
    expect(parseTheme('dark')).toBe('dark')
  })

  it('remembers the choice; system clears it', () => {
    saveTheme('dark')
    expect(loadTheme()).toBe('dark')
    saveTheme('system')
    expect(localStorage.getItem('notex-theme')).toBeNull()
    expect(loadTheme()).toBe('system')
  })

  it('sets data-theme only for an explicit choice', () => {
    const el = document.createElement('html')
    applyTheme('dark', el)
    expect(el.getAttribute('data-theme')).toBe('dark')
    applyTheme('system', el)
    expect(el.hasAttribute('data-theme')).toBe(false)
  })

  it('an explicit choice decides isDark', () => {
    expect(isDark('dark')).toBe(true)
    expect(isDark('light')).toBe(false)
  })
})
