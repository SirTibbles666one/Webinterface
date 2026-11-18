import { describe, it, expect, afterEach, vi } from 'vitest'
import { encryptEmail } from '@/crypto'

// The one place in the app that must fail closed. It used to fall back to Math.random for the AES
// key and IV when crypto.getRandomValues was missing, which produces something that looks like
// ciphertext and is not.
describe('randomness', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('refuses to encrypt without a real random source', async () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { ...real, getRandomValues: undefined })
    await expect(encryptEmail('<p>hi</p>', null)).rejects.toThrow(/secure random numbers/i)
    vi.stubGlobal('crypto', real)
  })
})
