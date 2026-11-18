# Ids on the wire — plan

Status: **planned, not started.** The client change shipped 2026-11-18 (`preserveBigInts`
extracted and pinned by tests); the server half needs its own build-and-restart window.

## The problem

Message ids are `u128`. The server serialises them as JSON **numbers**, and JavaScript
numbers are doubles: `231903818003946380734778029329812390800` parses to
`2.319038180039464e+38` and the low digits are gone. A uid that has been through
`JSON.parse` no longer addresses the message.

Found in practice while building the signed-message end-to-end test: `/email/get` answered
`{"code":"invalid_json"}` because the uid handed back matched nothing.

The client survives by quoting every run of 16+ digits before parsing
(`preserveBigInts` in `src/api.js`). That hack is **load-bearing**: remove it and message
ids stop working. It is also indiscriminate — a message body containing `ref: 1234567890123456`
becomes unparseable JSON, the whole response comes back as a string, and that message
renders as "(encrypted)". Both behaviours are pinned by tests
(`tests/preserve-bigints.test.js`), including the failure case, so nobody "cleans it up".

## What the server change is

The 16 structs in `src/api/dto.rs` that carry ids split into two kinds, and only one kind
may change:

- **Requests** (`GetEmailRequest`, `DeleteEmailRequest`, `SetEmailBytesRequest`,
  `MarkEmailReadRequest`, `SetEmailStarredRequest`, `GetEmailsBulkRequest`, …) already
  accept both forms through `u128_flex`. **Leave them exactly as they are** — clients in the
  wild send numbers, and the quoting hack means this build sends strings.
- **Responses** (`EmailUidsResponse`, `EmailUidsPage`, `EmailBytesResponse`,
  `EmailFlagResponse`, `GroupDto`, `EphemeralStatusItem`, …) are where the number has to
  become a string.

Mechanism: a small serde helper, applied per field, rather than a global serde change —
`#[serde(with = "u128_string")]` for a single id and a matching helper for `Vec<u128>`.
Serialise as a decimal string; deserialise accepting both (responses are never parsed back
by the server, but a permissive helper keeps round-trip tests possible).

## Order of work

1. **Server:** helper module + attribute on the response fields only. `cargo test`, then
   `docker build`. **Do not restart the mail server without the client half ready** — a
   server that emits strings is harmless to the current client (the hack simply stops
   matching, since quoted ids no longer look like numbers), so this half is safe to deploy
   alone. That is the useful asymmetry: server first, no coordination needed.
2. **Client:** keep `preserveBigInts` for one release. It no longer fires on ids, and the
   test that pins it can be relaxed to "does not corrupt a normal response". Deleting it in
   the same release that changes the wire format removes the only thing covering an old
   cached bundle.
3. **Client, later:** drop the hack once no cached bundle can be served (the deployed client
   is hashed and immutable, so one release of overlap is enough).
4. **Verify:** create a message, read it back, confirm `typeof uid === 'string'` in the
   response and that the id round-trips through `JSON.parse` untouched. Then send a message
   whose body contains `ref: 1234567890123456` and confirm it renders instead of showing
   "(encrypted)" — that is the bug this whole change removes.

## Why it is worth doing at all

Not because the hack is ugly. Because it silently corrupts message content: any mail where
such a number appears after a colon is unreadable, and the reader shows "(encrypted)"
instead — which looks like a crypto problem and sends people looking in the wrong place.
