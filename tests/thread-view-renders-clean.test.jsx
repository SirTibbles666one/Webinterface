import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// What this guards: a scripted edit once cut the card header at the `=>` of an arrow function,
// leaving the rest of the attributes inside the button body. The build passed, the deploy
// passed, and the card rendered `aria-expanded={isOpen} className="flex min-h-12…"` as content.
// A unit assertion on the rendered text catches that class of mistake in a second.
import { ThreadView } from '@/components/ThreadView'

const cards = [
  { uid: '2', sender: 'Daddysocks', when: '18 Nov', unread: true, starred: false },
  { uid: '1', sender: 'Daddysocks', when: '18 Nov', unread: false, starred: true },
]

const noop = () => {}

describe('a conversation screen', () => {
  it('renders the cards and nothing that looks like source', () => {
    const { container } = render(
      <ThreadView
        cards={cards}
        label="Order test"
        count={2}
        onBack={noop}
        renderMessage={(uid) => <p>body {uid}</p>}
        messageActions={{ toggleStar: noop, markRead: noop, markUnread: noop, remove: noop }}
      />,
    )
    const text = container.textContent || ''
    expect(text).not.toMatch(/aria-expanded=\{|className="|toggle\(card\.uid\)/)
    expect(text).toContain('Daddysocks')
    expect(screen.getAllByLabelText(/Actions for this message/)).toHaveLength(2)
  })

  it('offers the message actions a hidden reader header used to carry', () => {
    render(
      <ThreadView
        cards={cards}
        label="Order test"
        count={2}
        onBack={noop}
        renderMessage={(uid) => <p>body {uid}</p>}
        messageActions={{ toggleStar: noop, markRead: noop, markUnread: noop, remove: noop }}
      />,
    )
    // one menu per message, and the first message opens by default
    expect(screen.getAllByLabelText(/Actions for this message/)).toHaveLength(2)
    expect(document.body.textContent).toContain('Order test')
  })
})
