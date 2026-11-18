# Admin panel — specification

Companion to `ADMIN-PANEL-PLAN.md`. That document says *what* and *in what order*; this one
says *exactly how* for the phase being built next, and designs the screens the later phases
will need.

Status: **Phases A, B, C, D, F and G built and verified on 2026-11-18.** E already existed (System tab). A: audit log + Activity tab.
B: suspension reason, end date, self-lifting expiry, recovery-address notice. C: mail health
card (rspamd, junk totals, queue). Phases D–G remain specification.

---

## 1. Phase A — audit log, in full

### 1.1 What is recorded, and what deliberately is not

A record is one admin action that changed something or revealed something sensitive:

| action | target | detail |
|---|---|---|
| `user.suspend` / `user.unsuspend` | username | reason, until (once Phase B lands) |
| `user.delete` | username | message count removed |
| `user.credentials` | username | whether the password changed, never the value |
| `user.admin.grant` / `revoke` | username | — |
| `user.recovery.set` / `send` | username | the address, because it redirects account recovery |
| `pending.approve` / `deny`, `waitlist.approve` | address | — |
| `audit.read` | — | who looked, because reading the log is itself an act |

**Not recorded, on purpose:**

- No message content, subjects, senders or subjects of mail. The audit log must never become
  a shadow copy of the mailbox.
- No IP addresses of ordinary users' logins — that belongs in `sessions`, not here.
- No failed authentication attempts: those are a different concern with a different
  retention need, and mixing them makes the admin log useless for its one job.
- No secrets of any kind. A record that says "password changed" is the whole point; a record
  that says what it changed to would be a catastrophe.

### 1.2 Record shape

```json
{
  "at": 1795010000,
  "actor": "tibs",
  "action": "user.suspend",
  "target": "someone",
  "detail": "reason: abuse; until: 1795096400",
  "prev": "9f2c…",           // hash of the previous record
  "hash": "4a71…"            // sha256(prev + this record without `hash`)
}
```

**Why a hash chain:** the file is append-only and the server writes it, so the risk is not a
typo — it is someone with shell access deleting a row to hide an action. With `prev` + `hash`
any deletion or edit breaks every later link, and `GET /api/admin/audit/verify` recomputes the
chain and names the first record that does not match. That turns "the log looks fine" into a
checkable claim, which is the difference between an audit log and a decoration.

It does not stop an attacker who rewrites the whole chain. It does mean they must rewrite
every record and the verify endpoint's output is not something they can quietly fix in place —
and the daily offsite backup already ships a copy they would have to reach too.

### 1.3 Store

`core/audit.rs`, sidecar `data/audit.json`, same conventions as `trash`/`junk`/`subject_rules`:
`Mutex` around read-modify-write, write to `.tmp` then rename, corrupt file reads as empty
rather than panicking (and the panic-free read is itself tested, as in `core::junk`).

```rust
pub fn append(actor: &str, action: &str, target: &str, detail: &str) -> io::Result<()>;
pub fn page(offset: usize, limit: usize, target: Option<&str>) -> Vec<Record>;
pub fn verify() -> Result<usize, (usize, String)>;   // Ok(count) | Err(index, why)
```

`append` computes the hash itself. Callers never pass one in — a caller that could choose
`prev` could hide a gap.

### 1.4 Endpoint

```
POST /api/admin/audit          RouteAuth::Admin
  { offset?, limit?, target? }  → { records: [...], total, has_more, chain: {"ok": true, "count": N} }
```

- `chain` is included in every response, so the panel shows integrity without a second call.
- `limit` clamped to 200 like the mail list; `offset` guarded against runaway values.
- Reading writes an `audit.read` record. That is not recursion: appends do not themselves
  append.

### 1.5 Client — the Activity tab

Fifth tab, same construction as People: `<ul className="divide-y divide-line sm:hidden">` cards
below `sm`, table above, 44 px targets either way.

Each row, newest first:

```
tibs suspended someone                        14:03
reason: abuse; until 19 Nov
[integrity: ✓ 1,284 records, chain intact]
```

The integrity line is a single row above the list, not a per-row badge. Per-row badges imply
per-row verification that does not happen.

**States that must exist, because a panel with only a happy path is a panel that lies:**

| state | what is shown |
|---|---|
| loading | skeleton rows, not a spinner in a table |
| empty | "No admin actions recorded yet." |
| chain broken | red row naming the first bad record, and a line saying the log may have been edited |
| server without the route (older build) | "This server does not keep an audit log." — the pattern `useSnoozed` already uses |
| error | the message, plus a retry |

### 1.6 Where the calls go in, and the risk in each

Four call sites in `src/api/endpoints/admin.rs` plus the two approval endpoints. Each is a
one-line `audit::append(...)` after the change succeeds, **not before** — an action that failed
must not leave a record claiming it happened, and an action that succeeded must not be missing.

The failure question: if `append` fails (disk full), does the admin action proceed? **Yes, and
it is logged at `error!` level.** The alternative — refusing a suspension because the log could
not be written — turns a logging fault into an outage, and an admin who cannot suspend an
abusive account is a worse failure than a gap in the log. The gap is visible: `verify` reports
the broken chain, and the next successful append makes the gap permanent and obvious.

