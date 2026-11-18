// The signing key: generated once, wrapped like the encryption key, published so others
// can verify signatures, and kept out of anything a server can read.
//
// Two halves matter. The public half is published (POST /api/user/sigkey) and its hash is
// witnessed by key transparency, so a recipient can check a signature against a key the
// directory cannot swap. The private half is wrapped with the same password KDF as the
// mailbox key and never leaves the browser: the server has no use for it and no way to
// use it.
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { wrapSecretBytes, unwrapSecretBytes } from '@/crypto'
import { toB64, fromB64 } from '@/lib/msgSign'

export const SIG_PUB = 'openneutron.sig_key_public'
export const SIG_WRAPPED = 'openneutron.sig_key_wrapped'
const SESSION_KEY = 'openneutron.sig_private'

/** Generate a fresh ML-DSA-65 keypair. 1952-byte verifying key, 4032-byte secret. */
export function generateSigKeyPair() {
  const seed = crypto.getRandomValues(new Uint8Array(32))
  const { publicKey, secretKey } = ml_dsa65.keygen(seed)
  return { publicKey, secretKey }
}

/** Sign message bytes. Injected everywhere else as `sign` so nothing else imports the library. */
export function signBytes(secretKey, message) {
  return ml_dsa65.sign(message, secretKey)
}

/** Verify. Returns a boolean; callers turn that into a reader state, never a silent pass. */
export function verifyBytes(publicKey, signature, message) {
  try {
    return ml_dsa65.verify(signature, message, publicKey) === true
  } catch {
    return false
  }
}

/**
 * Unwrap the signing key into this session, or create one if the account has none.
 *
 * Creation is silent on purpose: a security feature that needs a separate ceremony is one
 * most people never complete. The key is generated on the device, wrapped with the
 * password that is already in hand, and published — no server involvement in generating it.
 */
export async function ensureSigningKey({ password, serverSalt, publish, storage = globalThis.localStorage, session = globalThis.sessionStorage }) {
  const existing = session.getItem(SESSION_KEY)
  if (existing) return fromB64(existing)

  const wrapped = storage.getItem(SIG_WRAPPED)
  const publishedKey = storage.getItem(SIG_PUB)
  if (wrapped && publishedKey) {
    const secret = await unwrapSecretBytes(wrapped, password, serverSalt)
    session.setItem(SESSION_KEY, toB64(secret))
    return secret
  }

  const { publicKey, secretKey } = generateSigKeyPair()
  const wrappedSecret = await wrapSecretBytes(secretKey, password, serverSalt)
  await publish(toB64(publicKey))
  storage.setItem(SIG_PUB, toB64(publicKey))
  storage.setItem(SIG_WRAPPED, wrappedSecret)
  session.setItem(SESSION_KEY, toB64(secretKey))
  return secretKey
}

/** The session's signing key, if this tab has unlocked one. */
export function sessionSigningKey(session = globalThis.sessionStorage) {
  const raw = session.getItem(SESSION_KEY)
  return raw ? fromB64(raw) : null
}

/**
 * Publish the signing key after an unlock, and never let that block the unlock.
 *
 * Called from both unlock paths. A signing key is worth having, but a mailbox that will
 * not open because key generation failed is worse than an unsigned one — so this reports
 * the failure through its return value and swallows nothing else.
 */
export async function publishSigningKeyAfterUnlock({ password, serverSalt, publish, storage, session }) {
  try {
    await ensureSigningKey({ password, serverSalt, publish, storage, session })
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error?.message || 'signing key unavailable' }
  }
}

export function clearSigningKey(session = globalThis.sessionStorage) {
  session.removeItem(SESSION_KEY)
}
