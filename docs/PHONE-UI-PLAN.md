# Phone plan for the mail client

Written after driving the live site at 320×640, 390×844 and 430×932 with a real
touch-emulated browser, measuring every control's own bounding rect and reading
screenshots. Numbers below are measured, not estimated.

---

## 1. What the audit found

### The one defect class that mattered

**Thirty-one controls on the inbox were below the 44 px thumb floor** at every phone
width — the same 31 at 320, 390 and 430, because these were desktop sizes that no
breakpoint touched: folder button 36×36, search field 36 tall, account chip 58×36,
filter chips 38×34 / 66×34 / 53×34, refresh 34×34, per-row select 36×36, star 34×34,
overflow 34×34. Nothing overflowed, so no screenshot looked broken, and no overflow
check would ever have caught it. A thumb landing three pixels wide hits the row
behind the button and opens a message instead.

### What the screenshots caught that geometry could not

| Screen | Defect |
|---|---|
| Inbox banner | "2 things not set up yet — Recovery …" truncated **the answer** at 390: the one line that tells you what is missing hid the list of what is missing |
| Settings strip | 14 sections in a 1403 px horizontal strip; the last tab sat past the edge, the strip had 16 px of trailing padding so it could not be scrolled clear, and the active section was usually off-screen |
| Folder drawer | No close control at all — the only exit was a tap on a 100 px dimmed strip or the system back gesture |
| Reader | Reply sat above the subject, mobile actions were 32×32, and the reader had no bottom action area at all |
| Compose | At 320 px the formatting toolbar pushed "Add Link" **fully off-screen** (left 320, right 364) |
| Compose | The self-delete control was labelled **"Keeps"** — a word that names nothing, on the control that decides whether the message survives |
| Settings | The signature textarea showed a desktop resize grip on a phone |

### Structural findings (not fixable by padding)

1. **The settings strip is not a tab bar and pretends to be one.** It scrolls like
   tabs, highlights like tabs, and then shows every section stacked below — so the
   selected pill contradicts the page. Fourteen items in a scroller with no index is
   the single worst navigation surface on the phone.
2. **Card-in-card.** The profile form sits in a bordered card inside a bordered
   section card; the double border reads as a rendering mistake at 390 px.
3. **Duplicate heading.** The active tab ("Profile") repeats the section heading
   immediately below it.
4. **Unread is colour-only** (a green dot), and the dot aligns to the subject line
   rather than the sender line, so it reads as a bullet.

---

## 2. What changed in this pass

All of it deployed and re-measured; the numbers are the post-change values.

- **One rule for icon targets instead of twenty patches.** Phones get
  `button:has(> svg:only-child) { min-width: 44px; min-height: 44px }`, so a control
  whose only content is an icon is a thumb target everywhere — including screens
  written after this pass. Controls with a label are untouched.
- **Text, link and input controls that the rule cannot reach** were lifted
  individually: search field, account chip, filter chips (min-width too, so "All"
  is not a 38 px target), row select checkbox, setup-strip disclosure and dismiss,
  reader reply, compose send, sidebar rows on the drawer, the settings "Mail" back
  link, the profile Save button.
- **The banner wraps instead of truncating** on phones (two lines, chevron aligned to
  the first line), because the only line that says what is missing must not hide it.
- **The settings strip** got 40 px trailing padding (the last tab now clears the edge
  at 350 of 390), 44 px link rows, and a follow-the-scroll behaviour so the active
  section is always on screen.
- **The drawer has a close button** (44×44, top right).
- **The compose toolbar wraps** below the breakpoint rather than clipping its last
  control, and the recipient/subject fields, the expiry select and Send are full
  thumb targets.
- **"Keeps" → "No expiry"**, which is what the control actually decides.

### Measured result

