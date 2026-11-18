import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

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
export function ThreadView({ cards, label, count, onBack, renderMessage }) {
  // The newest message arrives open: it is why the conversation was opened.
  const [open, setOpen] = useState(() => new Set(cards.length ? [String(cards[0].uid)] : []))
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
              <li key={String(card.uid)} className="overflow-hidden rounded-xl border border-line bg-card">
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
                {isOpen && (
                  <div className="border-t border-line">
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
