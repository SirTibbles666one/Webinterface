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

  it('KNOWN FLAW: a 16-digit run after a colon inside text is quoted too', () => {
    // Documented, not celebrated. The trigger is narrow but real: only digits that follow
    // `:`, `,` or `[` — so "card 1234…" survives while "ref: 1234…" is corrupted. This is
    // the concrete reason the server should send uids as strings.
    // The quoting lands INSIDE the string, so the JSON becomes unparseable and the whole
    // response is handed back as raw text — which is how a message with such a line ends
    // up rendering as "(encrypted)" instead of its contents.
    const broken = preserveBigInts('{"body":"ref: 1234567890123456 was declined"}')
    expect(typeof broken).toBe('string')

    const fine = preserveBigInts('{"body":"card 1234567890123456 was declined"}')
    expect(fine.body).toBe('card 1234567890123456 was declined')
  })

  it('passes non-string input through untouched', () => {
    expect(preserveBigInts({ a: 1 })).toEqual({ a: 1 })
    expect(preserveBigInts(null)).toBe(null)
  })
})
