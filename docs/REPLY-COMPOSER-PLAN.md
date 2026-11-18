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
| Formatting bar appears when you start typing, not before | −61px on every reply that is a sentence |
| Expiry and "hold until" are one Options panel | Send no longer wraps to its own row at 320px; the panel is a bottom sheet on a phone |
| Signature in the body the composer opens with | a reply now leaves signed (it never did) |

Net, all measured at 390px: **chrome above the message 348px → 214px, writing area 404px → 490px.**
At 320px the bar holds one row: options, attach and Send together.

## Phase 1 — the last of the chrome (est. 100px, ~half a day)

1. ~~Formatting toolbar on demand~~ — shipped.
2. ~~One options control instead of two~~ — shipped.
3. ~~Signature~~ — shipped (it existed in Settings but was applied only to sealed notes).

Done when: chrome ≤ 200px at 390px, and a reply typed, sent and re-read shows the signature in the
right place and the quote still attached.

## Phase 2 — the quote, properly (~a day) — **1 and 2 shipped**

The CSS hidden quote was honest but blunt: it removed the quote from view entirely, and a reader
who wanted to check one line had to reveal the whole thread.

Shipped: a `blockquote` node view (`QuoteCard.jsx` + `QuoteCardNode` in `TiptapEditor.jsx`)
rendering a closed card with the attribution and a preview line, opening in place. It serialises
back to `<blockquote>` and keeps the attribution in a `data-attribution` attribute, so the reply
still carries the thread — verified through `editor.getHTML()`, not through the DOM, because a
node view renders a `div` and never shows a `<blockquote>` element.

Two approaches that failed first, both kept here because they are the obvious ones:
- hiding the attribution paragraph with `p:has(+ blockquote)` — a node view is a `div`, so the
  selector never matches;
- hiding it by a class on the paragraph — TipTap's Paragraph node keeps only the attributes it
  is told to, so the class is gone by the time CSS looks for it.
Carrying the attribution on the node is the fix: one copy, nothing to hide.

1. ~~A real quote node~~ — shipped.
2. ~~Keep the document honest~~ — shipped (`sendsBlockquote: true`).
3. **Nested quotes.** A reply to a reply currently nests quote-in-quote text verbatim. Collapse
   depth 2+ into a single "earlier messages" line.

Done when: a three-deep thread replies with one card, sending produces a `text/html` part whose
`blockquote` still contains the thread, and the card survives a save-and-reopen of the draft.

## Phase 3 — never lose a reply (~a day) — **1 and 2 shipped**

1. ~~**Send failure keeps the draft.**~~ Shipped: the error wraps to two lines instead of one
   ellipsised line and carries a **Try again** control. Proven with a real refused recipient —
   `550 RCPT TO rejected` — with the composer open and the text intact.
2. ~~**Draft autosave indicator.**~~ Shipped: a draft is written a beat after typing stops (it was
   only written when the composer closed, so a failed send plus a closed tab lost the message) and
   **Saved** appears beside the subject — with the time on a desktop, the word alone on a phone.
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
