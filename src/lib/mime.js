
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

// Measured, not assumed. A 10 MB file left the browser as a 36,490,000-byte request: the bytes are
// base64'd into the MIME, base64'd again inside the JSON envelope, and sealed once per recipient.
// So the size a reader picks and the size the server receives differ by 3.65x, and a limit written
// in file bytes is a lie unless it is divided by this.
export const WIRE_MULTIPLIER = 3.65

// server.max_request_body_bytes, with Cloudflare's 100 MB request ceiling as the harder wall.
export const MAX_REQUEST_BYTES = 96 * 1024 * 1024

/** What a set of attachments weighs once encrypted, encoded and addressed. */
export function wireBytesFor(plainBytes) {
  return Math.ceil(plainBytes * WIRE_MULTIPLIER)
}

/** The most attachments one message can carry, chosen to stay clear of the request cap. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 24 * 1024 * 1024

export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

export function encodeRfc2047Word(str) {
  if (!str) return ''
  if (!/[^\x00-\x7F]/.test(str)) return str
  return `=?UTF-8?B?${utf8ToBase64(str)}?=`
}

export function foldBase64(b64) {
  return (b64.match(/.{1,76}/g) ?? [b64]).join('\r\n')
}

export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result)
      let bin = ''
      bytes.forEach((b) => (bin += String.fromCharCode(b)))
      resolve(btoa(bin))
    }
    reader.onerror = () =>
      reject(new Error(`Cannot read "${file.name}": ${reader.error?.message ?? 'unknown error'}`))
    reader.readAsArrayBuffer(file)
  })
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
