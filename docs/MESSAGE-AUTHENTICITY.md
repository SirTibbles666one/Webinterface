# Message authenticity — design

Status: **proposed, not built.** This changes what a sealed message contains, so it is
written down before any code moves. Everything here was measured against production on
2026-11-18.

## The problem, precisely

The reader shows a lock labelled "End-to-end encrypted". Three separate things are being
claimed by that one icon, and only the first is currently true:

1. **The body was encrypted to my key.** True, but not by the sender: the server seals
   inbound mail to the recipient on delivery. Verified today — a plaintext message posted to
   `qa@slothlee.xyz` arrives with a `message_key` and a ciphertext body. So "it is encrypted"
   says something about the server's storage, not about the sender.
2. **The sender is who the headers say.** Not established at all. There is no signature on
   the sealed payload anywhere in the client.
3. **Nobody altered it in transit.** Not established. AES-GCM authenticates the ciphertext
   against *the key it was encrypted with*, and the server holds that path end to end.

Until 2026-11-18 the lock was read from an `OpenNeutron-E2EE` header **inside the parsed
body**, so any server could render arbitrary plaintext with a lock on it. That is now derived
from "this arrived with a message_key we decrypted" — a local fact, which is better, and
still not a statement about the sender for the reason in (1).

## What has to be true for the lock to mean something

The recipient's client must verify, locally, that **the bytes it decrypted were sealed by the
holder of a key that key transparency says belongs to the sender**, and that those bytes have
not changed since. That requires three things this system does not have:

- a **signing key per identity**, published where key transparency can vouch for it;
- a **signature inside the envelope**, over the ciphertext (not over the plaintext, which the
  reader only gets after decryption);
- a **rule the reader applies**: no verified signature → no lock.

## Design

### 1. Identity gets a signing key, published in KT

Each account gets an ML-DSA-65 signing keypair alongside its RSA-OAEP encryption key. ML-DSA
is the right choice here for three reasons: the client already vendors `@noble/post-quantum`
(it is what signs KT heads), the KT head algorithm is already `ml-dsa-65` so verification is
the same code path, and it is post-quantum — a signature scheme with a 20-year horizon is
worth having in a mailbox.

Cost: ~1.9 KB public key and ~3.3 KB signature per message, both base64'd in the envelope.
On a 3 KB message that roughly triples the stored size. Acceptable; worth measuring once real
traffic exists.

The KT leaf grows a second field (`leaf.sig_key`, base64) beside `leaf.key`. **This is the
one server change**: the leaf is currently built from the user's encryption key only, so
publishing a signing key means the server stores and serves one more field per identity and
includes it in the leaf hash. The server never verifies signatures — clients do.

### 2. Envelope v2

```
SLW2 | 0x02 | iv(12) | ct_len(u32 BE) | ciphertext | sig(3.3 KB ml-dsa-65)
```

The signature covers, in order:

```
"slw/v2/message" | iv | ciphertext | recipient_address | sender_address | sent_at(u64)
```

**Correction made during implementation.** This section originally signed a hash of the whole
recipient set. That cannot work: each recipient receives its own ciphertext copy, and a BCC'd
reader cannot see the other recipients, so they could never recompute the set hash and could
never verify their own mail. Binding the *recipient* — the address that copy was sealed for —
is verifiable by everyone including BCC, and still makes a copy un-replayable to another
address. The set hash survives only as a helper for future group semantics.

Signing the **ciphertext** rather than the plaintext is deliberate: the recipient can verify
it before decrypting, with no key material of theirs involved, and a re-encryption by anyone
else invalidates it immediately. `recipient_set_hash` binds the envelope to the group it was
sealed for, so a ciphertext cannot be replayed to a different set of recipients.
`sender_address` is inside the signed bytes, so a valid signature cannot be re-attributed.

`SLW1` stays readable. A `SLW1` message renders with the weaker label (below).

### 3. Three states in the reader, not one icon

| State | Condition | Copy |
|---|---|---|
| **Verified sender** | v2 envelope, signature valid against the sender's KT leaf, and that leaf's proof verified under the pinned KT signer | lock, "Sealed by *name* — signed and verified" |
| **Sealed, sender unverified** | decrypted successfully, but no signature (v1) or the sender has no published signing key | open-lock outline, "Sealed to you — the sender is not verified" |
| **Not encrypted** | plaintext body | no icon |

