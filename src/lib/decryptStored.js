import { decryptEmail } from '@/crypto'
import { unpack, toB64 } from '@/lib/msgSign'
import { keySession } from '@/keySession'
import { storage } from '@/storage'

function b64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Open a stored message with whatever the account actually holds.
 *
 * Every reader used to call `decryptEmail(data, key, privateKey)` directly, so
 * adding post-quantum mail meant editing five call sites and hoping none were
 * missed. There is one entry point now: it supplies the RSA key, the ML-KEM
 * secret when this session has one, and the account name the hybrid key is bound
 * to — so a message sealed under the new envelope opens in the inbox, the sent
 * folder, the reader and the export alike.
 */
// A signed message is an SLW2 envelope around the original payload. Unwrapping here, at
// the one entry point every reader uses, means a signed message cannot be handed to AES-GCM
// whole — which would fail to decrypt every message the moment signing was switched on.
const SLW2 = [0x53, 0x4c, 0x57, 0x32]
function unwrapIfSigned(data) {
  try {
    const bytes = b64ToBytes(data)
    if (bytes.length > 21 && SLW2.every((byte, i) => bytes[i] === byte)) {
      return toB64(unpack(bytes).payload)
    }
  } catch {
    // Not an envelope, or not base64: let the normal path report whatever is wrong.
  }
  return data
}

export async function decryptStored(data, messageKey, privateKeyOverride = null) {
  const privateKey = privateKeyOverride || (await keySession.get())
  const pq = keySession.getPq()
  const username = storage.getUsername() || ''
  return decryptEmail(
    unwrapIfSigned(data),
    messageKey,
    privateKey,
    pq ? b64ToBytes(pq) : null,
    username,
  )
}

export default decryptStored
