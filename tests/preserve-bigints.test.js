import { describe, it, expect } from 'vitest'
import { preserveBigInts } from '@/api'

// These tests exist to stop someone deleting the quoting hack as "regex patching JSON is
// bad" — it IS bad, and it is also the only reason message ids work. See
// docs/UID-ON-THE-WIRE.md for the real fix.

describe('preserveBigInts', () => {
  it('keeps a u128 uid that JSON.parse would turn into a float', () => {
    const wire = '{"uids":[231903818003946380734778029329812390800]}'
    const naive = JSON.parse(wire).uids[0]
    // Proof of the problem: the plain parse has already lost the id.
    expect(String(naive)).toContain('e+')

    const kept = preserveBigInts(wire)
    expect(kept.uids[0]).toBe('231903818003946380734778029329812390800')
  })

  it('handles uids in objects and nested arrays', () => {
    const wire = '{"uid":123456789012345678901,"path":[987654321098765432,{"to":1}]}'
    const out = preserveBigInts(wire)
    expect(out.uid).toBe('123456789012345678901')
    expect(out.path[0]).toBe('987654321098765432')
    expect(out.path[1].to).toBe(1) // short numbers stay numbers
  })

  it('leaves normal JSON alone', () => {
    const wire = '{"message":"send completed","count":3}'
    expect(preserveBigInts(wire)).toEqual({ message: 'send completed', count: 3 })
  })

  it('no longer corrupts a body with a 16-digit number after a colon', () => {
    // This was the user-visible bug: the quoting landed inside the string, the JSON stopped
    // parsing, and the message rendered as "(encrypted)". Now a well-formed response is
    // parsed as-is, so the fallback never touches it.
    const parsed = preserveBigInts('{"body":"ref: 1234567890123456 was declined"}')
    expect(parsed.body).toBe('ref: 1234567890123456 was declined')

    const plain = preserveBigInts('{"body":"card 1234567890123456 was declined"}')
    expect(plain.body).toBe('card 1234567890123456 was declined')
  })

  it('still rescues a server that sends numeric ids', () => {
    // The compatibility path: a clean parse would hand back a rounded double, so the guard
    // detects an unsafe number and re-reads with quoting.
    const numeric = preserveBigInts('{"uid":123456789012345678901}')
    expect(numeric.uid).toBe('123456789012345678901')
  })

  it('does not treat an ordinary large-but-safe number as an id', () => {
    // 1.7e9 (a timestamp) must stay a number, not become a string.
    const parsed = preserveBigInts('{"at":1795002611,"n":42}')
    expect(parsed.at).toBe(1795002611)
    expect(parsed.n).toBe(42)
  })

  it('passes non-string input through untouched', () => {
    expect(preserveBigInts({ a: 1 })).toEqual({ a: 1 })
    expect(preserveBigInts(null)).toBe(null)
  })
})
