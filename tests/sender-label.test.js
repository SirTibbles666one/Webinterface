import { describe, it, expect } from 'vitest'
import { senderLabelFor } from '@/lib/senderLabel'

// Both bugs that reached production were in this rule: a cell that showed preview text, and a
// draft row that showed its own id where a name belongs.
describe('what a row calls its sender', () => {
  it('prefers the display name, then the address', () => {
    expect(senderLabelFor({ from: { name: 'Daddysocks', email: 'a@b.c' } }, '1')).toBe('Daddysocks')
    expect(senderLabelFor({ from: { name: '', email: 'a@b.c' } }, '1')).toBe('a@b.c')
    expect(senderLabelFor({ from: { name: null, email: 'a@b.c' } }, '1')).toBe('a@b.c')
  })

  it('never renders the string "null"', () => {
    expect(senderLabelFor({ from: { name: 'null', email: '' } }, 'draft_9')).toBe('Draft')
    expect(senderLabelFor({ from: { name: undefined, email: 'undefined' } }, '7')).toBe('7')
  })

  it('calls a recipient-less draft Draft, not by its id', () => {
    expect(senderLabelFor({ from: { name: '', email: '' } }, 'draft_1795045951884')).toBe('Draft')
  })

  it('falls back to the id for a message with no sender at all', () => {
    expect(senderLabelFor(undefined, '42')).toBe('42')
    expect(senderLabelFor({}, '42')).toBe('42')
    expect(senderLabelFor({}, undefined)).toBe('Unknown')
  })
})