A **failed** signature is not one of these: it is a refusal. The reader opens a warning card
("This message claims to be from X but the signature does not match. It has not been
rendered.") with the body withheld, because a message whose signature fails is precisely the
one an attacker wants rendered.

### 4. Sending

- Sign after encrypting, before upload. The existing send path already has the ciphertext and
  the recipient set in hand at that point.
- Send v2 **only if** every recipient's KT leaf carries a `sig_key`. Mixed recipients fall
  back to v1 with a note in the composer ("one recipient cannot receive signed mail yet").
  Sending v2 to someone who cannot verify it is worse than v1: it would show as unverified
  and look like a downgrade attack.
- The sender's own signing key is wrapped with the same password KDF as the encryption key and
  published at setup, so a new device can sign without a separate ceremony.

### 5. Migration

No re-encryption of stored mail. v1 messages keep working and are labelled honestly ("sender
unverified"), which is *true* for every message in every mailbox today. New messages become
v2 as recipients publish signing keys. Signing keys are generated on next unlock, so the
rollout needs no action from users.

### 6. What this does and does not fix

**Fixes:** sender substitution by the server, tampering with stored ciphertext, a lock shown
on plaintext, and re-attribution of a message to a different sender. After this, the lock
means something a hostile server cannot forge.

**Does not fix:** metadata (who mails whom, when, subject in clear — see the audit's P2 on
`/note/create`), and denial of service (a server can still refuse to deliver). Neither is a
signature problem.

## Effort

| Piece | Work |
|---|---|
| Server: `sig_key` on the KT leaf, included in the leaf hash | ~1 day, plus a proof-format version note |
| Client: keygen, wrap, publish on unlock | ~1 day |
| Client: envelope v2 sign/verify, three reader states, composer fallback | ~2 days |
| Tests: sign→verify round trip, tampered ciphertext, replayed recipient set, wrong sender, v1 fallback | ~1 day |

## Recommendation

Do it, in that order, and land the server field first: the client cannot verify a signature
against a key that is not published, and shipping the client half first would put locked
mailboxes in front of users for no benefit.

## Interim state (shipped today)

The lock is no longer read from a body header; it is derived from a decryption this client
performed. That closes the "set a header on plaintext and get a lock" trick. It does **not**
make the lock a statement about the sender, because the server seals inbound mail itself —
so the label stays unchanged until signatures exist, and this document is the record of why.

## Step 1 done — the server publishes signing keys (deployed 2026-11-18)

`openneutron` now carries an ML-DSA-65 signing key per account, and the log witnesses it:

- `Leaf.sig` (base64 SHA-256 of the public key); leaves **with** it hash under `kt/v2/leaf`,
  leaves without it are byte-identical to v1. A fixed test vector (`36f6c405…001a`) plus an
  independent inline recomputation pin that, so the two copies cannot drift together.
- `record()` carries `sig` forward across a password or PQ key change, so a password change
  cannot silently unpublish an identity. `record_removal()` deliberately clears it, and a
  password reset drops the sidecar key — otherwise a key whose leaf was removed would stay
  published and unwitnessed.
- `data/sigkeys.json` sidecar holds the **full** public key (not a `User` field: `users.bin` is
  positional bincode and one new field would make every existing account unreadable).
- `POST /api/user/sigkey` validates length (1952 bytes ±2), **logs the hash before storing the
  key**, so the server never serves an unwitnessed key. `GET` returns it or `null`.
- `GET/POST /api/email/publickeys` now includes `sig_key` for internal recipients.

**Deployed by me after review, not by the implementing agent:** 158 Rust tests pass, image
`openneutron:kt-v2` built, previous image tagged `openneutron:rollback-20261118-pre-kt`,
container recreated (17 users loaded, SMTP listening).

**Verified live:**

| check | result |
|---|---|
| KT head before → after deploy | `size 23 / QH54wAIm…` → **identical** (no history moved) |
| `GET /api/user/sigkey` unauthenticated | `401` |
| publish a real 1952-byte ML-DSA-65 key (QA) | `200 "Signing key published"`, head `23 → 24`, new root |
| `/api/kt/proof` for that account | leaf carries `sig`, index 23 |
| **client** `verifyProof` on that real leaf | **passes** — v2 leaf hash, pinned signer and head signature all agree |
| encrypted round trip after the restart | composes, delivers, decrypts |

That last row is the one that matters: the client's `kt/v2/leaf` implementation and the
server's agree on real data, which is the failure unit tests cannot catch.


## Step 2 — client side, partway (deployed 2026-11-18)

**Landed and live (`a43d47d`):**

- `src/lib/msgSign.js` — the `SLW2` envelope and its signed bytes
  (`label|iv|ciphertext|recipient_set_hash|sender|sent_at`), with a three-way verifier:
  `verified`, `unsigned` (a v1 message — old, not suspicious), `invalid` (must not render).
  Ten tests, including re-encryption, replay to another recipient set, re-attribution,
  timestamp tampering and truncation.
- `src/lib/sigKey.js` — ML-DSA-65 keypair generated on the device, secret wrapped with the
  **same** password KDF as the mailbox key (`deriveWrapKey`; the salt is **hex**, not
  base64), only the 1,952-byte verifying key published, wrapped copy cached so a second tab
  unwraps instead of minting a second identity. Eight tests against the real post-quantum
  implementation, including that a failed publish leaves no half-saved state.
- The login path now ensures a signing key after the mailbox key unlocks, and **cannot fail
  the unlock**: the helper returns `{ok:false, reason}` and the session continues. A mailbox
  that will not open is worse than an unsigned one.

**Verified on production:** login page and app render with zero console errors after the
deploy; the publish endpoint was exercised live earlier (200, leaf carries `sig`, tree
23→24, client `verifyProof` passes).

**Not yet verified:** the publish-on-login path as a *user* would hit it. Driving it needs a
real password typed into the sign-in form, which this environment must not do. It will
exercise itself on the next real sign-in, and the API half is already proven.

**End-to-end proof (LIVE_SIG=1, run 2026-11-18).** A throwaway account whose keys the test
controls: sealed and signed with the app's own crypto, sent through the live API, read back,
and verified by the reader's own function.

| step | result |
|---|---|
| publish signing key | accepted, KT leaf carries `sig` |
| message as sent | **`verified`**; body decrypts underneath the envelope |
| one flipped ciphertext byte | **`invalid`** |
| sender swapped to another address | **`invalid`** |

**Still to build:** sign in `useSendEmail` (pack `SLW2` around the payload), verify in the
reader against the sender's published key and its KT leaf, and the three reader states with
the body withheld on `invalid`.

**A wart found while building this, worth keeping in mind.** `/email/list` returns uids as
u128 **JSON numbers**, so `JSON.parse` turns `1.4786006677720391e+38` into a float and the low
digits are destroyed. The client survives because `api.js` quotes every 16+ digit run before
parsing — the crude regex the audit flagged as P2. It is not cosmetic: removing it would make
message ids unaddressable. The proper fix is emitting uids as strings, which is a server
change with a client migration.

---

## Appendix — server groundwork (superseded by the section above)

The design says the server field lands first. Working through it revealed that the leaf hash
is only a third of the job:

1. **`Leaf` gains `sig: Option<String>`** and hashes under `kt/v2/leaf` only when present.
   Written and staged: existing leaves keep the v1 label, so no recorded history moves and
   every pinned head stays valid. A leaf that gains a signing key becomes v2, which is an
   append like any other.
2. **`record()` must carry `sig` forward.** Today it appends a fresh leaf whenever the
   encryption or PQ key changes; without carrying the field, a password change would silently
   drop the account's signing key from the log.
3. **A new `record_signing_key(account, sig_key)`** appends a leaf reusing the current
   rsa/pq hashes, so publishing a signing key needs no encryption key at hand.
4. **The full signing key has to be servable.** The leaf stores hashes (that is what the tree
   commits to), so the *key itself* belongs on the user record and in `/api/email/publickeys`
   the way the RSA key already is — otherwise a recipient can verify nothing.
5. **A route to publish it** (`POST /api/user/sigkey`), plus the DTO change on publickeys.

None of this is deployed. The reason is not effort, it is sequencing: a KT change is the one
change in this system that can make every user's sends fail closed, the host has no Rust
toolchain (builds go through Docker), and shipping it requires a mail-server restart. Doing it
as one deliberate unit — with a `cargo test` run inside the builder image, a tagged previous
image for rollback, and the client's `kt/v2/leaf` support released in the same window — is the
responsible shape. A partial deploy would leave the server accepting a field no client can use
and no test covering the hash switch.

Staged patch: `/data/cache/scratch/kt/keylog.rs` (leaf field + v2 label + versioned hash).
