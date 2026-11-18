import { useState } from 'react'
import { ChevronDown, MoreHorizontal, Star, MailOpen, Mail, Trash2 } from 'lucide-react'

/**
 * A conversation, opened as its own screen.
 *
 * The list can show that a conversation exists; it cannot show what the conversation said.
 * Before this, reading the second message in a thread meant pressing back to the inbox,
 * reopening the conversation and tapping the other row — the list was a detour in the middle
 * of reading. Here every message is a closed card on one scrollable screen, and tapping a
 * card opens that message in place, so the conversation can be read straight through.
 *
 * `renderMessage(uid)` is supplied by the layout so this file stays layout-agnostic: it
 * already knows how to fetch, decrypt and render one message.
 */
export function ThreadView({ cards, label, count, onBack, renderMessage, messageActions }) {
  // The newest message arrives open: it is why the conversation was opened.
  const [open, setOpen] = useState(() => new Set(cards.length ? [String(cards[0].uid)] : []))
  // Starring, marking and deleting lived in the reader header this screen hides. Without a menu
  // of its own a conversation could be read and answered, but not tidied.
  const [menuFor, setMenuFor] = useState(null)
  const toggle = (uid) =>
    setOpen((prev) => {
      const next = new Set(prev)
      const key = String(uid)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-background"
      role="region"
      aria-label={`Conversation: ${label}`}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 max-sm:h-12 max-sm:px-2">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-11 shrink-0 items-center gap-1 pr-1.5 text-[13px] text-ink-2"
          aria-label="Back to inbox"
        >
          <span aria-hidden="true" className="text-[15px]">←</span> Inbox
        </button>
        <h1 className="display min-w-0 flex-1 truncate text-[16px] text-ink-1" title={`${label} — ${count} messages`}>
          <span className="mono text-ink-3">[{count}]</span> {label}
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <ul className="space-y-2">
          {cards.map((card) => {
            const isOpen = open.has(String(card.uid))
            return (
              <li key={String(card.uid)} className="relative overflow-hidden rounded-xl border border-line bg-card">
                <button
                  type="button"
                  onClick={() => toggle(card.uid)}
                  aria-expanded={isOpen}
                  className="flex min-h-12 w-full items-center gap-2 px-3 py-3 text-left transition-colors duration-120 active:bg-accent/60"
                >
                  <span
                    className={`truncate text-[13.5px] ${card.unread ? 'font-semibold text-ink-1' : 'text-ink-2'}`}
                    title={card.sender}
                  >
                    {card.sender || 'Unknown sender'}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-ink-3">
                    <span className="mono text-[12px] tabular-nums">{card.when}</span>
                    {card.unread && <span className="size-1.5 rounded-full bg-primary" aria-label="Unread" />}
                    <ChevronDown
                      aria-hidden="true"
                      className={`size-3.5 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </span>
                </button>

                {messageActions && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuFor((v) => (String(v) === String(card.uid) ? null : card.uid))
                    }}
                    aria-label={menuFor === card.uid ? 'Close message actions' : `Actions for this message`}
                    aria-expanded={String(menuFor) === String(card.uid)}
                    className="absolute right-1 top-1 flex size-10 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-accent hover:text-ink-1"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                )}

                {String(menuFor) === String(card.uid) && messageActions && (
                  <div className="absolute right-2 top-12 z-20 w-48 overflow-hidden rounded-lg border border-line bg-popover shadow-lg">
                    <button
                      type="button"
                      onClick={() => { messageActions.toggleStar(card.uid); setMenuFor(null) }}
                      className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-[13px] text-ink-1 hover:bg-accent"
                    >
                      <Star className={`size-4 ${card.starred ? 'text-primary' : 'text-ink-3'}`} />
                      {card.starred ? 'Unstar' : 'Star'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (card.unread) messageActions.markRead(card.uid)
                        else messageActions.markUnread(card.uid)
                        setMenuFor(null)
                      }}
                      className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-[13px] text-ink-1 hover:bg-accent"
                    >
                      {card.unread ? <MailOpen className="size-4 text-ink-3" /> : <Mail className="size-4 text-ink-3" />}
                      {card.unread ? 'Mark as read' : 'Mark as unread'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { messageActions.remove(card.uid); setMenuFor(null) }}
                      className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-[13px] text-destructive hover:bg-accent"
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </button>
                  </div>
                )}
                {isOpen && (
                  <div className="thread-card border-t border-line">
                    {renderMessage(card.uid)}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

export default ThreadView
