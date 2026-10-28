# Sealed notes: disappearing mail for recipients on other providers

Status: implemented 2026-10-28.

## The problem

Disappearing mail works because the copy we delete is ours. For a recipient on
another provider, the message is theirs the moment it is delivered: nothing we
add to an SMTP message makes their server delete it, and a PGP body cannot
revoke itself. Providers that offer "expiring mail" only do so between their own
users, and no outside party can invoke it.

So for those recipients we do not send the body at all.

## What happens instead

1. The sender turns on **Sealed link** in the compose window (it appears only
   when at least one recipient is on another provider).
2. The client encrypts the message — subject, body and signature — to the
   recipient's OpenPGP key, and only to that key. *Not* to the sender's own key:
   a copy encrypted to us would mean the operator could read something the
   sender was told was sealed.
3. `POST /api/note/create` stores that armour and returns a link.
4. The recipient gets a short email: who it is from, the subject, the link, and
   when it closes. No body.
5. Opening the link shows the sender, the deadline and a button. The button
   fetches `POST /api/note/open`, which hands over the armour and clears it in
   the same write. The page then shows the armour to copy, or the recipient
   decrypts the file with their own key.

## Two ways to lock a note

- **To their key** (default): armour encrypted to the recipient's OpenPGP key.
  Nothing to explain, nothing to share — but it needs a key, and a stranger on
  another provider often has none.
- **With a passphrase**: symmetric armour locked with four words and digits that
  the compose window generates (e.g. `donkey-ginger-onyx-indigo-604`). The
  recipient opens the link, types the phrase, and reads the message on whatever
  device they have — no key, no client, no install. The sender passes the phrase
  on another channel; it is never in the email.

Passphrase notes are the reason a sealed note is worth sending to someone
without PGP at all. The costs are stated in the UI: the phrase travels outside
the mail, and anyone holding both the link and the phrase can read it.

Because a typo must not destroy the message, a passphrase note is not burned by
being fetched. It is cleared when the page reports a successful decrypt
(`POST /note/burn`), or by the timer, and the link stops working after five
fetches.

The sender's own copy in Sent carries the link, the phrase and the deadline —
that is the only place they are written down.

## What is enforced, and what is not

Enforced by us, because the only copy is on our disk:

- the body is gone the moment it is opened, and a second open is refused
- the timer clears it even if nobody opens it
- the page is not consumed by a plain `GET`, so a mail provider's link scanner
  or preview fetcher cannot burn the note before the recipient taps it

Not enforced:

- the notification email. It stays in their inbox with the subject and a dead
  link. We cannot reach into their mailbox.
- what the recipient does after decrypting. Same limit as every burn feature.
- the subject line is in the notification in clear text, because a notification
  nobody can identify gets ignored. The body is what is sealed.

## Cryptography

- Armour is OpenPGP, produced in the browser by the sender's client.
- The server stores ciphertext and a 32-byte random token. It has no key that
  opens a note, so it cannot read one.
- Notes are **unsigned**: signing needs the sender's private-key passphrase, and
  a sealed note must be writable without it. A passphrase note is additionally
  *not* bound to a key, so anyone with the link and the phrase can read it —
  that is the point, and the limit. Provenance comes from the
  notification email, which is DKIM-signed by this server.
- The token is a capability: whoever has the link can open the note once. It
  travels in the URL, so the page sends `Referrer-Policy: no-referrer` and the
  response is `Cache-Control: no-store`.

## Storage

`data/notes.json` — a sidecar, because `Email` and `User` are bincode and adding
a field to either destroys every stored record.

```json
{ "notes": { "<token>": { "recipient": "…", "armored": "-----BEGIN PGP MESSAGE-----…",
                          "created_at": 1793149956, "expires_at": 1793753956,
                          "opened_at": null, "expired_at": null } } }
```

- Added to the offsite backup tar list; a restore without it silently loses
  every live note.
- Cleared bodies keep their status row for 30 days so the sender can see what
  happened, then the row is dropped.
- Maximum 50 unopened notes per account; body capped at 512 KB; no attachments.

## Limits worth stating in the UI

- A sealed note carries the message text only. Attachments are refused rather
  than silently dropped.
- The recipient needs OpenPGP tooling: their mail client, or `gpg --decrypt` on
  the text the page hands back. A recipient with no key cannot be sealed to, and
  the compose window says so by name.
- The default deadline is 7 days when the sender picked "delete when read" and
  no timer, so an undeliverable notification cannot leave a note on disk forever.
