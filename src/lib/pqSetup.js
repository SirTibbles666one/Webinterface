import api from '@/api'
import { generatePqKeyPair, wrapSecretBytes, unwrapSecretBytes } from '@/crypto'
import { keySession } from '@/keySession'
import { storage } from '@/storage'

/**
 * Enabling and loading post-quantum protection.
 *
 * The ML-KEM-768 secret key is wrapped in the browser under the same
 * password-derived key as the RSA key and only then sent, so the server holds
 * ciphertext for it exactly as it does for the RSA half. Nothing here can be
 * done by the server on the account's behalf — which is the point.
 */

function b64(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i])
  return btoa(out)
}

function authHeaders() {
  return { Authorization: `Bearer ${storage.getToken()}` }
}

export async function fetchPostQuantumStatus() {
  try {
    const { data } = await api.get('/user/pq-keys', { headers: authHeaders() })
    return data
  } catch {
    return { enabled: false, unavailable: true }
  }
}

/**
 * Create this account's ML-KEM key and upload the public half.
 * Returns the public key (base64) so callers can show a fingerprint.
 */
export async function enablePostQuantum(password, serverSalt) {
  if (!password || !serverSalt) {
    throw new Error('Your password is needed once to protect the new key')
  }
  const pair = generatePqKeyPair()
  const publicKeyB64 = b64(pair.publicKey)
  const wrappedSecret = await wrapSecretBytes(pair.secretKey, password, serverSalt)
  await api.post(
    '/user/pq-keys',
    { public_key: publicKeyB64, encrypted_private_key: wrappedSecret },
    { headers: authHeaders() },
  )
  keySession.setPq(b64(pair.secretKey))
  return { publicKey: publicKeyB64 }
}

/**
 * Make sure the account has a post-quantum key, without asking.
 *
 * Confidentiality is hybrid only for accounts that published an ML-KEM key; everyone else
 * gets RSA alone, which a future quantum computer could open. Having that depend on a
 * person finding a setting is how a security claim becomes true for some users and quietly
 * weaker for the rest — so it happens on the next unlock.
 *
 * Never throws: a sign-in must not fail because a key could not be generated.
 */
export async function ensurePostQuantumKey(password, serverSalt) {
  try {
    const status = await fetchPostQuantumStatus()
    // "Could not read the status" is not "no key": publishing blind could overwrite a key
    // the account already has, and a failed lookup is a network problem, not a setup gap.
    if (status?.unavailable) return { ok: false, reason: 'key status unavailable' }
    if (status?.enabled) return { ok: true, created: false }
    if (!password || !serverSalt) return { ok: false, reason: 'no password in hand' }
    await enablePostQuantum(password, serverSalt)
    return { ok: true, created: true }
  } catch (error) {
    return { ok: false, reason: error?.message || 'post-quantum setup unavailable' }
  }
}

/**
 * Load the wrapped secret key into this session. Silent by design: an account
 * without one is a normal state, not an error.
 */
export async function loadPostQuantumKey(password, serverSalt) {
  try {
    const status = await fetchPostQuantumStatus()
    if (!status?.enabled || !status.encrypted_private_key) return false
    if (!password || !serverSalt) return false
    const secret = await unwrapSecretBytes(status.encrypted_private_key, password, serverSalt)
    keySession.setPq(b64(secret))
    return true
  } catch (err) {
    // A key that cannot be unwrapped now is not fatal — the mail that needs it
    // will say so by name rather than the whole login failing.
    console.warn('[pq] could not load the post-quantum key:', err?.message || err)
    return false
  }
}

export async function disablePostQuantum() {
  await api.delete('/user/pq-keys', { headers: authHeaders() })
  keySession.setPq(null)
}


/** How much of the mailbox still sits in the pre-hybrid envelope. */
export async function fetchPostQuantumMigration() {
  const { data } = await api.get('/pq/migration', { headers: authHeaders() })
  return data
}
