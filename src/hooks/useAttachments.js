import { useState, useRef, useCallback } from 'react'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  readFileAsBase64,
  formatBytes,
} from '@/lib/mime'

export function useAttachments({ onError }) {
  const [attachments, setAttachments] = useState([])
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef(null)

  const addFiles = useCallback((files) => {
    const refused = []
    const toAdd = []
    // The per-message budget counts what is already attached, because the wire size is what the
    // server refuses — not any single file.
    let carried = attachments.reduce((sum, a) => sum + (a.size || 0), 0)

    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        refused.push(
          `${file.name} is ${formatBytes(file.size)}, past the ${formatBytes(MAX_ATTACHMENT_BYTES)} a single file can be.`,
        )
        continue
      }
      if (carried + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
        refused.push(
          `${file.name} would take this message to ${formatBytes(carried + file.size)} of attachments. ` +
            `Encrypted mail carries ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} per message, because encryption and ` +
            `encoding make it about 3.6 times larger on the way out.`,
        )
        continue
      }
      carried += file.size
      toAdd.push({
        id:        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name:      file.name,
        size:      file.size,
        type:      file.type,
        file,
        status:    'loading',
        data:      null,
        readError: null,
      })
    }

    if (refused.length > 0) onError(refused.join(' '))

    if (toAdd.length === 0) return

    setAttachments((prev) => [...prev, ...toAdd])

    for (const att of toAdd) {
      readFileAsBase64(att.file)
        .then((data) => {
          setAttachments((prev) => prev.map((a) => (a.id === att.id ? { ...a, status: 'ready', data } : a)))
        })
        .catch((err) => {
          setAttachments((prev) => prev.map((a) => (a.id === att.id ? { ...a, status: 'error', readError: err.message } : a)))
        })
    }
  }, [attachments, onError])

  const removeAttachment = useCallback((id) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  return { attachments, isDragOver, setIsDragOver, fileInputRef, addFiles, removeAttachment }
}
