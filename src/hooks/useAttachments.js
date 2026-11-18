import { useState, useRef, useCallback } from 'react'
import { MAX_ATTACHMENT_BYTES, readFileAsBase64, formatBytes } from '@/lib/mime'

export function useAttachments({ onError }) {
  const [attachments, setAttachments] = useState([])
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef(null)

  const addFiles = useCallback((files) => {
    const oversized = []
    const toAdd     = []

    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        oversized.push(`"${file.name}" (${formatBytes(file.size)})`)
        continue
      }
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

    if (oversized.length > 0) {
      onError(`${oversized.length === 1 ? 'File exceeds' : 'Files exceed'} the 25 MB limit: ${oversized.join(', ')}`)
    }

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
  }, [onError])

  const removeAttachment = useCallback((id) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  return { attachments, isDragOver, setIsDragOver, fileInputRef, addFiles, removeAttachment }
}
