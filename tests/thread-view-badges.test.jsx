import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThreadView } from '@/components/ThreadView'

const noop = () => {}
const actions = { toggleStar: noop, markRead: noop, markUnread: noop, remove: noop }

const renderThread = (cards) =>
  render(
    <ThreadView
      cards={cards}
      label="Invoice"
      count={cards.length}
      onBack={noop}
      renderMessage={(uid) => <p>body {uid}</p>}
      messageActions={actions}
    />,
  )

describe('what a conversation card says without being opened', () => {
  it('shows a clip only on the message that carried files', () => {
    renderThread([
      { uid: '3', sender: 'Daddysocks', when: '21:37', unread: false, starred: false, attachments: 2, subject: '' },
      { uid: '2', sender: 'Daddysocks', when: '20:12', unread: false, starred: false, attachments: 0, subject: '' },
      { uid: '1', sender: 'Daddysocks', when: '18:38', unread: false, starred: false, attachments: 0, subject: '' },
    ])
    // exactly one message had attachments, so exactly one clip and one count
    expect(screen.getAllByText(/2 attachments/)).toHaveLength(1)
  })

  it('shows a subject only when it differs from the conversation title', () => {
    renderThread([
      { uid: '2', sender: 'Daddysocks', when: '21:37', unread: false, starred: false, attachments: 0, subject: 'Something else entirely' },
      { uid: '1', sender: 'Daddysocks', when: '18:38', unread: false, starred: false, attachments: 0, subject: '' },
    ])
    expect(screen.getByText('Something else entirely')).toBeTruthy()
  })

  it('marks where unread begins, once, above the first unread message', () => {
    renderThread([
      { uid: '3', sender: 'Daddysocks', when: '21:37', unread: false, starred: false, attachments: 0, subject: '' },
      { uid: '2', sender: 'Daddysocks', when: '20:12', unread: true, starred: false, attachments: 0, subject: '' },
      { uid: '1', sender: 'Daddysocks', when: '18:38', unread: true, starred: false, attachments: 0, subject: '' },
    ])
    expect(screen.getAllByLabelText('Unread messages start here')).toHaveLength(1)
  })

  it('says nothing about new mail when everything is read', () => {
    renderThread([
      { uid: '2', sender: 'Daddysocks', when: '21:37', unread: false, starred: false, attachments: 0, subject: '' },
      { uid: '1', sender: 'Daddysocks', when: '18:38', unread: false, starred: false, attachments: 0, subject: '' },
    ])
    expect(screen.queryByLabelText('Unread messages start here')).toBeNull()
  })
})
