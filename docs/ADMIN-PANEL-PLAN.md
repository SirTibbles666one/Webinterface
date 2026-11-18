# Admin panel — full-scale plan

Status: **Phase A is built and live** (`data/audit.json`, `POST /api/admin/audit`, Activity tab).
Phases B–G remain proposals. Section 1 records the inventory measured before Phase A.

## 1. What exists today (measured, not remembered)

**Server endpoints** — 15, all `Authenticated` except where the router enforces `Admin`:

```
/api/admin/recipients              /api/admin/disk-usage
/api/admin/users        (list)     /api/admin/pending          (list)
/api/admin/users        (create)   /api/admin/pending/approve
/api/admin/users        (delete)   /api/admin/pending/deny
/api/admin/users/credentials       /api/admin/waitlist         (list)
/api/admin/users/recovery-address  /api/admin/waitlist/approve
/api/admin/users/send-recovery
/api/admin/users/admin   (grant/revoke)
/api/admin/users/suspend
```

**Client** — `src/pages/Admin.jsx`, four tabs:

| Tab | Contains |
|---|---|
| People | account list, per-user admin toggle, suspend, credentials, recovery address, delete |
| Access | pending signups and waitlist approval |
| Deliverability | recipients view |
| System | disk usage |

**Already right, and worth not breaking:** the phone layout (2×2 tabs, 44 px targets, card
list rather than a table below `sm`), the self-row guard (you cannot suspend or demote
yourself), and the fact that every destructive action asks for confirmation.

## 2. What the panel cannot do, and why it matters

These are the gaps, in the order an operator hits them:

1. **Nothing is recorded.** Suspending an account, deleting a mailbox, granting admin — none
   of it leaves a trace. When someone asks "who removed that account", the answer does not
   exist. This is the single biggest gap: an admin panel without an audit log is a panel you
   cannot trust with anyone else's access.
2. **Suspension is all-or-nothing and silent.** No reason, no expiry, no notice to the
   account holder. "Suspended" looks identical whether it was abuse or a payment problem.
3. **No view of mail health.** rspamd's score, the junk it filed, the messages it rejected at
   SMTP, and the Postfix queue are all invisible here. Today the only way to answer "is spam
   being caught?" is an SSH session.
4. **No DMARC reporting view.** The server ingests aggregate reports (`core/reports.rs`) and
   alerts on them, but nothing shows an admin who is forging the domain — the one question
   those reports exist to answer.
5. **No backup or restore status.** The offsite backup is a shell script with a heartbeat; if
   it silently stopped, the panel would not know and neither would you until you looked.
6. **Storage is a single number.** `/disk-usage` reports the host; there is no per-account
   storage, no quota, and no way to answer "who is using the 35 GB".
7. **One role.** `is_admin` is a boolean. There is no read-only staff role, so anyone who
   needs to look at accounts must be able to delete them too.
8. **Admin accounts are not required to use 2FA**, though WebAuthn exists.

## 3. Plan

Phases are ordered by risk reduced per unit of work. Each phase ships and is verified on its
own; none depends on a later phase to be useful.

### Phase A — the audit log (P0)

**Why first:** every later action on this list is destructive, and until actions are recorded
none of them should be trusted to a second person.

- Server: `core/audit.rs`, sidecar `data/audit.json`, append-only, one record per admin
  action: `{ at, actor, action, target, detail }`. Written by the admin endpoints themselves,
  not by the client.
- Endpoint: `POST /api/admin/audit` (list, paged, newest first, filterable by target).
- Client: a fifth tab, **Activity**, with the same phone-first list treatment as People.
- Acceptance: suspend an account, revoke admin, delete a user → three rows appear, naming the
  actor and the target; a non-admin calling the endpoint gets 403; the file survives a
  restart and is never rewritten in place (append + rename, like the other sidecars).
- Explicit non-goal: no editing or deleting audit rows, including by an admin.

### Phase B — suspensions with a reason and an end (P1)

- `core/suspended.rs` gains `reason` and `until` (it already stores per-account state).
- Suspend dialog asks for a reason from a short list plus free text, and optionally a duration.
- The login path tells a suspended user the reason rather than a generic refusal; an expired
  suspension lifts itself on the next login attempt.
- Acceptance: suspend for 1 minute with a reason, wait, log in successfully; the audit log has
  both the suspension and the expiry.

### Phase C — mail health at a glance (P1)

- Server: one endpoint, `GET /api/admin/mail-health`, aggregating rspamd's controller (scored,
  rejected, tagged, Bayes learned), the junk store totals per account, and the Postfix queue
  depth and deferred count.
- Client: **Deliverability** grows a health card: numbers with a 24-hour trend, and the top
  five rules that fired.
- Acceptance: the numbers match `rspamc stat` and `mailq` at the same moment; a stopped rspamd
  shows "unavailable" rather than zeros.

### Phase D — DMARC reports (P2)

- `core/reports.rs` already parses aggregate reports for alerting. Add `GET /api/admin/dmarc`
  returning per-source-IP counts for the last 30 days, and a table in Deliverability with
  "pass / fail / unknown" per source.
- Acceptance: a report from a known third party appears within one cycle with the right
  disposition counts.

### Phase E — storage per account (P2)

- Sum blob sizes per account server-side (cheap: the blobs are named by uid and the user
  record already lists them), expose per-account and total, and show it in People beside each
  row with a sort.
- Acceptance: the per-account sum equals `du` of the referenced blobs; total equals the sum of
  accounts plus orphans, and orphans are named rather than hidden.

### Phase F — roles (P2, needs a decision)

- Replace `is_admin: bool` with a role enum, either `admin | staff | user` or a capability
  list. **This is a schema change to `User`, which is bincode** — it needs a migration pass
  over `users.bin`, not a field addition. Deliberately last for that reason.
- Staff gets read-only: can see accounts, health and audit, cannot suspend, delete or grant.

### Phase G — 2FA for admins (P2)

- WebAuthn is already implemented for accounts. Require it for anyone with the admin role,
  with a grace period on first grant.
- Acceptance: an admin without a key is asked to enrol at next sign-in; the panel refuses to
  show destructive controls until they do.

## 4. Security model for all of it

- **Authorisation stays in the router.** `RouteAuth::Admin` already exists; every new endpoint
  is registered with it, and the client's tab visibility is a convenience, never the control.
- **The server records; the client never sends audit entries.** A client-supplied log is a log
  an attacker writes.
- **No endpoint may act on the acting admin's own account where the action is
  self-destructive** — the existing self-row guard generalises to suspend, delete, demote.
- **Every destructive endpoint gets a test that proves a non-admin is refused**, not only a
  test that an admin succeeds.

## 5. Honest sizing

| Phase | Server work | Client work | Risk |
|---|---|---|---|
| A | new module + 1 endpoint + 4 call sites | 1 tab, 1 list | low |
| B | extend existing store + login path | 1 dialog + 1 message | low |
| C | 1 aggregating endpoint | 1 card | low (read-only) |
| D | 1 endpoint over existing parser | 1 table | low (read-only) |
| E | 1 endpoint + size sum | sortable column | low |
| F | schema migration | role UI | **high** — the only phase that can lose access |
| G | enforcement in login | enrol prompt | medium |

Phase A is the one I would build first, and the one I would refuse to skip: it is the
precondition for giving anyone else access to this panel at all.
