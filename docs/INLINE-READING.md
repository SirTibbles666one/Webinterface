# Inline reading (superseded)

**Status: removed 18 Nov 2026, on the owner's report.** Inline reading opened a message *inside its
own row*, which kept the rest of the list above and below and left the body a ~250 px window — mail
was cut off mid-sentence on his phone. A phone now opens a message **full screen**, in the same
container the desktop pane uses, with its own back control, a 15.5 px body and the reply bar pinned
to the bottom. The floating compose button that existed only to compensate for the hidden bar is gone
with it. The parity manifest carries this as `fullscreen-reading` (with `replaces: inline-reading`)
rather than deleting the entry.

What follows is the original design record, kept because the reasoning about row height, the
`block`-not-`flex` fix and the 42vh body cap still explains why the inline version looked the way it did.

---


Status: **built and verified** (see "What shipped" at the end).

## What is asked for

On a phone, tapping a message should expand it **in place** in the list — header,
body, and its own action row — instead of replacing the screen with a reader you
back out of. The list stays scrollable, and the next message is one tap away.
Compose becomes a floating action rather than a bar.

The reference (Proton Mail on Android) shows: collapsed rows carrying sender, time,
star/attachment marks; the open row expands to a header (lock, sender, address, To
row), a compact action row (archive/trash/more, reply/reply-all/forward), the body
in a white card, and an attachment strip with sizes. A floating compose button
sits over the list.

## Why it is not a resize

Today the two form factors take different paths in `AuthorizedLayout`:

- **desktop**: `selectedUid` fills a right-hand pane with `EmailView`
- **phone**: `selectedUid` replaces the list with `EmailView` and adds a back control

`EmailView` fetches, decrypts, renders HTML in a sandboxed iframe and owns the
action bar. Inline reading needs that same component **inside** the list's scroll
flow, for exactly one row, without its own scroll container.

## Shape of the change

1. `EmailList` gains two props: `inlineUid` and `inlineSlot`. After rendering the row
   whose uid matches, it renders `inlineSlot` — nothing else changes, no row gains
   height unless it is the open one.
2. `EmailView` gains a `variant="inline"` that drops its `ScrollArea` and the back
   control, keeps the header/body/attachments, and caps its height so one long
   message cannot swallow the list.
3. `AuthorizedLayout` picks the variant by form factor: desktop keeps the pane;
   phone passes `inlineUid={selectedUid}` and stops rendering the full-screen reader.
4. The phone compose bar becomes a floating action in the same slice — a bottom bar
   plus an inline open row is two things competing for the same edge.

## Acceptance

- Tapping row N opens exactly one inline body, directly under row N, and the rows
  above and below keep their positions (measure row rects before/after; the open row
  may grow, nothing above it may move).
- Tapping it again collapses it; tapping another row closes the first.
- Scrolling with a message open does not jump: the open row stays anchored.
- No horizontal overflow at 320/390/430, every control ≥ 44 px, and the action row
  fully inside the viewport (measure `rect.right`, not `scrollWidth`).
- Reader height cap: a long message scrolls inside its own block, not the page.
- Desktop is untouched — same two-pane behaviour, same measurements.
- The parity gate gains the strings this introduces, so the feature cannot be lost
  in a later rebuild.

## Risks

- `EmailView`'s decrypt path runs per open row; opening/closing quickly must not
  leave a stale body rendered under the wrong row (`key={uid}` on the slot).
- The HTML body renders in an iframe sized by its own measure; inside a growing row
  the resize observer must be told the width changed.
- Two scroll containers (list + body) fight on touch; the body must not scroll the
  page when it reaches its end (`overscroll-behavior: contain`).

## What shipped

`EmailList` takes `inlineUid` + `inlineSlot` and renders the slot directly under the
matching row (single messages and threads both). `EmailView` takes `inline`, which
drops the back control, caps the body at 62vh and keeps the action row inside the
block instead of pinning it to the viewport. `AuthorizedLayout` picks the shape by
`matchMedia('(max-width: 767px)')` and renders one reader through a single
`renderReader(inline)` function, so the two homes cannot drift apart.

Measured at 390 on the deployed build: tapping row 1 grew it and pushed the rows
below down 457px while **its own top stayed at 201** — nothing above it moved; the
body text rendered; `Close` collapsed it; opening a second message left exactly one
open block; document overflow 0. At 1440 the pane is unchanged and there is no
inline block at all.

The header bar is gone: tapping the open row again collapses it, which is both the
Proton gesture and one control instead of two. With the bar absent, composing became
unreachable, so a floating action (56px, bottom-right, above the safe area) appears
while a message is open. Verified at 390: FAB at right 374 in a 390 viewport, tap the
row to collapse, FAB opens the composer.

## What a conversation card says before it is opened

A card is read to answer three questions without opening it, and each one has a line:

- **Who and when** — sender, then the clock (or the day and clock for anything not today).
- **Did it carry files** — a clip and a count, on that message only. Opening every card to find the
  attachment was the alternative.
- **Which message is this** — the subject, but only when it differs from the thread's title. A
  repeated subject is noise; a different one is the whole point.

And one line belongs to the list rather than a card: **`New`** sits above the first unread message,
once. With the newest message open by default, nothing else marks where reading stopped.

Four tests in `tests/thread-view-badges.test.jsx` hold these, including the negative case: a fully
read conversation shows no `New` line at all.
