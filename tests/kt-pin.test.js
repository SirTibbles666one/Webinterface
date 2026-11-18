import { describe, it, expect } from 'vitest'
import { isPinnedSigner, verifyHeadSignature, verifyProof } from '@/kt'
import { KT_PINNED_KEYS } from '@/ktPinnedKey'

// The hole this closes: verifyHeadSignature used to verify against head.pk — the key
// travelling in the same response as the head. A server could mint its own key, sign its
// own head, and every check passed. These tests pin the refusal.
const PINNED = KT_PINNED_KEYS[0]
const OTHER = Buffer.from(new Uint8Array(1952).fill(7)).toString('base64')

describe('key transparency signer pinning', () => {
  it('accepts the key this build ships', () => {
    expect(isPinnedSigner(PINNED)).toBe(true)
    expect(isPinnedSigner({ pk: PINNED })).toBe(true)
  })

  it('refuses any other key, however well-formed', () => {
    expect(isPinnedSigner(OTHER)).toBe(false)
    expect(isPinnedSigner({ pk: OTHER })).toBe(false)
  })

  it('compares decoded bytes, not strings — re-encoding cannot sneak past', () => {
    const withPadding = PINNED.replace(/=+$/, '')
    // Same key, different base64 spelling: still the pinned one.
    expect(isPinnedSigner(withPadding)).toBe(true)
  })

  it('refuses missing or malformed keys instead of throwing', () => {
    expect(isPinnedSigner(null)).toBe(false)
    expect(isPinnedSigner({})).toBe(false)
    expect(isPinnedSigner('not base64 !!!')).toBe(false)
  })

  it('will not verify a head signed by a key it does not trust', () => {
    const head = { alg: 'ml-dsa-65', pk: OTHER, root: 'AAAA', sig: 'AAAA', size: 1 }
    expect(verifyHeadSignature(head)).toBe(false)
  })

  it('reports the unpinned signer as its own reason, before the signature is judged', () => {
    const proof = {
      leaf: { address: 'a@b', key: 'AAAA' },
      index: 0,
      path: [],
      head: { alg: 'ml-dsa-65', pk: OTHER, root: 'AAAA', sig: 'AAAA', size: 1 },
    }
    const result = verifyProof(proof)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('kt_signer_unpinned')
  })
})
