import { describe, it, expect } from 'vitest'
import { bytesToBinaryString, binaryStringToBytes, toBase64, fromBase64, utf8ToBase64 } from '@/lib/bytes'

// Speed was the reason for this module; correctness is the reason it can ship.
describe('linear binary conversion', () => {
  it('round-trips every byte value', () => {
    const all = new Uint8Array(256).map((_, i) => i)
    expect(Array.from(binaryStringToBytes(bytesToBinaryString(all)))).toEqual(Array.from(all))
  })

  it('survives a chunk boundary', () => {
    // 8192 is the chunk size: check both sides of the seam, and a length that is not a multiple
    const size = 8192 * 3 + 7
    const bytes = new Uint8Array(size).map((_, i) => (i * 31) & 0xff)
    const back = fromBase64(toBase64(bytes))
    expect(back.length).toBe(size)
    expect(back[8191]).toBe(bytes[8191])
    expect(back[8192]).toBe(bytes[8192])
    expect(back[size - 1]).toBe(bytes[size - 1])
  })

  it('agrees with btoa on a large buffer', () => {
    const bytes = new Uint8Array(1024 * 512).map((_, i) => i & 0xff)
    let reference = ''
    for (let i = 0; i < bytes.length; i += 1) reference += String.fromCharCode(bytes[i])
    expect(toBase64(bytes)).toBe(btoa(reference))
  })

  it('encodes UTF-8 the way the MIME headers expect', () => {
    expect(utf8ToBase64('héllo')).toBe(btoa('h\u00c3\u00a9llo'))
  })
})
