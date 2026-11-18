import { describe, it, expect, vi } from 'vitest'
import { endSession } from '@/lib/signOut'

// A signed-out session that the server still honours is not signed out.
describe('ending a session', () => {
  it('revokes the current session before clearing local state', async () => {
    const order = []
    const revoked = await endSession({
      sessions: async () => ({ sessions: [{ id: 'abc123', current: false }, { id: 'cur999', current: true }] }),
      revoke: async (id) => { order.push(`revoke:${id}`) },
      clear: () => order.push('clear'),
    })
    expect(revoked).toBe(true)
    expect(order).toEqual(['revoke:cur999', 'clear'])
  })

  it('still signs out locally when the server cannot be reached', async () => {
    let cleared = false
    const revoked = await endSession({
      sessions: async () => { throw new Error('offline') },
      revoke: async () => { throw new Error('should not be called') },
      clear: () => { cleared = true },
    })
    expect(revoked).toBe(false)
    expect(cleared).toBe(true)
  })

  it('does not fire a revoke when no session is marked current', async () => {
    const revoke = vi.fn()
    const revoked = await endSession({
      sessions: async () => ({ sessions: [{ id: 'other', current: false }] }),
      revoke,
      clear: () => {},
    })
    expect(revoked).toBe(false)
    expect(revoke).not.toHaveBeenCalled()
  })
})
