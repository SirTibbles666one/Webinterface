import { describe, it, expect } from 'vitest'
import { buildEmail } from '@/lib/emailBuilder'

// CWE-93. A subject, address or attachment name that contains CRLF lands in a header line, and a
// header line is a place where a newline means "and here is another header". The audit recorded
// this as unverified; these tests make it verified.
describe('header injection', () => {
  it('cannot be smuggled through a subject', () => {
    const raw = buildEmail({
      from: 'tibs@slothlee.xyz',
      to: ['qa@slothlee.xyz'],
      subject: 'Invoice\r\nBcc: victim@example.com',
      body: '<p>hi</p>',
    })
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
    const headers = text.split('\r\n\r\n')[0]
    expect(headers).not.toMatch(/^Bcc:/m)
    expect(headers).not.toMatch(/^Bcc: victim@example\.com/im)
  })

  it('cannot be smuggled through a recipient', () => {
    const raw = buildEmail({
      from: 'tibs@slothlee.xyz',
      to: ['qa@slothlee.xyz\r\nBcc: victim@example.com'],
      subject: 'hello',
      body: '<p>hi</p>',
    })
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
    expect(text.split('\r\n\r\n')[0]).not.toMatch(/^Bcc:/m)
  })

  it('cannot break out of an attachment filename', () => {
    const raw = buildEmail({
      from: 'tibs@slothlee.xyz',
      to: ['qa@slothlee.xyz'],
      subject: 'hello',
      body: '<p>hi</p>',
      attachments: [{ name: 'a"b.pdf', type: 'application/pdf', data: 'AAAA' }],
    })
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
    const line = text.split('\r\n').find((l) => l.startsWith('Content-Disposition: attachment'))
    // A quote inside a quoted filename ends the string early and lets the rest be read as a parameter.
    expect(line).toBeTruthy()
    expect((line.match(/"/g) || []).length).toBe(2)
  })

  it('leaves an ordinary message untouched', () => {
    const raw = buildEmail({ from: 'tibs@slothlee.xyz', to: ['qa@slothlee.xyz'], subject: 'Invoice for October', body: '<p>hi</p>' })
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
    expect(text).toMatch(/^Subject: Invoice for October$/m)
  })
})
