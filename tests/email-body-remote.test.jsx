import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { EmailBody, prepareMail } from '@/components/email/EmailBody'

// A remote <img> is a read receipt: it tells the sender you opened the message, when,
// and from which IP. These tests pin both halves of the promise — nothing is fetched
// until asked, and the sender's images come back when asked for.
const REMOTE_IMG = '<p>Hello</p><img src="https://tracker.example/open.gif" width="1" height="1" alt="">'

const prepare = (html, allowRemote = false) =>
  prepareMail(html, { senderThemed: false, allowRemote })

describe('prepareMail withholds remote content', () => {
  it('replaces a remote image source and keeps the original', () => {
    const { html, blocked } = prepare(REMOTE_IMG)

    expect(blocked).toBe(1)
    // The URL may survive in data-sloth-remote-src; no src may still point at it.
    expect(html).not.toMatch(/\ssrc="https?:\/\/tracker/)
    expect(html).toContain('data:image/gif;base64')
    expect(html).toContain('data-sloth-remote-src="https://tracker.example/open.gif"')
  })

  it('puts the sender image back when the reader allows it', () => {
    const { html, blocked } = prepare(REMOTE_IMG, true)

    expect(blocked).toBe(0)
    expect(html).toContain('https://tracker.example/open.gif')
  })

  it('leaves data: images alone — they cannot call out', () => {
    const inline = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="">'
    const { html, blocked } = prepare(inline)

    expect(blocked).toBe(0)
    expect(html).toContain('data:image/png;base64')
  })

  it('blocks a CSS url() background as well as an <img>', () => {
    const { html, blocked } = prepare('<div style="background-image:url(https://tracker.example/bg.png)">x</div>')

    expect(blocked).toBe(1)
    // The declaration may survive inside data-sloth-remote-style; the live style may not.
    expect(html).not.toMatch(/ style="[^"]*url\(\s*['"]?https?:/)
  })

  it('blocks a legacy background attribute', () => {
    const { blocked } = prepare('<table background="https://tracker.example/b.png"><tr><td>x</td></tr></table>')
    expect(blocked).toBe(1)
  })
})

describe('EmailBody tells the reader what it withheld', () => {
  it('shows the notice and offers the choice', () => {
    const { container } = render(<EmailBody htmlBody={REMOTE_IMG} />)
    const text = container.textContent || ''
    expect(text).toMatch(/1 remote image was blocked/i)
    expect(text).toMatch(/Show images/i)
  })

  it('does not warn when there is nothing remote', () => {
    const { container } = render(<EmailBody htmlBody="<p>plain</p>" />)
    expect(container.textContent || '').not.toMatch(/blocked/i)
  })
})
