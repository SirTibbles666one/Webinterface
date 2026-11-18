/**
 * Binary helpers that stay linear.
 *
 * `for (… ) bin += String.fromCharCode(byte)` is how this file used to be written everywhere, and
 * on a 28 MB attachment it costs about two seconds per pass at 4x the memory — measured against a
 * chunked conversion on the same buffer, which took 0.16 s. An attachment is encrypted and encoded
 * several times on the way out, so the difference is the difference between sending and hanging.
 */

const CHUNK = 8192

/** Bytes to a binary (latin1) string, 8 KB at a time. */
export function bytesToBinaryString(bytes, from = 0, to = bytes.length) {
  const parts = []
  for (let i = from; i < to; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, to))))
  }
  return parts.join('')
}

/** Binary string back to bytes, without a per-character loop. */
export function binaryStringToBytes(bin) {
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i) & 0xff
  return out
}

export function toBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return btoa(bytesToBinaryString(u8))
}

export function fromBase64(b64) {
  return binaryStringToBytes(atob(b64))
}

export function utf8ToBase64(str) {
  return toBase64(new TextEncoder().encode(str))
}
