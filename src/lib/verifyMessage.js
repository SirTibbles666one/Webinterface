// Deciding what the reader may claim about a message.
//
// Three outcomes, because collapsing them is how a reader ends up trusting the wrong thing:
//
//   'verified' — a signature over this exact ciphertext, from the address the message claims,
//                checked against a key the sender published.
//   'unsigned' — no signature (everything sent before signing existed), or no published key
//                to check against. Old, not suspicious: the UI must say so without alarm.
//   'invalid'  — a signature that does not match. This is the only outcome that withholds
//                the body, because a message whose signature fails is the one an attacker
//                most wants rendered.
import { unpack, verifyEnvelope, fromB64 } from '@/lib/msgSign'
import { verifyBytes } from '@/lib/sigKey'

export const bareAddress = (value) => {
  // A parsed header is an object ({name, email}); a recipient list is strings. Accept both,
  // because String({}) is "[object Object]" and that silently matched nothing.
  const raw = String(value && typeof value === 'object' ? (value.email || value.address || '') : (value || ''))
  const bracketed = raw.match(/<([^>]+)>/)
  return (bracketed ? bracketed[1] : raw).trim().toLowerCase()
}

/**
 * Which address strings might be the one this copy was sealed for.
 *
 * The sender bound the signature to the address they typed, and the reader only knows its
 * own mailbox name plus the To/Cc lines. Trying each plausible spelling costs nothing —
 * a signature matches exactly one string — and avoids guessing which one the sender used.
 */
export function candidateRecipients({ parsed, deliveredTo, username }) {
  const mine = String(username || '').trim().toLowerCase()
  if (!mine) return []
  const found = new Set()
  const consider = (value) => {
    const addr = bareAddress(value)
    if (!addr.includes('@')) return
    if (addr.split('@')[0] !== mine) return
    found.add(addr)
  }
  for (const field of [parsed?.to, parsed?.cc, deliveredTo]) {
    if (Array.isArray(field)) field.forEach(consider)
    else if (field) consider(field)
  }
  return [...found]
}

/** Find a `sig_key` for an address in whatever shape the server used, without guessing it. */
export function findSigKey(body, address) {
  const want = bareAddress(address)
  let found = null
  const walk = (node) => {
    if (found || !node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (typeof node.sig_key === 'string' && node.sig_key.length > 100) {
      const owner = node.address ? bareAddress(node.address) : null
      if (!owner || owner === want) { found = node.sig_key; return }
    }
    for (const value of Object.values(node)) walk(value)
  }
  walk(body)
  return found
}

/**
 * The reader's verdict for one message.
 *
 * `fetchKeys(addresses)` is injected so this module never imports the API layer, and so the
 * decision can be tested without a network.
 */
export async function signatureState({ payloadB64, parsed, deliveredTo, username, fetchKeys }) {
  let envelope
  try {
    envelope = unpack(fromB64(payloadB64))
  } catch {
    return 'unsigned'
  }
  if (!envelope.signature) return 'unsigned'

  const sender = bareAddress(parsed?.from)
  if (!sender) return 'unsigned'

  let sigKey = null
  try {
    sigKey = findSigKey(await fetchKeys([sender]), sender)
  } catch {
    sigKey = null
  }
  if (!sigKey) return 'unsigned'

  const recipients = candidateRecipients({ parsed, deliveredTo, username })
  if (recipients.length === 0) return 'unsigned'

  const payload = fromB64(payloadB64)
  let publicKey
  try {
    publicKey = fromB64(sigKey)
  } catch {
    return 'unsigned'
  }
  const verdicts = recipients.map((recipient) => verifyEnvelope({
    payload, publicKey, verify: verifyBytes, recipient, sender,
  }))
  if (verdicts.includes('verified')) return 'verified'
  return 'invalid'
}
