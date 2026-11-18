import { describe, it, expect, vi, beforeEach } from 'vitest'
import { debugLog, debugEnabled } from '@/lib/debug'

// A browser console is shared with every extension and anything that can run in the page, so
// diagnostics that name the user or the key-derivation salt must be opt-in, not ambient.
describe('diagnostics', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('is silent unless asked for', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(debugEnabled()).toBe(false)
    debugLog('[keySession] key restored', { secret: true })
    expect(spy).not.toHaveBeenCalled()
  })

  it('prints when the reader turns it on', () => {
    localStorage.setItem('sloth-debug', '1')
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    debugLog('hello')
    expect(spy).toHaveBeenCalledWith('hello')
  })
})