| Screen | Before (390) | After (320/390/430) |
|---|---|---|
| Inbox | 31 controls < 44 px | **0** · no overflow |
| Reader | 6 controls < 44 px | **0** · no overflow |
| Compose | 49 < 44 px, 5 under-sized fields, "Add Link" off-screen at 320 | **0** · no overflow |
| Drawer | no close control | **0** · close present |
| Settings | 4 < 44 px, last tab unreachable | **1**, and it is prose |
| Last settings tab | past the edge | right edge **350** < 390 after scrolling |

The one remaining sub-44 target is the word "Import" inside an export sentence — an
inline link in running text. It is deliberately not padded: a 44 px box inside a
sentence breaks the paragraph. It keeps hover underline and is not a primary path.

---

## 3. What is left, in build order

Each slice below is independently shippable and ends with the same proof: measured
at 320/390/430, screenshotted at 390 and 1440, no overflow, targets at 44.

**Slice 1 — Settings navigation (highest value).**
Replace the 14-item strip with a phone-shaped index: a two-column grid of section
names under the page title, groups labelled (Account · Security · Data · Danger),
and the sections themselves reachable one tap away. Keep the desktop rail as it is.
The strip exists because anchors were cheaper than a screen; on a phone it costs the
reader the ability to find "Export" at all.
*Done when:* every section is visible without horizontal scrolling, and the last
group (Delete account) is reachable in one tap.

**Slice 2 — Flatten the settings cards.**
One card per section, fields inside it, no inner card. Suppress the duplicated
section heading on phones (the active nav row already says it).
*Done when:* no section renders a bordered box inside a bordered box, and each
screen shows one heading at the top.

**Slice 3 — Reader action bar.**
A sticky bottom bar on phones — Reply, Reply all, Forward — above the safe-area
inset. The top-right icon cluster stays for star/delete/more, but the primary verb
must be reachable with a thumb without scrolling, and the reply arrow must stop
looking like the back arrow.
*Done when:* with a long message scrolled to the bottom, Reply is on screen at 390.

**Slice 4 — Unread state.**
Weight plus a dot aligned to the sender line, and an accessible name so colour is not
the only carrier. Keep the row's selected tint separate from the unread tint.
*Done when:* screenshots in grayscale still distinguish unread rows.

**Slice 5 — List rhythm.**
Dates are three widths ("Oct 21", "Aug 14, 24", a time); fix the column so the sender
column stops re-flowing row to row. Then a consistent row rhythm (single padding
scale, avatar size, gap).
*Done when:* the date column is one width across a mixed inbox.

**Slice 6 — Phone-specific affordances that do not exist yet.**
Pull-to-refresh on the list; safe-area insets on the compose sheet footer and the
drawer; a keyboard-avoiding compose body (`100dvh` minus the visual viewport, so the
Send button is not under the iOS keyboard); swipe-to-archive only if it gets an
undo — otherwise leave it out.

**Slice 7 — The proof, in CI.**
Today's measurements were run by hand. Add a `phone` leg to the proof runner: a
headless Chromium at 390×844 with `isMobile: true, hasTouch: true` that loads
inbox / reader / compose / settings / drawer, asserts `scrollWidth <= innerWidth`,
asserts every interactive element's rect is ≥44 in both dimensions (with an explicit
allow-list for inline prose links), and asserts the compose Send button's own rect is
inside the viewport. Ten minutes of automation to make every future slice answerable
by one command — the audit above cost an hour precisely because this did not exist.

---

## 4. What "phone friendly" means here

- 320×640 is the constraint, not 390. Everything above was measured there first.
- No horizontal document overflow on any screen; a control that needs more width
  wraps or scrolls inside its own container.
- Every tap target ≥44×44, except links inside running text (named above).
- The primary action of a screen is inside the viewport, reachable without scrolling
  where the platform allows it.
- Nothing that carries meaning is truncated on a phone. Decorative truncation
  (previews, subjects) is fine; the setup banner was not.
- A drawer, sheet or overlay always has a visible way out.
