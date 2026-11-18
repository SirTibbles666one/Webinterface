import { describe, it, expect } from 'vitest'
import { wireBytesFor, WIRE_MULTIPLIER, MAX_TOTAL_ATTACHMENT_BYTES, MAX_REQUEST_BYTES } from '@/lib/mime'

// These constants exist because the app promised 25 MB per file while the wire carried 3.65x that,
// so an attachment the UI had accepted could never be sent. The numbers below are the guard.
describe('the attachment budget', () => {
  it('counts what the server receives, not what was picked', () => {
    expect(wireBytesFor(10 * 1024 * 1024)).toBe(Math.ceil(10 * 1024 * 1024 * WIRE_MULTIPLIER))
  })

  it('keeps a full message inside the request cap', () => {
    expect(wireBytesFor(MAX_TOTAL_ATTACHMENT_BYTES)).toBeLessThan(MAX_REQUEST_BYTES)
  })

  it('fits the 21.5 MB file that failed in production, because the cap moved', () => {
    const picked = Math.round(21.5 * 1024 * 1024)
    // It left the browser as ~78 MB against a 40 MB cap: accepted by the UI, impossible to send.
    expect(wireBytesFor(picked)).toBeGreaterThan(40 * 1024 * 1024)
    // With the cap at 96 MB it fits, so the attachment the reader picked is the one that sends.
    expect(wireBytesFor(picked)).toBeLessThan(MAX_REQUEST_BYTES)
    expect(picked).toBeLessThan(MAX_TOTAL_ATTACHMENT_BYTES)
  })

  it('refuses what even the raised caps cannot carry', () => {
    const tooMuch = MAX_TOTAL_ATTACHMENT_BYTES + 1024 * 1024
    expect(wireBytesFor(tooMuch)).toBeGreaterThan(MAX_TOTAL_ATTACHMENT_BYTES * 3)
  })
})
