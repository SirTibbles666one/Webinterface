import { describe, it, expect } from 'vitest'
import {
  packV2, unpack, splitPayload, signEnvelope, verifyEnvelope, recipientSetHash,
} from '@/lib/msgSign'

// A stand-in for ML-DSA-65: these tests are about the envelope and the signed bytes, not
// about the algorithm. Signing with a real post-quantum key is covered by the live check.
const key = new Uint8Array(32).fill(11)
const sign = (k, message) => {
  // Deterministic toy signature: the point is that it changes with the message.
  let h = 0
  for (const b of message) h = (h * 31 + b) % 2147483647
  return new Uint8Array([0xaa, ...new Uint8Array(31).fill(h & 0xff)])
}
const verify = (k, signature, message) => {
  const expected = sign(k, message)
  return signature.length === expected.length && signature[0] === 0xaa &&
    signature[31] === (() => { let h = 0; for (const b of message) h = (h * 31 + b) % 2147483647; return h & 0xff })()
}

const base = {
  payload: new Uint8Array([...new Uint8Array(12).fill(3), ...new Uint8Array(24).fill(9)]),
  privateKey: key,
  publicKey: key,
  sign,
  verify,
  recipients: ['Qa@slothlee.xyz', 'b@example.com'],
  sender: 'qa@slothlee.xyz',
  sentAt: 1_700_000_000,
}

describe('message signatures', () => {
  it('a signed envelope verifies against the same sender and recipients', () => {
    const sealed = signEnvelope(base)
    expect(verifyEnvelope({ ...base, payload: sealed })).toBe('verified')
  })

  it('keeps the original payload byte-identical inside the envelope', () => {
    const sealed = signEnvelope(base)
    const read = unpack(sealed)
    expect(Buffer.from(read.payload).toString('hex')).toBe(Buffer.from(base.payload).toString('hex'))
    expect(read.signature.length).toBeGreaterThan(0)
  })

  it('a message with no envelope is unsigned, not invalid', () => {
    // A v1 message: a reader must be able to tell "old format" from "forged".
    expect(verifyEnvelope({ ...base, payload: base.payload })).toBe('unsigned')
    expect(unpack(base.payload).signature).toBeNull()
  })

  it('re-encrypting the same plaintext invalidates the signature', () => {
    const sealed = signEnvelope(base)
    const read = unpack(sealed)
    const { iv, ciphertext } = splitPayload(read.payload)
    const tampered = new Uint8Array(read.payload)
    tampered[12] ^= 0xff // flip a ciphertext byte
    const rebuilt = packV2(tampered, read.signature)
    expect(iv.length).toBe(12)
    expect(ciphertext.length).toBe(24)
    expect(verifyEnvelope({ ...base, payload: rebuilt })).toBe('invalid')
  })

  it('replaying the ciphertext to another recipient set is invalid', () => {
    const sealed = signEnvelope(base)
    expect(verifyEnvelope({ ...base, payload: sealed, recipients: ['mallory@example.com'] })).toBe('invalid')
  })

  it('re-attributing the message to another sender is invalid', () => {
    const sealed = signEnvelope(base)
    expect(verifyEnvelope({ ...base, payload: sealed, sender: 'tibs@slothlee.xyz' })).toBe('invalid')
  })

  it('changing the timestamp is invalid', () => {
    const sealed = signEnvelope(base)
    expect(verifyEnvelope({ ...base, payload: sealed, sentAt: base.sentAt + 1 })).toBe('invalid')
  })

  it('without the sender key the message is unsigned, not trusted', () => {
    const sealed = signEnvelope(base)
    expect(verifyEnvelope({ ...base, payload: sealed, publicKey: null })).toBe('unsigned')
  })

  it('recipient order and casing do not change the hash', () => {
    const a = recipientSetHash(['B@example.com', 'a@example.com'])
    const b = recipientSetHash([' a@example.com', 'b@example.com', 'B@EXAMPLE.COM'])
    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'))
  })

  it('a truncated envelope is invalid rather than an exception', () => {
    const sealed = signEnvelope(base)
    expect(verifyEnvelope({ ...base, payload: sealed.slice(0, sealed.length - 5) })).toBe('invalid')
    expect(verifyEnvelope({ ...base, payload: sealed.slice(0, 6) })).toBe('invalid')
  })
})
