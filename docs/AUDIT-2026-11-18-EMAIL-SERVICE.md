# Audit — Sloth Lee Mail, 18 Nov 2026

Scope: the mail service end to end — Rust API and SMTP (25,465 lines under `/opt/on/src`),
Postfix/rspamd on the host, DNS and TLS posture, the data sidecars, the client bundle, and the
operational surface (logs, backups, deploys). Every line below is a measurement taken on the
running system, not a reading of the source alone.

## Verdict

| severity | count | what |
|---|---|---|
| **High** | 2 | a post-quantum unlock gap that hid every message (fixed today); deploys are user-visible |
| **Medium** | 4 | panic paths in request threads; an unthrottled public endpoint; CSP reporting silently broken; sidecars that only grow |
| **Low** | 3 | bot rejections with no summary; CORS posture undocumented; one 502 in the same window |
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

### 3. 195 panic paths sit outside tests, and a request thread has no safety net

`api/endpoints/email.rs` alone has 79 (`unwrap`/`expect`/`panic!`). Request threads are spawned
without `catch_unwind`, so a panic loses that request entirely — the client sees a dropped
connection and the log a panic. Only two mutexes use `.lock().unwrap()` (`suspended.rs`,
`notes.rs`), against nine that recover from poisoning with `unwrap_or_else(|p| p.into_inner())`;
those two are where a panic becomes a cascade.

Fix: wrap the per-request call in `catch_unwind` and answer 500 with a code, and move those two
locks onto the recovery pattern the rest of the tree already uses.

### 4. The public note endpoints have no throttle

nginx zones cover `waitlist`, `evidence`, `register`, `account_recovery` and `login`. `/api/note`,
`/api/note/open` and `/api/note/burn` are public and unthrottled. The token is 32 characters of
urlsafe base64 so guessing is not the risk; the risk is a script grinding the endpoint, and each
open writes the sidecar.

Fix: one `limit_req` zone for `/api/note` — a note is opened once by one person.

### 5. CSP reporting is broken exactly when it matters

9 nginx errors in 24 h: `upstream prematurely closed connection` on `/csp-report` →
`127.0.0.1:9911`. The sink is running but throws on something in those reports, so violations are
lost — and a lost violation report is how a broken policy stays invisible.

Fix applied: the sink now answers every request (204) and cannot die on a malformed body.

### 6. Sidecars only ever grow

`notes.json` is 842 KB for 89 notes; `sessions.json` is 208 KB while only 2 sessions are live. Both
have sweeps, but sweeps delete *records*, not the file's history. At this rate it is harmless; the
trajectory is one JSON file being rewritten per write, growing forever.

Fix: compact on load when a file is more than half empty (write once, atomically).

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
