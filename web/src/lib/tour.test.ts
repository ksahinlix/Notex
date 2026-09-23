import { describe, expect, it } from 'vitest'
import { availableSteps, TOUR_STEPS } from './tour'

describe('tour', () => {
  it('skips steps whose element is not on screen', () => {
    const onScreen = new Set(['composer', 'tree', 'help'])
    const steps = availableSteps(TOUR_STEPS, (t) => onScreen.has(t))
    expect(steps.map((s) => s.target ?? 'welcome')).toEqual(['welcome', 'composer', 'tree', 'help'])
  })

  it('starts with a welcome and ends with how to reopen it', () => {
    expect(TOUR_STEPS[0].target).toBeUndefined()
    expect(TOUR_STEPS.at(-1)!.target).toBe('help')
    expect(new Set(TOUR_STEPS.map((s) => s.target)).size).toBe(TOUR_STEPS.length) // no duplicates
  })
})