### 1.7 Acceptance

1. Suspend an account, grant admin, delete a user → three rows, correct actor, correct target.
2. A non-admin calling `POST /api/admin/audit` → 403, and nothing appended.
3. `verify` returns `ok` with the right count after the three actions.
4. Delete a middle record by hand on disk → `verify` names its index and the panel shows red.
5. Corrupt `audit.json` → the panel shows "no actions", the server does not crash, and a new
   append repairs the file (tested at module level).
6. Restart the server → the log is still there and the chain still verifies.

---

## 2. Screen designs

### 2.1 People (exists — three changes)

- Add a **role** column (Phase F) and a **storage** column (Phase E) only when those exist;
  do not reserve empty columns now.
- Suspension gains its reason and end date (Phase B) in the existing confirm dialog.
- The self-row guard stays exactly as it is: no suspend, delete or demote on yourself. Phase B
  must extend it to the new dialog, not re-implement it.

### 2.2 Access (exists — one addition)

Pending signups and waitlist approval are there. Phase A adds nothing here except that each
approval now records who approved it, which matters when a spam account gets in.

### 2.3 Deliverability (grows twice)

Today: a recipients view. Phase C adds a health card, Phase D a DMARC table.

```
Mail health                         last 24h
  scored 1,654      rejected 4      tagged 29
  Bayes  3 learned  [trend sparkline]
  queue  0 deferred 0
  top rules: FORGED_SENDER (12), BAYES_SPAM (8), …
```

Every number carries its moment ("as of 14:03") because a health card without a timestamp is
a rumour. If rspamd is unreachable the card says **unavailable**, never zeros — zeros read as
"nothing is wrong".

DMARC table (Phase D): source IP, count, pass/fail/unknown, first seen, last seen, and a note
when the source is one of our own sending hosts.

### 2.4 System (grows)

Disk today. Phase E adds per-account totals and names orphans (blobs referenced by nobody)
rather than rounding them into the total. Phase C adds queue depth.

### 2.5 Activity (new, Phase A)

As specified in 1.5.

---

## 3. Phase F — the roles migration, designed

The only high-risk phase, because `User` is bincode.

1. **Do not touch the struct first.** Add `data/roles.json` (sidecar): `{ "users": { "alice":
   "staff" } }`, absent means `user`, and `is_admin == true` continues to mean `admin`.
2. Ship reads from the sidecar: `role_of(user) = sidecar.get(name).unwrap_or(if user.is_admin
   { Admin } else { User })`. Every authorisation check switches to `role_of`. No data moves.
3. Verify: every existing admin still passes `RouteAuth::Admin`; a staff account is refused
   from destructive endpoints and allowed to read health and audit.
4. **Only once (3) is proven** do we consider writing the field into `User` — and at that point
   it is optional, because the sidecar already works. The honest recommendation is *not to do
   step 4 at all*: the sidecar costs one file lookup and removes the migration risk entirely.

That is a change from the plan document, and it is the better answer: the sidecar pattern has
already carried `trash`, `junk`, `subject_rules` and now `roles` without ever touching
`users.bin`.

---

## 4. Decisions (taken 2026-11-18)

1. **Audit retention: keep everything.** Prune only once the file passes ~50 MB, and prune
   oldest-first with a record of the pruning itself. An audit log that forgets is a log that
   can be waited out.
2. **Staff access: yes, for moderation.** The role exists and its capabilities are fixed here
   rather than left to the endpoint's convenience:

   | capability | staff | admin |
   |---|---|---|
   | see accounts, health, audit | ✓ | ✓ |
   | suspend / unsuspend **with a reason** | ✓ | ✓ |
   | approve / deny signups and waitlist | ✓ | ✓ |
   | delete an account | ✗ | ✓ |
   | change credentials or recovery address | ✗ | ✓ |
   | grant or revoke any role | ✗ | ✓ |
   | read another account's mail | ✗ (nobody can — the server cannot decrypt it) | ✗ |

   Staff is enforced server-side on each endpoint, not by hiding buttons.
3. **Suspension notifies the account holder** by mail to the address on file, with the reason
   and, when there is one, the end date. Silence is how a moderation decision looks like a
   bug from the other side.
4. **The panel says out loud that nobody can read another account's mail.** A line in the
   People tab, not a footnote in a document: an admin who expects a mail viewer and does not
   find one concludes the panel is broken.

## 5. Build order and honest sizing

| order | phase | sessions | risk |
|---|---|---|---|
| 1 | A — audit log + Activity tab | **done** | low |
| 2 | B — suspension reason/expiry | **done** | low |
| 3 | C — mail health | **done** | low (read-only) |
| 4 | E — storage per account | **already existed** | low |
| 5 | D — DMARC reports | **done** | low (read-only) |
| 6 | F — roles via sidecar | **done** | medium |
| 7 | G — 2FA for admins | **done** | medium |

**Planned: 7 phases. Built: 0 of them.** Four of the seven are read-only additions and could
ship in one sitting each; A is the one that changes what the panel is *for*.
