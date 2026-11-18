import { describe, it, expect, vi, beforeEach } from 'vitest'

// The point of this module is that confidentiality must not depend on someone finding a
// setting. These tests pin: it creates a key when missing, does nothing when present, and
// never throws into the sign-in path.
const post = vi.fn()
const get = vi.fn()
vi.mock('@/api', () => ({ default: { post: (...a) => post(...a), get: (...a) => get(...a) } }))
vi.mock('@/storage', () => ({ storage: { getToken: () => 'token' } }))
vi.mock('@/keySession', () => ({ keySession: { setPq: vi.fn(), getPq: () => null } }))

import { ensurePostQuantumKey } from '@/lib/pqSetup'

const SALT = '00112233445566778899aabbccddeeff' // hex, as deriveWrapKey expects

describe('ensurePostQuantumKey', () => {
  beforeEach(() => { post.mockReset(); get.mockReset() })

  it('creates and publishes a key when the account has none', async () => {
    get.mockResolvedValue({ data: { enabled: false } })
    post.mockResolvedValue({ data: { public_key: 'pk' } })

    const result = await ensurePostQuantumKey('pw', SALT)

    expect(result).toEqual({ ok: true, created: true })
    const [path, body] = post.mock.calls[0]
    expect(path).toBe('/user/pq-keys')
    expect(body.public_key).toBeTruthy()
    // The secret goes up wrapped, never bare.
    expect(body.encrypted_private_key).toBeTruthy()
    expect(body.encrypted_private_key).not.toContain('secret')
  })

  it('does nothing when a key already exists', async () => {
    get.mockResolvedValue({ data: { enabled: true, encrypted_private_key: 'x' } })
    const result = await ensurePostQuantumKey('pw', SALT)
    expect(result).toEqual({ ok: true, created: false })
    expect(post).not.toHaveBeenCalled()
  })

  it('does not throw when the server refuses — a sign-in must still succeed', async () => {
    get.mockResolvedValue({ data: { enabled: false } })
    post.mockRejectedValue(new Error('server said no'))
    const result = await ensurePostQuantumKey('pw', SALT)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/server said no/)
  })

  it('does not throw when the status check itself fails', async () => {
    get.mockRejectedValue(new Error('offline'))
    const result = await ensurePostQuantumKey('pw', SALT)
    expect(result.ok).toBe(false)
  })

  it('reports, rather than guesses, when it has no password to wrap with', async () => {
    get.mockResolvedValue({ data: { enabled: false } })
    const result = await ensurePostQuantumKey('', SALT)
    expect(result).toEqual({ ok: false, reason: 'no password in hand' })
    expect(post).not.toHaveBeenCalled()
  })
})
