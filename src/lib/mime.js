
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

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
