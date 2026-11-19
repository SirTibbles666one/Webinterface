import { toBase64, fromBase64 } from '@/lib/bytes'
import { keySession } from '@/keySession'

/**
 * Drafts, kept out of the disk in the clear.
 *
 * A draft is a message someone is still writing: a bank reply, a letter, a password in a note to
 * themselves. It used to be stored as plain JSON in localStorage, so anything that could read the
 * browser profile could read it. Now it is encrypted with AES-GCM under a key derived from the
 * session's own private-key material, which lives in sessionStorage — a key that exists while the
 * mailbox is unlocked and stops existing when the tab closes.
 *
 * The consequence is deliberate: with the mailbox locked, drafts cannot be read. A locked mailbox
 * should not reveal what you were writing.
 */

const BLOB_KEY = 'openneutron.drafts.v1'
const LEGACY_KEY = 'drafts'
const SALT = 'sloth-lee-drafts'
const INFO = 'v1'

let cache = []
let writeChain = Promise.resolve()

const enc = () => new TextEncoder()

async function deriveKey() {
  // The key material lives in memory while the mailbox is unlocked; it is deliberately not
  // persisted anywhere, so drafts are readable exactly as long as the session is.
  let raw = null
  try {
    raw = keySession.serialized()
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const base = await crypto.subtle.importKey('raw', enc().encode(raw), 'HKDF', false, ['deriveKey'])
    return await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: enc().encode(SALT), info: enc().encode(INFO) },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  } catch {
    return null
  }
}

const b64 = (buf) => toBase64(new Uint8Array(buf))
const unb64 = (s) => fromBase64(s)

function readBlob() {
  try {
    return JSON.parse(localStorage.getItem(BLOB_KEY) || 'null')
  } catch {
    return null
  }
}

function writeBlob(blob) {
  try {
    localStorage.setItem(BLOB_KEY, JSON.stringify(blob))
  } catch {
    /* a full disk should not lose the draft in memory */
  }
}

async function persist() {
  const key = await deriveKey()
  if (!key) {
    // Locked: keep the drafts in memory and write nothing. Nothing readable reaches the disk.
    return
  }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc().encode(JSON.stringify(cache)))
  writeBlob({ v: 1, iv: b64(iv), ct: b64(ct) })
}

function queuePersist() {
  writeChain = writeChain.then(persist, persist)
  return writeChain
}

/** Load drafts into memory: the encrypted blob, or the old plaintext list, migrated once. */
export async function loadDrafts() {
  const blob = readBlob()
  if (blob?.ct && blob?.iv) {
    const key = await deriveKey()
    if (!key) {
      cache = []
      return cache
    }
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct))
      cache = JSON.parse(new TextDecoder().decode(plain))
      return cache
    } catch {
      // A different key (a password change that did not carry the drafts): do not present
      // garbage as a draft, and do not delete what might still be readable elsewhere.
      cache = []
      return cache
    }
  }

  // One-time migration from the plaintext list storage.js used to keep.
  try {
    const raw = JSON.parse(localStorage.getItem('openneutron') || '{}')
    if (Array.isArray(raw[LEGACY_KEY]) && raw[LEGACY_KEY].length) {
      cache = raw[LEGACY_KEY]
      await queuePersist()
      delete raw[LEGACY_KEY]
      localStorage.setItem('openneutron', JSON.stringify(raw))
      return cache
    }
  } catch {
    /* nothing to migrate */
  }
  cache = []
  return cache
}

export const drafts = () => cache

export function put(draft) {
  const idx = cache.findIndex((d) => d.id === draft.id)
  if (idx >= 0) cache[idx] = draft
  else cache.unshift(draft)
  queuePersist()
  return cache
}

export function remove(id) {
  cache = cache.filter((d) => d.id !== id)
  queuePersist()
  return cache
}

/** After a password change the key material differs; rewrite the blob under the new key. */
export async function reencryptAll() {
  await queuePersist()
  return cache.length
}

/** Remove every draft from memory and disk. */
export async function clearAll() {
  cache = []
  try {
    localStorage.removeItem(BLOB_KEY)
  } catch {
    /* nothing to remove */
  }
  await queuePersist()
}
