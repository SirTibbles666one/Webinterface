# Sealed notes: plan

Written after the owner reported a sealed note that "cannot be opened". The investigation found
the note was **already destroyed**, and the model shows why.

## What was actually wrong

`pgp`-mode notes were cleared the instant they were served: `notes::open` deleted the armour and
set `opened_at` on the first `POST /api/note/open`. So a single click that did not end with the
armour on screen — a JavaScript error, a closed tab, an accidental tap, a flaky connection — cost
the recipient the message permanently, and every later attempt answered `Spent`. Their note is gone
from the store: 89 notes are recorded and none of them is from `tibs`.

Single-use is a promise to the *sender*. It was implemented as a promise to destroy on first
contact, which is a different and much worse thing.

## Shipped with this document

| change | why |
|---|---|
| 15-minute grace window in `pgp` mode (`GRACE_SECONDS = 900`) | a note stays readable after a failed attempt instead of dying on it |
| The page calls `/api/note/burn` once the armour is rendered | the note is destroyed when it has actually been *delivered to the eyes*, not when it was requested |
| Copy states the cost before the click | "This note can be opened once. What appears is PGP armour for your key…" — the failure mode was not knowing what would happen |

Verified end to end: serve → serve again (grace) → burn → `Spent`.

## Phase 1 — say what arrived (~half a day)

1. **The page never shows the sender's message.** A recipient sees a subject and a lock, then PGP
   armour they may not understand. Add the sender's note ("tibs sent you a sealed note"), and in
   `pgp` mode a concrete instruction: *this is not readable in a browser; open the .asc in your mail
   client, or ask the sender for a passphrase note instead.*
2. **No indication that a passphrase note exists.** Senders pick the mode; recipients do not know
   there was a choice. The page should say when a note is passphrase-locked by name only ("this note
   needs a phrase your sender will send separately").
3. **Attachments in `pgp` mode are invisible.** They are sealed into the same armour and never
   mentioned; the page lists files only in passphrase mode.

Done when: a recipient who has never seen this product can describe what to do next after one read
of the page, in both modes.

## Phase 2 — the sender can see what happened (~half a day)

1. **`/api/note/status` exists and nothing shows it.** Add a "Sealed notes" section to Settings:
   sent notes, opened or not, with expiry and a revoke action (the endpoint exists).
2. **Opening should notify the sender.** The infrastructure for outbound notices already exists
   (`notify-outbox`); a note being opened is the one event a sender wants to hear about.
3. **Show the key fingerprint on both ends.** A note sealed to the wrong (or an old, rotated) key
   fails exactly like a broken page — silently, and after the fact. Printing the last 8 characters of
   the recipient key on the page and in the sender's status turns "cannot be opened" into "that is
   not their key", which is a conversation the sender can act on.
4. **Expiry is invisible to the sender.** A note that expired unread is not a failure, but it is
   information, and today it is only in a JSON file.

## Phase 3 — make single-use honest (~a day)

1. **Offer "until it expires" instead of always-once.** Some notes are a link you want to send twice
   (a boarding pass, a document for a colleague). The store already has `expires_at` and `opens`;
   the model supports it, the composer does not offer it.
2. **Second open should be a decision, not a wall.** Within the window, a second open is allowed (it
   already is, for 15 minutes); past it, the page should say "this note was already opened on …",
   which is more useful than a generic failure.
3. **Rate-limit `/api/note/open`.** Tokens are 32 characters of urlsafe base64 — not guessable — but
   the endpoint is public and unauthenticated, and a per-IP limit costs nothing.

## Not planned, deliberately

- **Reading the note in the browser in `pgp` mode.** That needs the recipient's private key; the
  server must not have it and the page cannot get it. The honest answer is armour plus instructions,
  which is what this product does.
- **Storing the plaintext** for any period. The value of a sealed note is that the server never has
  it; a cache would trade that away for convenience.
- **Emailing the passphrase.** It must travel separately from the link or the seal means nothing.
