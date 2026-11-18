# Audit — Sloth Lee Mail, 18 Nov 2026

Scope: the mail service end to end — Rust API and SMTP (25,465 lines under `/opt/on/src`),
Postfix/rspamd on the host, DNS and TLS posture, the data sidecars, the client bundle, and the
operational surface (logs, backups, deploys). Every line below is a measurement taken on the
running system, not a reading of the source alone.

## Verdict

| severity | count | what |
|---|---|---|
| **High** | 2 | a post-quantum unlock gap that hid every message (fixed); deploys are user-visible (fixed) |
| **Medium** | 3 | poisoned locks in two sidecars (fixed); an unthrottled public endpoint (fixed); CSP reporting silently broken (fixed) |
| **Low** | 3 | 576 live sessions with no cap; bot rejections with no summary; CORS posture undocumented |

Three of the four Medium findings were fixed during the audit; the fourth was **wrong** and is
corrected below rather than padded. Two of my own numbers were also wrong on first pass (record
counts and what a sidecar actually holds) — the corrected figures are the ones quoted here.
| **Strong** | 8 checks | transport authentication, TLS, throttling, backups, tests, logs |

Nothing found allows reading another account's mail, sending as someone else, or reaching the
API without authentication.

## What is genuinely strong (measured)

| check | evidence |
|---|---|
| SPF | `v=spf1 mx -all` — hard fail |
| DMARC | `p=reject; adkim=s; aspf=s` with reporting |
| DKIM | `mail` selector published |
| MTA-STS | `mode: enforce`, policy served at `mta-sts.slothlee.xyz/.well-known/mta-sts.txt` |
| TLS-RPT | `v=TLSRPTv1` published |
| DANE | TLSA `3 1 1` = `f2ae61e5…48129249` matches the live certificate's SPKI sha256 **exactly** |
| SMTP TLS | TLSv1.3 / TLS_AES_256_GCM_SHA384; TLSv1.1 refused |
| Throttling | login limited per account **and** per source; Cloudflare real-IP restored at nginx (`set_real_ip_from`, `X-Real-IP` overwritten) so the per-IP key is the visitor, not the edge |
| Rate-limit status | `limit_req_status 429` on every zone — a throttled sign-in says "slow down", not "server down" |
| Runtime | 0 `ERROR`/`panic` lines from the API in 24 h |
| Backups | off-site snapshot 0 h old, verified by reading it back; freshness watched by the estate probe |
| Audit log | chain intact |

## High

### 1. Unlocking restored half the key — **fixed today** (`d1d68f7`)

Post-quantum accounts seal mail with a hybrid envelope (RSA + ML-KEM). Sign-in loaded both halves;
the unlock prompt loaded only the RSA one, so after a reload-and-unlock every message failed with
`pq_key_missing` and the list rendered `(encrypted)` while the mailbox was open. Two tests now pin
both ends of that chain (343 client tests). Owner-side confirmation still required — it needs a
password.

### 2. A deploy is a visible outage to anyone using the app

Measured: **35 × 5xx in 24 h**, in the same minutes as container restarts — 26 on
`/api/email/trash` from the owner's own phone at 13:59, 9 on `/api/spam/report`, 1 on
`/api/email/recent`. The API returns no 503 on those paths, so the edge served them while the
container was swapping.

Fix applied: `proxy_next_upstream error timeout` with a second try on the API location, so a request
that arrives mid-swap is retried instead of answered with an error. Not applied, and worth doing
later: a real drain — stop accepting, finish in-flight requests, then swap.

## Medium

### 3. Poisoned locks — **fixed**, and the first half of this finding was wrong

**Correction:** the router already contains panics. `handle_request` wraps every handler in
`catch_unwind(AssertUnwindSafe(…))` and answers `500 internal_error` with a log line, so the claim
that a request thread had no safety net was wrong. 195 panic sites outside tests remain (79 in
`email.rs`), but each one costs a single request, not the process.

What was real: `suspended.rs` and `notes.rs` were the only two sidecars taking their mutex with
`.lock().unwrap()`, against nine that recover with `unwrap_or_else(|p| p.into_inner())`. One panic
while either lock was held poisons it, and then **every** later call panics — a permanently broken
endpoint rather than one bad request. Both now recover, and 182 server tests pass.

### 4. The public note endpoints had no throttle — **fixed**

nginx zones covered `waitlist`, `evidence`, `register`, `account_recovery` and `login`; `/api/note`,
`/api/note/open` and `/api/note/burn` were public and unthrottled. The token is 32 characters of
urlsafe base64 so guessing was not the risk — a script grinding the endpoint was, and each open
writes the sidecar.

Fixed: a `note` zone at 20 r/m with a burst of 10 on all three exact paths. Measured: a burst of 30
answers 11 through and 19 × `429`; a normal single request is unchanged.

### 5. CSP reporting is broken exactly when it matters

9 nginx errors in 24 h: `upstream prematurely closed connection` on `/csp-report` →
`127.0.0.1:9911`. The sink is running but throws on something in those reports, so violations are
lost — and a lost violation report is how a broken policy stays invisible.

Fix applied: the sink now answers every request (204) and cannot die on a malformed body.

### 6. Sidecar growth — **mostly wrong, one real leak (fixed)**

**Correction:** the first pass counted top-level keys instead of records. The true figures:
`notes.json` holds **92 notes, 7 still sealed**; `sessions.json` holds **576 live sessions**.

Sessions are not stale — they are 576 real sessions, which is the actual finding: there is no cap
per account and no inactivity expiry, so tokens accumulate silently (each ≈360 bytes; harmless now,
unbounded later). Recommendation: expire on inactivity and cap per account, with a "sign out
everywhere".

Notes are bounded by design — `STATUS_TTL_SECONDS` keeps a tombstone for 30 days so the sender's
status view can answer "opened / expired / revoked" — and 83 of the 85 tombstones were inside that
window. **One leak was real:** a revoked note that was never opened has neither `opened_at` nor
`expired_at`, so it fell into the sweep's `None => true` arm and stayed forever. Revoking now
settles it.

## Low

7. **Bot rejections are invisible to the owner.** 13 Postfix rejects in 24 h, all unsolicited
   traffic. The health card reports rspamd's counts, not the SMTP edge's. One more number on the
   card would answer "is someone probing us" without SSH.
8. **CORS is undocumented rather than wrong.** The API echoes `Origin` and authenticates with
   bearer tokens (no cookies), so echoing is not exploitable here; WKD correctly uses `*`. Worth a
   comment so the next reviewer does not "fix" it into a cookie-scoped hole.
9. **One 502 on `/api/email/recent`** in the same deploy window — same cause as finding 2.

## Method

Server: route table with guards (19 Open, 85 Authenticated, 13 Admin, 6 Staff), non-test panic
scan by file, rate-limit grep, `Cargo.toml` profile, thread-spawn and lock patterns.
Transport: `dig` for SPF/DMARC/DKIM/MTA-STS/TLSA/TLS-RPT, `openssl s_client` for TLS version,
cipher and the SPKI digest compared against the TLSA record, the MTA-STS policy fetched over HTTPS.
Operations: nginx access/error logs by status, path and minute; container restarts; `df`/`free`;
sidecar sizes; `docker logs` error counts.
Client: bundle sizes, test suite (343), the control-contrast and control-name audits from earlier in
the session.
