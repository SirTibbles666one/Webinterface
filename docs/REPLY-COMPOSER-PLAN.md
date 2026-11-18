# The reply composer: plan

Written after the owner reported the reply screen as "overcrowded and too large", and then that
it opened with "no box ready for a reply". Both were measured at 390px, not guessed.

## Shipped

| change | measured |
|---|---|
| Recipient shows as one line (`To: … edit`), tap to edit | To row 182px → 44px |
| `From:` row only when there is more than one identity to choose between | 0px for single-identity accounts |
| A reply opens on an empty paragraph with the caret in it | first child is an empty `p`, `caretAtStart: true` |
| The quote is hidden behind **Show quoted text** — still in the document, so still sent | `quoteInDocument: true`, `quoteVisible: false`, toggling restores it |
| Tighter OpenPGP row | 57px → 49px |

Net: chrome above the message 348px → 275px, writing area 404px → 477px.

## Phase 1 — the last of the chrome (est. 100px, ~half a day)

1. **Formatting toolbar on demand.** It costs 61px on every reply for tools most replies never
   use. Show it once the editor has focus, or behind a "Formatting" toggle, and it disappears from
   a reply that is just a sentence.
2. **One options control instead of two.** "No expiry" (a select) and the clock (a popover) are
   two controls for one idea on the phone's bottom bar — ~40px. Fold both into a single "Options"
   sheet: expiry, scheduled send.
3. **Signature.** There is none. Replies should start `— Tibs` above the quote, per identity, and
   it must be editable in Settings and excluded from the empty-box rule (the box comes first, the
   signature under it).

Done when: chrome ≤ 200px at 390px, and a reply typed, sent and re-read shows the signature in the
right place and the quote still attached.

## Phase 2 — the quote, properly (~a day)

The CSS hidden quote is honest but blunt: it removes the quote from view entirely, and a reader
who wants to check one line must reveal the whole thread.

1. **A real quote node.** Register a `blockquote`-wrapping node view that renders a closed card —
   `On 18 Nov 2026, Ines Novak wrote` plus the first line, and an expand control. This is the
   piece the earlier inline-reading work deferred; it is the difference between hiding the thread
   and summarising it.
2. **Keep the document honest.** The card must still serialise to `<blockquote>` on send, or
   replies start arriving without the thread they answer.
3. **Nested quotes.** A reply to a reply currently nests quote-in-quote text verbatim. Collapse
   depth 2+ into a single "earlier messages" line.

Done when: a three-deep thread replies with one card, sending produces a `text/html` part whose
`blockquote` still contains the thread, and the card survives a save-and-reopen of the draft.

## Phase 3 — never lose a reply (~a day)

1. **Send failure keeps the draft.** A failed send must leave the composer open with the text
   intact and a retry control; today a failure is reported but the recovery path is manual.
2. **Draft autosave indicator.** Drafts exist (`draftId`, `onDeleteDraft`), but nothing says when
   the text was last saved. One line: "Saved 14:32".
3. **Undo send.** A 5-second window in which the message is held and can be recalled — this needs
   a server-side hold (the scheduled-send path already delays delivery, so the mechanism exists).
4. **Keyboard-aware footer.** On Android the keyboard covers the footer on some devices; anchor it
   with `visualViewport` so Send stays reachable with the keyboard open.

Done when: killing the tab mid-reply loses nothing, a forced send failure is recoverable in one
tap, and Send is tappable with the keyboard open at 390px.

## Not planned, deliberately

- **Rich text beyond the current set** — bold, italic, underline, strike, lists and links cover
  mail that arrives in practice; more formatting is more ways to send something unreadable.
- **Inline images in the body** — attachments cover the need and inline images are the single most
  common way a message renders differently in every client.
- **Sending HTML by hand** — the editor owns the HTML; a raw view invites mismatched tags.
