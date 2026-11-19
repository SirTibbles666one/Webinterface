import forge from 'node-forge'
import { debugLog } from '@/lib/debug'
import { hasSubtleCrypto } from './crypto'

const SESSION_KEY = 'openneutron.private_key'
const SALT_KEY = 'openneutron.salt'
const PQ_KEY = 'openneutron.pq_key'

let privateKeyCache = null
let pqSecretCache = null
// The serialised form, kept in memory only. Drafts derive their encryption key from it, and it
// must not be a thing that survives a reload: that is the whole point of this change.
let serializedCache = null

// ─── Binary helpers (duplicated locally to avoid circular imports) ────────────
function toForgeBin(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s }
function fromForgeBin(s) { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u }
function toB64(u8) { let b = ''; for (let i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]); return btoa(b) }
function fromB64(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u }

// Serialize either a WebCrypto CryptoKey or a forge key handle to PKCS#8 DER base64
async function serializeKey(key) {
  if (key && key._forge) {
    const inner   = forge.pki.privateKeyToAsn1(key.key)
    const wrapped = forge.pki.wrapRsaPrivateKey(inner)
    const der     = fromForgeBin(forge.asn1.toDer(wrapped).getBytes())
    return { format: 'pkcs8b64', data: toB64(der) }
  }
  const jwk = await crypto.subtle.exportKey('jwk', key)
  return { format: 'jwk', data: jwk }
}

// Deserialize a stored key — always produces the right type for the current environment
async function deserializeKey(stored) {
  if (stored.format === 'pkcs8b64') {
    const bytes = fromB64(stored.data)
    if (hasSubtleCrypto) {
      return crypto.subtle.importKey('pkcs8', bytes, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt'])
    }
    const asn1      = forge.asn1.fromDer(toForgeBin(bytes))
    const innerAsn1 = forge.asn1.fromDer(asn1.value[2].value)
    return { _forge: true, key: forge.pki.privateKeyFromAsn1(innerAsn1) }
  }
  // JWK (WebCrypto-generated key — only loadable when subtle is available)
  if (hasSubtleCrypto) {
    return crypto.subtle.importKey('jwk', stored.data, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt'])
  }
  return null // JWK without subtle → cannot import; force re-login
}

export const keySession = {
  /**
   * Keep the private key for the life of this page, and nowhere else.
   *
   * It used to be written to sessionStorage, which made it readable by anything that can run in
   * the page and meant a reload never had to ask for the password. That is the opposite of what
   * the mailbox promises: the password is what unwraps the key, so the key should stop existing
   * when the page does, and a reload should cost one password entry (the UnlockModal).
   */
  set: async (key) => {
    privateKeyCache = key
    try {
      serializedCache = JSON.stringify(await serializeKey(key))
      sessionStorage.removeItem(SESSION_KEY)
    } catch (err) {
      // Without a serialised form, drafts cannot be encrypted; the key itself is still usable.
      serializedCache = null
      debugLog('[keySession] could not serialise the key for draft storage:', err)
    }
  },

  /** The serialised key, in memory only — null once the page is gone. */
  serialized: () => serializedCache,

  get: async () => {
    if (privateKeyCache) return privateKeyCache
    // Nothing to restore from: the key does not outlive the page.
    return null
  },

  clear: () => {
    privateKeyCache = null
    pqSecretCache = null
    serializedCache = null
    sessionStorage.removeItem(SESSION_KEY)
    sessionStorage.removeItem(SALT_KEY)
    sessionStorage.removeItem(PQ_KEY)
  },

  // The post-quantum secret key, base64 of the raw ML-KEM-768 bytes. Kept in
  // sessionStorage beside the RSA key so a reload does not force a re-login,
  // and wiped with it on sign-out.
  setPq: (base64Secret) => {
    if (!base64Secret) return
    pqSecretCache = base64Secret
    sessionStorage.removeItem(PQ_KEY)
  },
  getPq: () => pqSecretCache,

  setSalt: (salt) => {
    debugLog('[keySession] setSalt():', salt)
    sessionStorage.setItem(SALT_KEY, salt)
  },
  getSalt: () => sessionStorage.getItem(SALT_KEY),
}

