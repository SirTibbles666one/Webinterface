import { useState, useCallback } from 'react'
import api from '@/api'
import { storage } from '@/storage'
import { keySession } from '@/keySession'
import { encryptEmail, getPublicCryptoKeyFromPrivate, importPublicKeyBase64, hashPublicKey } from '@/crypto'
import { buildEmail } from '@/lib/emailBuilder'
import { loadProfile, formatSender } from '@/lib/profile'
import { utf8ToBase64 } from '@/lib/mime'
import { isValidEmail } from '@/lib/utils'

export function useSendEmail({ myEmail, replyData, draftId, onDeleteDraft, onSent, onClose }) {
  const [sendState, setSendState] = useState('idle')
  const [sendError, setSendError] = useState('')
  const [sendResults, setSendResults] = useState([])

  const reportError = useCallback((msg) => {
    setSendError(msg)
    setSendState('error')
  }, [])

  const handleSend = async ({ toChips, ccChips, bccChips, subject, body, attachments, ephemeral }) => {
    const allTo  = toChips.filter((a) => a.trim())
    const allCc  = ccChips.filter((a) => a.trim())
    const allBcc = bccChips.filter((a) => a.trim())
    const allRecipients = [...allTo, ...allCc, ...allBcc]

    if (allTo.length === 0) {
      reportError('Add at least one recipient in the To field.')
      return
    }
    const invalid = allRecipients.filter((a) => !isValidEmail(a))
    if (invalid.length > 0) {
      reportError(`Invalid address${invalid.length > 1 ? 'es' : ''}: ${invalid.join(', ')}`)
      return
    }
    const loadingFiles = attachments.filter((a) => a.status === 'loading')
    if (loadingFiles.length > 0) {
      reportError(`${loadingFiles.length} attachment${loadingFiles.length > 1 ? 's are' : ' is'} still loading - please wait.`)
      return
    }
    const failedFiles = attachments.filter((a) => a.status === 'error')
    if (failedFiles.length > 0) {
      reportError(`Remove failed attachment${failedFiles.length > 1 ? 's' : ''} before sending: ${failedFiles.map((a) => a.name).join(', ')}`)
      return
    }

    setSendError('')
    setSendState('resolving')

    try {
      const token   = storage.getToken()
      const headers = { Authorization: `Bearer ${token}` }

      setSendState('fetchingkeys')
      const resolveRes = await api.post('/email/publickeys', { addresses: allRecipients }, { headers })
      const keyMap = Object.fromEntries(
        (resolveRes.data.keys ?? []).map((k) => [k.address.toLowerCase(), k.public_key])
      )

      setSendState('encrypting')

      const hasAnyKey = allRecipients.some((addr) => !!keyMap[addr.toLowerCase()])

      const profile = loadProfile()
      const fromHeader = formatSender(myEmail, profile.displayName)

      // The signature is appended to the body, so it is inside the ciphertext
      // like everything else the recipient reads.
      const signature = (profile.signature || '').trim()
      const bodyWithSignature = signature
        ? `${body}${body && !body.endsWith('\n') ? '\n' : ''}\n-- \n${signature}`
        : body

      const rawEmail = buildEmail({
        from:        fromHeader,
        to:          allTo,
        cc:          allCc,
        subject,
        body:        bodyWithSignature,
        attachments: attachments.map(({ name, type, data }) => ({ name, type, data })),
        inReplyTo:   replyData?.inReplyTo ?? '',
        references:  replyData?.references ?? '',
        e2ee:        hasAnyKey,
      })

      const privateKey = await keySession.get()
      if (!privateKey) throw new Error('Session expired - please log in again.')

      const myPublicKey = await getPublicCryptoKeyFromPrivate(privateKey)
      const localCopy   = await encryptEmail(rawEmail, myPublicKey)

      let publicKeyHash = ''
      const storedPubKey = storage.getPublicKey()
      if (storedPubKey) publicKeyHash = await hashPublicKey(storedPubKey)

      const recipientsPayload = {}
      for (const addr of allRecipients) {
        const recipientKeyB64 = keyMap[addr.toLowerCase()]
        if (recipientKeyB64) {
          const recipientKey = await importPublicKeyBase64(recipientKeyB64)
          const { aes_encrypted, data_encrypted } = await encryptEmail(rawEmail, recipientKey)
          recipientsPayload[addr] = { aes_encrypted, data_encrypted, e2ee: true }
        } else {
          recipientsPayload[addr] = { aes_encrypted: '', data_encrypted: utf8ToBase64(rawEmail), e2ee: false }
        }
      }

      setSendState('sending')

      const res = await api.post(
        '/email/sendencrypted',
        {
          localcopy: {
            to:              allRecipients,
            timestamp:       Math.floor(Date.now() / 1000),
            public_key_hash: publicKeyHash,
            raw_data:        localCopy.data_encrypted,
            message_key:     localCopy.aes_encrypted,
            e2ee:            true,
          },
          recipients: recipientsPayload,
          // Only applied to mailboxes on this server; the compose window says so.
          ...(ephemeral && (ephemeral.deletes_on_read || ephemeral.expires_in_seconds)
            ? { ephemeral }
            : {}),
        },
        { headers },
      )

      if (res.data.sent_email_uid) storage.addSentUid(res.data.sent_email_uid)
      if (draftId) onDeleteDraft?.(draftId)

      const results = res.data.delivery_results ?? []
      setSendResults(results)
      if (onSent) onSent(res.data.sent_email_uid)

      // The server reports delivery per recipient. A rejected address is not a
      // sent message: saying "Sent" would hide a message the user believes went
      // out, so the compose window stays open and names what failed.
      const failed = results.filter((r) => r && r.success === false)
      if (failed.length > 0) {
        const summary = failed
          .slice(0, 3)
          .map((r) => `${r.address}${r.error ? ` — ${r.error}` : ''}`)
          .join('; ')
        const more = failed.length > 3 ? ` (+${failed.length - 3} more)` : ''
        setSendError(`Not delivered to ${failed.length} of ${results.length}: ${summary}${more}`)
        setSendState('error')
        return
      }

      setSendState('done')
      setTimeout(() => onClose(null), 2000)
    } catch (err) {
      reportError(err.response?.data?.error ?? err.message ?? 'Send failed. Please try again.')
    }
  }

  return { sendState, sendError, sendResults, handleSend, reportError }
}
