import { describe, it, expect } from 'vitest'
import { leafHash, rootFromPath } from '@/kt'

// The pinning property: a leaf recorded before signing keys existed must hash exactly as
// it always did, or every client's pinned head would see history rewritten at the same
// size — which is indistinguishable from an attack.
const b64 = (bytes) => Buffer.from(Uint8Array.from(bytes)).toString('base64')

const base = {
  seq: 3,
  account: 'qa@slothlee.xyz',
  rsa: b64(new Array(32).fill(9)),
  pq: b64(new Array(32).fill(4)),
}

describe('key transparency leaf versions', () => {
  it('hashes a leaf without a signing key exactly as v1 did', () => {
    // Independent reimplementation of the v1 formula, so this is a real cross-check rather
    // than the function agreeing with itself.
    const enc = new TextEncoder()
    const name = enc.encode(base.account)
    const cat = (...parts) => {
      const total = parts.reduce((n, p) => n + p.length, 0)
      const out = new Uint8Array(total)
      let at = 0
      for (const p of parts) { out.set(p, at); at += p.length }
      return out
    }
    const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
    const u16 = (n) => new Uint8Array([(n >> 8) & 255, n & 255])
    const bytes = cat(
      enc.encode('kt/v1/leaf'),
      u32(base.seq),
      u16(name.length),
      name,
      new Uint8Array(Buffer.from(base.rsa, 'base64')),
      new Uint8Array(Buffer.from(base.pq, 'base64')),
    )
    // Same digest as the exported helper, via the platform's SHA-256.
    return crypto.subtle.digest('SHA-256', bytes).then((digest) => {
      expect(Buffer.from(leafHash(base)).toString('hex')).toBe(Buffer.from(digest).toString('hex'))
    })
  })

  it('moves to the v2 label only when a signing key hash is present', () => {
    const v1 = Buffer.from(leafHash(base)).toString('hex')
    const v2 = Buffer.from(leafHash({ ...base, sig: b64(new Array(32).fill(7)) })).toString('hex')
    expect(v2).not.toBe(v1)

    // Adding the field back must reproduce the same hash: the hash is a function of the
    // content, not of when it was computed.
    const again = Buffer.from(leafHash({ ...base, sig: b64(new Array(32).fill(7)) })).toString('hex')
    expect(again).toBe(v2)
  })

  it('a different signing key hash is a different leaf', () => {
    const a = Buffer.from(leafHash({ ...base, sig: b64(new Array(32).fill(7)) })).toString('hex')
    const b = Buffer.from(leafHash({ ...base, sig: b64(new Array(32).fill(8)) })).toString('hex')
    expect(a).not.toBe(b)
  })

  it('a single-leaf tree still folds to its own hash', () => {
    const leaf = leafHash(base)
    expect(Buffer.from(rootFromPath(leaf, 0, 1, [])).toString('hex')).toBe(Buffer.from(leaf).toString('hex'))
  })
})
