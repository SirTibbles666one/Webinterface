import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSigKeyPair, signBytes, verifyBytes, ensureSigningKey, sessionSigningKey } from '@/lib/sigKey'
import { wrapSecretBytes, unwrapSecretBytes } from '@/crypto'

// These tests exercise the real ML-DSA-65 implementation, not a stand-in: the signing key
// is the thing whose failure would make every message unverifiable, so the algorithm is
// the part worth testing rather than mocking.
const PASSWORD = 'correct horse battery staple'
const SALT = '00112233445566778899aabbccddeeff' // 16 bytes as hex: deriveWrapKey decodes hex, not base64

const fakeStorage = () => {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  }
}

describe('signing key lifecycle', () => {
  it('a generated key signs and verifies, and rejects the wrong message', () => {
    const { publicKey, secretKey } = generateSigKeyPair()
    const message = new TextEncoder().encode('slw/v2/message probe')
    const signature = signBytes(secretKey, message)

    expect(verifyBytes(publicKey, signature, message)).toBe(true)
    const altered = new TextEncoder().encode('slw/v2/message probf')
    expect(verifyBytes(publicKey, signature, altered)).toBe(false)
    // And a different key must not verify it either.
    expect(verifyBytes(generateSigKeyPair().publicKey, signature, message)).toBe(false)
  })

  it('wraps and unwraps the secret with the password KDF', async () => {
    const { secretKey } = generateSigKeyPair()
    const wrapped = await wrapSecretBytes(secretKey, PASSWORD, SALT)
    const back = await unwrapSecretBytes(wrapped, PASSWORD, SALT)
    expect(Buffer.from(back).toString('hex')).toBe(Buffer.from(secretKey).toString('hex'))
    await expect(unwrapSecretBytes(wrapped, 'wrong password', SALT)).rejects.toBeTruthy()
  })

  it('creates, publishes and caches a key the first time, then reuses it', async () => {
    const storage = fakeStorage()
    const session = fakeStorage()
    const publish = vi.fn(async () => {})

    const first = await ensureSigningKey({ password: PASSWORD, serverSalt: SALT, publish, storage, session })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(storage.getItem('openneutron.sig_key_public')).toBeTruthy()
    expect(storage.getItem('openneutron.sig_key_wrapped')).toBeTruthy()

    // A second call in the same tab must not regenerate or republish.
    const second = await ensureSigningKey({ password: PASSWORD, serverSalt: SALT, publish, storage, session })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(Buffer.from(second).toString('hex')).toBe(Buffer.from(first).toString('hex'))
    expect(Buffer.from(sessionSigningKey(session)).toString('hex')).toBe(Buffer.from(first).toString('hex'))
  })

  it('a new tab unwraps the stored key instead of making a second identity', async () => {
    const storage = fakeStorage()
    const publish = vi.fn(async () => {})
    const first = await ensureSigningKey({ password: PASSWORD, serverSalt: SALT, publish, storage, session: fakeStorage() })

    const freshSession = fakeStorage() // storage survives, session does not
    const second = await ensureSigningKey({ password: PASSWORD, serverSalt: SALT, publish, storage, session: freshSession })

    expect(publish).toHaveBeenCalledTimes(1)
    expect(Buffer.from(second).toString('hex')).toBe(Buffer.from(first).toString('hex'))
  })

  it('publishes the verifying key, not the secret', async () => {
    const storage = fakeStorage()
    const session = fakeStorage()
    const publish = vi.fn(async () => {})
    const secret = await ensureSigningKey({ password: PASSWORD, serverSalt: SALT, publish, storage, session })

    const published = publish.mock.calls[0][0]
    expect(published).not.toBe(Buffer.from(secret).toString('base64'))
    expect(Buffer.from(published, 'base64').length).toBe(1952)
    expect(secret.length).toBe(4032)
  })

  it('does not publish a key it failed to wrap', async () => {
    const storage = fakeStorage()
    const publish = vi.fn(async () => { throw new Error('server refused') })
    await expect(
      ensureSigningKey({ password: PASSWORD, serverSalt: SALT, publish, storage, session: fakeStorage() }),
    ).rejects.toThrow()
    // Nothing half-saved: no wrapped key without a published half, and vice versa.
    expect(storage.getItem('openneutron.sig_key_public')).toBeNull()
    expect(storage.getItem('openneutron.sig_key_wrapped')).toBeNull()
  })
})
