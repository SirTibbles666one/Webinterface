import { useEffect, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu'
import {
  Link2,
  Paperclip,
  Star,
  Mail,
  MailOpen,
  Trash2,
  Folder,
  X,
  MoreHorizontal,
  Download,
  Reply,
  Lock,
  Flame,
} from 'lucide-react'
import api from '@/api'
import { storage } from '@/storage'
import { decryptEmail } from '@/crypto'
import { keySession } from '@/keySession'
import { parseEmail, formatEmailDate } from '@/emailParser'
import { downloadAttachment } from '@/lib/utils'
import { addressBook } from '@/addressBook'
import { SenderAvatar } from '@/components/SenderAvatar'
import { EmailBody } from '@/components/email/EmailBody'
import { PgpAttachment, isPgpAttachment } from '@/components/email/PgpAttachment'
import { AddressRow } from '@/components/email/AddressRow'

const EmailView = ({
  uid,
  myEmail,
  emailMeta,
  onToggleStar,
  onMarkRead,
  onMarkUnread,
  onDeleteEmail,
  onMoveToGroup,
  onRemoveFromGroup,
  groups,
  selectedFolder,
  onReply,
  onComposeTo,
  onMessageDeleted,
}) => {
  const [email, setEmail] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // A line about the message's lifespan, for both sides of a disappearing mail.
  const [note, setNote] = useState(null)
  // Sealed notes are recorded in the sender's own copy — the link and, for a
  // passphrase note, the phrase. Reading them back here is what makes the
  // feature checkable instead of hopeful.
  const [sealed, setSealed] = useState([])
  const [sealedMsg, setSealedMsg] = useState('')
  const [sealedBusy, setSealedBusy] = useState('')
  const noteUrl = (token) => `${window.location.origin}/api/note?t=${token}`
  const when = (secs) => (secs ? new Date(secs * 1000).toLocaleString() : '')
  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text)
      setSealedMsg(`${label} copied`)
    } catch {
      setSealedMsg('Could not copy — select it from the message below')
    }
    setTimeout(() => setSealedMsg(''), 2500)
  }
  const withdraw = async (token) => {
    setSealedBusy(token)
    try {
      await api.post('/note/revoke', { token }, { headers: { Authorization: `Bearer ${storage.getToken()}` } })
      setSealed((prev) => prev.map((n) => (
        n.token === token ? { ...n, state: 'revoked', revoked_at: Math.floor(Date.now() / 1000) } : n
      )))
      setSealedMsg('Withdrawn — the link no longer opens')
    } catch (err) {
      setSealedMsg(err.response?.data?.error ?? 'Could not withdraw that note')
    } finally {
      setSealedBusy('')
    }
    setTimeout(() => setSealedMsg(''), 3000)
  }
  const SEALED_LABEL = {
    sealed: 'not opened yet',
    opened: 'opened, body deleted',
    expired: 'expired unread',
    revoked: 'withdrawn',
  }

  const isStarred = emailMeta?.starred === true
  const isUnread = emailMeta?.unread !== false
  const isInGroup = selectedFolder && selectedFolder !== 'inbox' && selectedFolder !== 'starred'

  useEffect(() => {
    if (uid === null) {
      setEmail(null)
      setError(null)
      setNote(null)
      return
    }
    setLoading(true)
    setError(null)
    setNote(null)
    setSealed([])
    setSealedMsg('')
    const token = storage.getToken()
    ;(async () => {
      try {
        const endpoint = selectedFolder === 'sent' ? '/email/sent/get' : '/email/get'
        const res = await api.post(endpoint, `{"uid":${uid}}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const privateKey = await keySession.get()
        if (!privateKey) throw new Error('Private key is not available. Please log out and log back in.')
        const text = await decryptEmail(res.data.data, res.data.message_key, privateKey)
        const parsed = parseEmail(text)
        addressBook.addAll(parsed?.from ? [parsed.from] : [])
        addressBook.addAll(parsed?.to ?? [])
        addressBook.addAll(parsed?.cc ?? [])
        const receivedAt = res.data.received_at
        setEmail({ ...parsed, date: parsed.date ?? (receivedAt ? new Date(receivedAt) : null) })

        // A sent copy of a sealed note carries "link: …/api/note?t=<token>" and,
        // for a passphrase note, "passphrase: …". Ask the server what became of
        // each one rather than trusting the text alone.
        const body = `${parsed.textBody ?? ''}\n${parsed.htmlBody ?? ''}`
        const tokens = [...body.matchAll(/\/api\/note\?t=([A-Za-z0-9_-]{16,})/g)].map((m) => m[1])
        const phrases = [...body.matchAll(/passphrase:\s*(\S+)/g)].map((m) => m[1])
        if (tokens.length > 0) {
          try {
            const statusRes = await api.post(
              '/note/status',
              { tokens: [...new Set(tokens)] },
              { headers: { Authorization: `Bearer ${token}` } },
            )
            const rows = (statusRes.data.notes ?? []).map((n, i) => ({ ...n, phrase: phrases[i] ?? '' }))
            setSealed(rows)
          } catch {
            // Not the sender's copy, or the endpoint is unreachable: say nothing
            // rather than guess at a state.
          }
        }

        // The server deletes a message-that-deletes-on-read as it serves the
        // body, so "deleted" here is a fact about this response, not a promise.
        if (res.data.deleted) {
          setNote('This message was deleted from the server as it opened. There is no copy left to reopen.')
          onMessageDeleted?.(uid)
        } else if (res.data.ephemeral === 'expire' && res.data.expires_at) {
          setNote(`This message deletes itself on ${new Date(res.data.expires_at * 1000).toLocaleString()}.`)
        }

        // The sender's side: their copy stays, so ask what happened to the other one.
        if (selectedFolder === 'sent') {
          try {
            const status = await api.post('/email/ephemeral', { uids: [uid] }, {
              headers: { Authorization: `Bearer ${token}` },
            })
            const item = status.data?.items?.[0]
            if (item?.state === 'read') {
              setNote(`Read by ${item.recipient} on ${new Date(item.read_at * 1000).toLocaleString()} — their copy was deleted. This is your sent copy.`)
            } else if (item?.state === 'armed') {
              setNote(item.expires_at
                ? `Waiting: it deletes when ${item.recipient} opens it, or on ${new Date(item.expires_at * 1000).toLocaleString()}.`
                : `Waiting: it deletes when ${item.recipient} opens it.`)
            }
          } catch {
            // Status is a nicety: if it fails, the message still opens.
          }
        }
      } catch (err) {
        console.error('[EmailView] Failed to load/decrypt email uid=%s:', uid, err)
        setEmail(null)
        setError(err?.response?.data?.code === 'email_not_found'
          ? 'This message no longer exists. If it was a disappearing message, it was deleted after it was read.'
          : (err?.message ?? 'Unknown error'))
      } finally {
        setLoading(false)
      }
    })()
  }, [uid])

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="h-14 px-4 border-b border-border shrink-0 bg-background flex items-center justify-between gap-3">
        {email && (
          <p className="text-sm font-semibold text-foreground truncate flex-1 min-w-0 flex items-center gap-1.5">
            {email.e2ee && <Lock className="w-3.5 h-3.5 shrink-0 text-primary/70" title="End-to-end encrypted" />}
            {email.subject || '(no subject)'}
          </p>
        )}
        {uid === null && <span className="flex-1" />}
        {uid !== null && (
          <div className="flex items-center gap-2 shrink-0">
            {email && (
              <Button
                onClick={() => onReply?.(email)}
                variant="ghost"
                size="icon"
                className="text-muted-foreground/80 hover:text-foreground"
                title="Reply"
              >
                <Reply className="size-5" />
              </Button>
            )}

            <Button
              onClick={() => (isUnread ? onMarkRead(uid) : onMarkUnread(uid))}
              variant="ghost"
              size="icon"
              className="text-muted-foreground/80 hover:text-foreground"
              title={isUnread ? 'Mark as read' : 'Mark as unread'}
            >
              {isUnread ? <MailOpen className="size-5" /> : <Mail className="size-5" />}
            </Button>

            <Button
              onClick={() => onToggleStar(uid)}
              variant="ghost"
              size="icon"
              className={isStarred ? 'text-amber-500' : 'text-muted-foreground/80 hover:text-amber-500'}
              title={isStarred ? 'Unstar' : 'Star'}
            >
              <Star className={isStarred ? 'size-5 fill-current' : 'size-5'} />
            </Button>

            <Button
              onClick={() => onDeleteEmail(uid)}
              variant="ghost"
              size="icon"
              className="text-muted-foreground/80 hover:text-destructive"
              title="Delete"
            >
              <Trash2 className="size-5" />
            </Button>

            <div className="w-px h-6 bg-border mx-1" />

            <DropdownMenuRoot>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground/80 hover:text-foreground"
                >
                  <MoreHorizontal className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Folder className="size-4" /> Move to group
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      {groups.length > 0 ? groups.map((g) => (
                        <DropdownMenuItem key={g.uid} onClick={() => onMoveToGroup(uid, g.uid)}>
                          <Folder className="size-4" /> {g.title}
                        </DropdownMenuItem>
                      )) : (
                        <DropdownMenuItem disabled>
                          <span className="text-foreground/40">No groups yet</span>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                {isInGroup && (
                  <DropdownMenuItem onClick={() => onRemoveFromGroup(uid)}>
                    <X className="size-4" /> Remove from group
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenuRoot>
          </div>
        )}
      </div>

      {note && (
        <div className="flex items-start gap-2 px-4 py-2 border-b border-border bg-muted/50 text-xs text-muted-foreground shrink-0">
          <Flame className="size-3.5 mt-0.5 shrink-0 text-primary" />
          <span>{note}</span>
        </div>
      )}

      {uid === null ? (
        <div className="flex-1 flex flex-col items-center justify-center text-foreground/60">
          <Mail className="w-16 h-16 mb-4 opacity-20" />
          <h2 className="text-xl font-medium text-foreground/85 mb-2">Nothing selected</h2>
          <p className="text-sm">Select a message to read</p>
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="size-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-red-950/30 border border-red-900/40 text-red-300/80 rounded-md p-4 text-center">
            <h4 className="font-bold mb-1">Error Loading Email</h4>
            <p className="text-sm text-destructive-foreground/60">
              Could not decrypt or retrieve email. The key might be incorrect or the data corrupted.
              <br />
              <span className="font-mono text-xs mt-2 block bg-black/20 p-1 rounded">
                {error}
              </span>
            </p>
          </div>
        </div>
      ) : email ? (
        <ScrollArea className="flex-1">
          <div className="p-6 border-b border-border space-y-6">
            <div className="flex items-start gap-4">
              <SenderAvatar from={email.from} variant="view" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-foreground truncate">
                      {email.from
                        ? email.from.name !== email.from.email.split('@')[0]
                          ? email.from.name
                          : email.from.email
                        : '(unknown sender)'}
                    </p>
                    {email.from && (
                      <p
                        title={email.from.email}
                        onClick={
                          email.from.email !== myEmail && onComposeTo
                            ? () => onComposeTo(email.from.email)
                            : undefined
                        }
                        className={`text-sm text-foreground/60 truncate ${
                          email.from.email !== myEmail && onComposeTo
                            ? 'cursor-pointer hover:text-primary transition-colors'
                            : ''
                        }`}
                      >
                        {email.from.email}
                      </p>
                    )}
                  </div>
                  {email.date && (
                    <span className="text-sm text-foreground/60 shrink-0 whitespace-nowrap pt-0.5">
                      {formatEmailDate(email.date)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <AddressRow label="To" addrs={email.to} myEmail={myEmail} onComposeTo={onComposeTo} />
              <AddressRow label="CC" addrs={email.cc} myEmail={myEmail} onComposeTo={onComposeTo} />
              <AddressRow label="BCC" addrs={email.bcc} myEmail={myEmail} onComposeTo={onComposeTo} />
            </div>
          </div>

          <div className="p-6">
            {sealed.length > 0 && (
              <div className="mb-4 space-y-2">
                {sealed.map((n) => (
                  <div key={n.token} className="rounded-lg border border-primary/25 bg-primary/[0.06] p-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <Link2 className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="font-semibold text-foreground/85">Sealed note</span>
                      <span className="text-foreground/55">to {n.recipient}</span>
                      <span className={`px-1.5 py-0.5 rounded ${
                        n.state === 'sealed' ? 'bg-primary/15 text-primary'
                          : n.state === 'opened' ? 'bg-muted text-foreground/70'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      }`}>
                        {SEALED_LABEL[n.state] ?? n.state}
                      </span>
                      <span className="text-foreground/45">
                        {n.state === 'opened' && n.opened_at ? `opened ${when(n.opened_at)}`
                          : n.state === 'revoked' && n.revoked_at ? `withdrawn ${when(n.revoked_at)}`
                            : n.expires_at ? `closes ${when(n.expires_at)}` : ''}
                      </span>
                      {n.mode === 'passphrase' && <span className="text-foreground/40">· passphrase</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                      <button
                        type="button"
                        onClick={() => copyText(noteUrl(n.token), 'Link')}
                        className="text-primary underline underline-offset-2"
                      >
                        copy link
                      </button>
                      {n.phrase && (
                        <button
                          type="button"
                          onClick={() => copyText(n.phrase, 'Passphrase')}
                          className="text-primary underline underline-offset-2"
                        >
                          copy passphrase
                        </button>
                      )}
                      {n.state === 'sealed' && (
                        <button
                          type="button"
                          onClick={() => withdraw(n.token)}
                          disabled={sealedBusy === n.token}
                          className="text-destructive underline underline-offset-2 disabled:opacity-50"
                        >
                          {sealedBusy === n.token ? 'withdrawing…' : 'withdraw'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {sealedMsg && <p className="text-[11px] text-foreground/60">{sealedMsg}</p>}
              </div>
            )}
            <EmailBody textBody={email.textBody} htmlBody={email.htmlBody} senderHint={email.from} />
          </div>

          {email.attachments.length > 0 && (
            <div className="px-6 pb-6 border-t border-border pt-5">
              <p className="text-sm font-semibold text-foreground/65 mb-3">
                Attachments ({email.attachments.length})
              </p>
              <div className="flex flex-wrap gap-3">
                {email.attachments.map((att, i) => (
                  isPgpAttachment(att) ? (
                    <PgpAttachment key={i} att={att} />
                  ) : (
                  <div
                    key={i}
                    className="inline-flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                  >
                    <Paperclip className="size-4 shrink-0 text-foreground/55" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate max-w-[200px]">
                        {att.name}
                      </p>
                      <p className="text-xs text-foreground/50">
                        {att.contentType}
                      </p>
                    </div>
                    {att.data && (
                      <button
                        onClick={() => downloadAttachment(att)}
                        className="ml-1 p-1 rounded text-foreground/40 hover:text-foreground hover:bg-white/10 transition-colors"
                        title="Download"
                      >
                        <Download className="size-3.5" />
                      </button>
                    )}
                  </div>
                  )
                ))}
              </div>
            </div>
          )}
        </ScrollArea>
      ) : null}
    </div>
  )
}

export default EmailView
