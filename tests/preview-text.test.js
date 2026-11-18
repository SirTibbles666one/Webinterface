import { describe, it, expect } from 'vitest'
import { htmlToText } from '@/lib/text'

// The Drafts list showed `<p>the vault code is …</p>` because the preview sliced HTML.
describe('a preview line', () => {
  it('reads markup as the sentence inside it', () => {
    expect(htmlToText('<p>the vault code is 8891-zulu</p>')).toBe('the vault code is 8891-zulu')
  })

  it('keeps words apart across block boundaries', () => {
    expect(htmlToText('<p>one</p><p>two</p>')).toBe('one two')
    expect(htmlToText('a<br>b')).toBe('a b')
  })

  it('decodes the entities a composer actually produces', () => {
    expect(htmlToText('Tom &amp; Jerry&nbsp;inc')).toBe('Tom & Jerry inc')
    expect(htmlToText('&lt;tag&gt;')).toBe('<tag>')
  })

  it('is empty for an empty draft, not the string "undefined"', () => {
    expect(htmlToText(undefined)).toBe('')
    expect(htmlToText('')).toBe('')
  })
})
