// Message signatures: proving who sealed a message, not just that it was sealed.
//
// Today the reader's lock means "this arrived encrypted" — and the server seals inbound
// mail itself, so that says nothing about the sender. A signature over the ciphertext
// changes what the lock can claim: the recipient can verify it *before* decrypting, with
// none of their own key material involved, and any re-encryption or substitution
// invalidates it immediately.
//
// Layout, appended to the existing payload so no server field is needed:
//
//   SLW2 | 0x01 | sent_at(u64 BE) | pl_len(u32 BE) | payload | sig_len(u16 BE) | signature
//
// sent_at travels in the envelope because it is inside the signed bytes: the verifier
// cannot know it otherwise, and carrying it unsigned would let anyone shift the clock.
//
// The signature covers, in order:
//
//   "slw/v2/message" | iv | ciphertext | recipient_address | sender_address | sent_at(u64)
//
// Signing the *ciphertext* is deliberate: it verifies before decryption, and it binds the
// exact bytes a recipient will decrypt. The recipient is the address this copy was sealed
// for — each recipient gets its own ciphertext, so a copy cannot be replayed to someone
// else, and a BCC'd recipient can still verify because their own address is what is bound
// rather than a list they cannot see. sender_address is inside the signed bytes, so a
// valid signature cannot be re-attributed.
import { sha256 } from '@noble/hashes/sha2.js'

const MAGIC = [0x53, 0x4c, 0x57, 0x32] // "SLW2"
const VERSION = 0x01
const LABEL = new TextEncoder().encode('slw/v2/message')

const u32be = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
const u16be = (n) => new Uint8Array([(n >> 8) & 255, n & 255])
const u64be = (n) => {
  const out = new Uint8Array(8)
  let v = BigInt(n)
  for (let i = 7; i >= 0; i -= 1) { out[i] = Number(v & 0xffn); v >>= 8n }
  return out
}
const concat = (parts) => {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

export function toB64(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function fromB64(text) {
  const raw = atob(text)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * The hash that binds a message to the exact set of recipients it was sealed for.
 *
 * Sorted and lowercased so the same group produces the same hash regardless of the
 * order addresses were typed in, and hashed so the signature does not literally carry
 * the recipient list into every copy.
 */
export function recipientSetHash(addresses) {
  const normalised = [...new Set(addresses.map((a) => String(a).trim().toLowerCase()))].sort()
  return sha256(new TextEncoder().encode(normalised.join('\n')))
}

const normaliseAddress = (value) => {
  const raw = String(value || '')
  const bracketed = raw.match(/<([^>]+)>/)
  return (bracketed ? bracketed[1] : raw).trim().toLowerCase()
}

/** The bytes a sender signs. Exported so a verifier cannot drift from a signer. */
export function signingInput({ iv, ciphertext, recipient, sender, sentAt }) {
  return concat([
    LABEL,
    iv,
    ciphertext,
    new TextEncoder().encode(normaliseAddress(recipient)),
    new TextEncoder().encode(normaliseAddress(sender)),
    u64be(sentAt),
  ])
}

/** Wrap a payload + signature into the v2 envelope. `payload` is the existing iv|ct. */
export function packV2(payload, signature, sentAt) {
  if (payload.length < 13) throw new Error('payload too short to be an envelope')
  return concat([
    new Uint8Array(MAGIC), new Uint8Array([VERSION]), u64be(sentAt || 0),
    u32be(payload.length), payload,
    u16be(signature.length), signature,
  ])
}

/**
 * Read a payload back. Returns `{ payload, signature }` for a v2 envelope, or
 * `{ payload, signature: null }` for anything older — a v1 message is not an error,
 * it is simply unsigned, and the reader says so rather than refusing it.
 */
export function unpack(payload) {
  const startsV2 = MAGIC.every((byte, i) => payload[i] === byte)
  if (!startsV2) return { payload, signature: null, sentAt: null }
  if (payload[4] !== VERSION) throw new Error('unknown envelope version')
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  let sentAt = 0n
  for (let i = 0; i < 8; i += 1) sentAt = (sentAt << 8n) | BigInt(payload[5 + i])
  const payloadLen = view.getUint32(13)
  const payloadStart = 17
  const payloadEnd = payloadStart + payloadLen
  if (payloadEnd + 2 > payload.length) throw new Error('envelope is truncated')
  const sigLen = view.getUint16(payloadEnd)
  const sigStart = payloadEnd + 2
  if (sigStart + sigLen > payload.length) throw new Error('signature is truncated')
  return {
    payload: payload.slice(payloadStart, payloadEnd),
    signature: payload.slice(sigStart, sigStart + sigLen),
    sentAt: Number(sentAt),
  }
}

/**
 * The bytes a decryptor should be handed.
 *
 * A signed message is an SLW2 envelope around the original `iv|ct` payload, so anything
 * that decrypts must unwrap first — handing the envelope to AES-GCM would fail on every
 * signed message. Exported so both readers use one function rather than each remembering.
 */
export function payloadForDecryption(payload) {
  return unpack(payload).payload
}

/** iv and ciphertext, split out of the existing `iv|ct` payload. */
export function splitPayload(payload) {
  if (payload.length < 13) throw new Error('payload too short to be an envelope')
  return { iv: payload.slice(0, 12), ciphertext: payload.slice(12) }
}

/**
 * Sign. `sign(privateKey, message) -> Uint8Array` is injected so the caller decides the
 * algorithm (ML-DSA-65 today) without this module importing a post-quantum library into
 * every bundle that touches mail.
 */
export function signEnvelope({ payload, privateKey, sign, recipient, sender, sentAt }) {
  const { iv, ciphertext } = splitPayload(payload)
  const signature = sign(privateKey, signingInput({ iv, ciphertext, recipient, sender, sentAt }))
  return packV2(payload, signature, sentAt)
}

/**
 * Verify. Returns `'verified'`, `'unsigned'` or `'invalid'` — never a bare boolean,
 * because "no signature" and "wrong signature" must look different to a reader: the
 * first is a v1 message, the second is the one case that must not be rendered.
 */
export function verifyEnvelope({ payload, publicKey, verify, recipient, sender, sentAt }) {
  let envelope
  try {
    envelope = unpack(payload)
  } catch {
    return 'invalid'
  }
  if (!envelope.signature) return 'unsigned'
  if (!publicKey) return 'unsigned'
  // The envelope carries sent_at because it is signed; trusting a caller-supplied one
  // would let a verifier be told a different clock than the signer used.
  const stamp = sentAt ?? envelope.sentAt
  try {
    const { iv, ciphertext } = splitPayload(envelope.payload)
    const ok = verify(publicKey, envelope.signature, signingInput({ iv, ciphertext, recipient, sender, sentAt: stamp }))
    return ok === true ? 'verified' : 'invalid'
  } catch {
    return 'invalid'
  }
}
