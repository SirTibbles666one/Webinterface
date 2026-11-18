import { Suspense, lazy, useEffect, useState } from 'react'
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
  Users,
  Forward,
  ShieldAlert,
  Lock,
  Flame,
  Undo2,
  Filter,
  Clock,
  AlarmClockOff,
} from 'lucide-react'
import api, { reportSpam } from '@/api'
import { storage } from '@/storage'
import { decryptStored } from '@/lib/decryptStored'
import { keySession } from '@/keySession'
import { parseEmail, formatEmailDate } from '@/emailParser'
import { downloadAttachment } from '@/lib/utils'
import { unpack, verifyEnvelope, fromB64 } from '@/lib/msgSign'
import { verifyBytes } from '@/lib/sigKey'
import { signatureState } from '@/lib/verifyMessage'
import { userFacingError } from '@/lib/userError'
import { addressBook } from '@/addressBook'
import { SenderAvatar } from '@/components/SenderAvatar'
import { EmailBody } from '@/components/email/EmailBody'
import { isPgpAttachment } from '@/lib/pgpRing'
// Decrypting an attachment needs the OpenPGP library; it loads when one is shown.
const PgpAttachment = lazy(() => import('@/components/email/PgpAttachment').then((m) => ({ default: m.PgpAttachment })))
import { AddressRow } from '@/components/email/AddressRow'
import { copyWithToast } from '@/lib/toast'

/** "to me", or the people it actually went to — never a chip the eye has to decode. */
function toSummary(to, myEmail) {
  if (!to || to.length === 0) return 'me'
  if (to.length === 1 && to[0]?.email === myEmail) return 'me'
  return to.map((a) => a.name || a.email).join(', ')
}

const EmailView = ({
  uid,
  myEmail,
  emailMeta,
  onToggleStar,
  onMarkRead,
  onMarkUnread,
  onDeleteEmail,
  // In Trash: a Restore button, and the delete button deletes for good.
  onRestore = null,
  onMoveToGroup,
  onRemoveFromGroup,
  groups,
  selectedFolder,
  onReply,
  onReplyAll,
  onForward,
  arrivedAt = null,
  // Set when this message is being read from the Junk view, where the useful action is
  // the opposite one: take it back out of Junk.
  inJunk = false,
  onReported = null,
  onComposeTo,
  onMessageDeleted,
  onBack,
  // Sender actions: file this sender's mail into a group as it arrives, or delete what is here.
  onFileSender = null,
  onDeleteFromSender = null,
  countFromSender = null,
  // Putting a message away until a time you chose, and the way back before then.
  onSnooze = null,
  onWake = null,
  // Locked mail is not an error: the reader asks the shell to open the unlock prompt.
  onRequestUnlock = null,
  // 'inline' renders the message inside the list (phone), not as a full-height pane:
  // no back control, no page-level scroll container, and the action row stays inside
  // the block instead of pinning itself to the bottom edge.
  inline = false,
  snoozedUntil = null,
  snoozeOptions = [],
}) => {
  const [email, setEmail] = useState(null)
  // 'spam' | 'ham' once reported, so the button can confirm and then stop offering itself
  const [spamReport, setSpamReport] = useState(null)
  const [spamError, setSpamError] = useState('')
  // Distinct from `error`: a locked key is a state with a way out, not a failure.
  const [locked, setLocked] = useState(false)
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
    if (await copyWithToast(text, `${label} copied`)) {
      setSealedMsg(`${label} copied`)
    } else {
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
  // Not for your own sent copies: filing or bulk-deleting "mail from me" is not what anyone means.
  const senderAddress = (email?.from?.email || '').toLowerCase()
    && (email.from.email || '').toLowerCase() !== (myEmail || '').toLowerCase()
    ? email.from.email.toLowerCase()
    : ''
  const fromSenderCount = senderAddress && countFromSender ? countFromSender(senderAddress) : 0

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
    setLocked(false)
    setSealed([])
    setSealedMsg('')
    const token = storage.getToken()
    ;(async () => {
      try {
        const endpoint = selectedFolder === 'sent' ? '/email/sent/get' : '/email/get'
        const res = await api.post(endpoint, `{"uid":"${uid}"}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const privateKey = await keySession.get()
        if (!privateKey) {
          setLocked(true)
          setLoading(false)
          return
        }
        const text = await decryptStored(res.data.data, res.data.message_key, privateKey)
        const parsed = parseEmail(text)
        // The lock must report something this client can check, not something the server
        // wrote. It used to be read from an OpenNeutron-E2EE header inside the body, so a
        // hostile server could render any message and set that header to show a lock.
        // A message that reached the reader through a message_key was sealed to a key
        // this browser holds and decrypted — that is a local fact. It still does not say
        // *who* sealed it; sender signatures are the next step, not this one.
        const arrivedSealed = !!res.data.message_key
        const sigState = await signatureState({
          payloadB64: res.data.data,
          parsed,
          deliveredTo: res.data.alias,
          username: storage.getUsername(),
          fetchKeys: (addresses) => api.post('/email/publickeys', { addresses }, {
            headers: { Authorization: `Bearer ${token}` },
          }).then((r) => r.data),
        })
        addressBook.addAll(parsed?.from ? [parsed.from] : [])
        addressBook.addAll(parsed?.to ?? [])
        addressBook.addAll(parsed?.cc ?? [])
        const receivedAt = res.data.received_at
        setEmail({
          ...parsed,
          e2ee: sigState === 'verified',
          sigState,
          arrivedSealed,
          date: parsed.date ?? (receivedAt ? new Date(receivedAt) : null),
        })

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
          : userFacingError(err, { fallback: 'This message could not be opened. Try again in a moment.' }))
      } finally {
        setLoading(false)
      }
    })()
  }, [uid])

  return (
    <div
      className={`flex flex-col bg-background ${
        // Inline, this block is a slot inside a list row, so it must not be a flex
        // column with `h-full`: that resolved to the row's height, the middle scroller
        // shrank to fit, and the action bar was pushed out of the box — the "buttons
        // are hidden" complaint. As a plain block the bar simply stacks under the body.
        inline ? 'block' : 'flex flex-col h-full overflow-hidden'
      }`}
    >
      {/* The bar carries actions only. What the message is, and who sent it,
          belongs in the reading column below, where the eye already is. */}
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line px-3 max-sm:h-12 max-sm:px-2">
        {/* Hidden only where the pane sits beside the list and the list is still reachable.
            It was `md:hidden`, so a 768px tablet got a full-screen reader with no way out. */}
        {onBack && !inline && (
          <button
            type="button"
            onClick={onBack}
            className="min-[1200px]:hidden flex min-h-11 items-center gap-1 pr-1.5 text-[13px] text-ink-2"
            aria-label="Back to inbox"
          >
            <span aria-hidden="true" className="text-[15px]">←</span> Inbox
          </button>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            onClick={() => (isUnread ? onMarkRead(uid) : onMarkUnread(uid))}
            variant="ghost"
            size="icon"
            className="size-8 text-ink-3 hover:bg-accent hover:text-ink-1 max-sm:size-11"
            title={isUnread ? 'Mark as read' : 'Mark as unread'}
          >
            {isUnread ? <MailOpen className="size-4" /> : <Mail className="size-4" />}
          </Button>

          <Button
            onClick={() => onToggleStar(uid)}
            variant="ghost"
            size="icon"
            className={`size-8 max-sm:size-11 hover:bg-accent ${isStarred ? 'text-sand' : 'text-ink-3 hover:text-sand'}`}
            title={isStarred ? 'Unstar' : 'Star'}
          >
            <Star className={`size-4 ${isStarred ? 'fill-current' : ''}`} />
          </Button>

          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />

          <DropdownMenuRoot>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-ink-3 hover:bg-accent hover:text-ink-1 max-sm:size-11"
                title="More"
              >
                <MoreHorizontal className="size-4" />
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
                        <span className="text-ink-3">No groups yet</span>
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
              {senderAddress && onFileSender && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Filter className="size-4" /> Always file this sender in…
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      {groups.length > 0 ? groups.map((g) => {
                        const already = (g.filter_addresses ?? []).includes(senderAddress)
                        return (
                          <DropdownMenuItem key={g.uid} disabled={already} onClick={() => onFileSender(senderAddress, g.uid)}>
                            <Folder className="size-4" /> {g.title}{already ? ' — already' : ''}
                          </DropdownMenuItem>
                        )
                      }) : (
                        <DropdownMenuItem disabled>
                          <span className="text-ink-3">Make a group first</span>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              )}
              {onSnooze && (
                <>
                  <DropdownMenuSeparator />
                  {snoozedUntil ? (
                    <DropdownMenuItem onClick={() => onWake(uid)}>
                      <AlarmClockOff className="size-4" /> Bring back now
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Clock className="size-4" /> Snooze until…
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent>
                          {snoozeOptions.map((option) => (
                            <DropdownMenuItem key={option.key} onClick={() => onSnooze(uid, option.until)}>
                              {option.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>
                  )}
                </>
              )}
              {senderAddress && onDeleteFromSender && fromSenderCount > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onClick={() => onDeleteFromSender(senderAddress)}>
                    <Trash2 className="size-4" /> Delete all {fromSenderCount} from this sender
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenuRoot>

          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />

          {onRestore && (
            <Button
              onClick={() => onRestore(uid)}
              variant="ghost"
              className="h-8 gap-1.5 px-2.5 text-[12px] text-ink-2 hover:text-ink-1"
              title="Restore to where it was"
            >
              <Undo2 className="size-4" /> Restore
            </Button>
          )}
          {/* Destructive: colour, and it sits apart from the rest. */}
          <Button
            onClick={() => onDeleteEmail(uid)}
            variant="ghost"
            size="icon"
            className="size-8 text-ink-3 hover:bg-destructive/10 hover:text-destructive max-sm:size-11"
            title={onRestore ? 'Delete for good' : 'Delete (moves to Trash)'}
            aria-label={onRestore ? 'Delete for good' : 'Delete'}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {note && (
        <div className="flex items-start gap-2 px-4 py-2 border-b border-border bg-muted/50 text-xs text-muted-foreground shrink-0">
          <Flame className="size-3.5 mt-0.5 shrink-0 text-primary" />
          <span>{note}</span>
        </div>
      )}

      {/* min-h-0 on the scroller below: a flex child's default min-height is its
          content, so without it the message pushes the viewport to its own height and
          the reader's overflow-hidden cuts it at the fold — unscrollable long mail. */}
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
      ) : locked ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-lg border border-line bg-card p-5 text-center">
            <Lock className="mx-auto size-5 text-ink-3" />
            <h2 className="display mt-3 text-[17px] text-ink-1">This message is locked</h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
              Messages are decrypted in this browser only. Unlock the mailbox to read this one —
              nothing has been lost, and the sender does not need to resend it.
            </p>
            {onRequestUnlock && (
              <Button onClick={onRequestUnlock} className="mt-4 w-full max-sm:min-h-[44px]">
                Unlock mailbox
              </Button>
            )}
          </div>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-danger-surface border border-danger/40 text-danger-ink rounded-md p-4 text-center">
            <h4 className="font-bold mb-1">Error Loading Email</h4>
            <p className="text-sm text-danger-ink">
              Could not decrypt or retrieve email. The key might be incorrect or the data corrupted.
              <br />
              <span className="font-mono text-xs mt-2 block bg-danger/10 p-1 rounded">
                {error}
              </span>
            </p>
          </div>
        </div>
      ) : email ? (
        <div
          className={`custom-scrollbar overflow-y-auto overscroll-contain ${
            // 34vh, not 42: the bar now carries four verbs, and at 42 the bar itself fell
            // below the list viewport — the buttons were there, just not on screen.
            inline ? 'max-h-[70vh]' : 'flex-1 min-h-0'
          }`}
        >
          {/* One measure for the whole message: a line of text that runs the
              width of a wide window is unreadable, and the header has to sit in
              the same column as the body it introduces. */}
          {/* No bottom padding here: the divider's own margin is the gap. With padding as
              well, the body started 68px below the line that introduces it. */}
          <div className="mx-auto w-full max-w-[720px] px-6 max-sm:px-4">
            <h1 className="display mt-7 flex items-start gap-2 text-[22px] leading-snug text-ink-1 max-sm:mt-3 max-sm:text-[19px] max-sm:leading-[1.3]">
              <span className="min-w-0 line-clamp-2 max-sm:line-clamp-2">{email.subject || '(no subject)'}</span>
              {email.e2ee && (
                <Lock
                  className="mt-1.5 size-3.5 shrink-0 text-primary"
                  aria-label="Signed by the sender and verified"
                />
              )}
            </h1>

            <div className="mt-5 flex items-start gap-3 max-sm:mt-2">
              <SenderAvatar from={email.from} variant="view" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[13.5px] font-semibold text-ink-1" title={email.from?.name || email.from?.email || ''}>
                    {email.from?.name || email.from?.email || '(unknown sender)'}
                  </p>
                  <span className="mono shrink-0 text-[11.5px] text-ink-3">
                    {formatEmailDate(email.date)}
                  </span>
                </div>
                {email.from?.name && email.from.name !== email.from.email?.split('@')[0] && (
                  <p
                    title={email.from.email}
                    onClick={
                      email.from.email !== myEmail && onComposeTo
                        ? () => onComposeTo(email.from.email)
                        : undefined
                    }
                    className={`mono truncate text-[11.5px] text-ink-3 ${
                      email.from.email !== myEmail && onComposeTo
                        ? 'cursor-pointer transition-colors duration-120 hover:text-primary'
                        : ''
                    }`}
                  >
                    {email.from.email}
                  </p>
                )}
                <p className="mt-1 text-[12px] text-ink-2 max-sm:hidden">
                  to {toSummary(email.to, myEmail)}
                </p>
              </div>
            </div>

            {(email.cc?.length > 0 || email.bcc?.length > 0) && (
              <div className="mt-3 space-y-1.5">
                <AddressRow label="CC" addrs={email.cc} myEmail={myEmail} onComposeTo={onComposeTo} />
                <AddressRow label="BCC" addrs={email.bcc} myEmail={myEmail} onComposeTo={onComposeTo} />
              </div>
            )}

            <div className="my-5 h-px bg-line max-sm:my-3" />
          </div>

          {/* The phone bar is fixed over the page, so the message needs room to end
              above it instead of underneath it. */}
          <div className="mx-auto w-full max-w-[720px] px-6 pb-10 max-sm:px-4 max-sm:pb-24">
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
                            : 'bg-warn-surface text-warn'
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
            {email.sigState === 'invalid' ? (
              // A failed signature is not one of the states a message may render in. The
              // body is withheld entirely: this is the one case an attacker wants shown.
              <div className="mt-5 rounded-lg border border-danger/40 bg-danger-surface px-4 py-3">
                <p className="text-[13px] font-medium text-danger-ink">
                  This message failed its signature check.
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
                  It claims to be from {email.from?.email || 'its sender'}, but the signature does not
                  match the message. Nothing has been shown, because a message whose signature fails is
                  exactly the one that should not be opened. Ask the sender to send it again.
                </p>
              </div>
            ) : (
              <EmailBody textBody={email.textBody} htmlBody={email.htmlBody} senderHint={email.from} />
            )}
          </div>

          {email.attachments.length > 0 && (
            <div className="px-6 pb-6 border-t border-border pt-5 max-sm:pb-28">
            {/* The action bar is fixed to the bottom edge on a phone; the attachments
                are the last thing in the scroll pane, so they need the bar's height
                reserved here or the chip is clipped under it — measured, not guessed. */}
              <p className="text-sm font-semibold text-foreground/65 mb-3">
                Attachments ({email.attachments.length})
              </p>
              <div className="flex flex-wrap gap-3">
                {email.attachments.map((att, i) => (
                  isPgpAttachment(att) ? (
                    <Suspense key={i} fallback={null}><PgpAttachment att={att} /></Suspense>
                  ) : (
                  <div
                    key={i}
                    className="inline-flex items-center gap-2.5 px-3 py-2 rounded-lg bg-secondary/60 border border-line transition-colors hover:bg-accent"
                  >
                    <Paperclip className="size-4 shrink-0 text-ink-3" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-1 truncate max-w-[200px]" title={att.name}>
                        {att.name}
                      </p>
                      <p className="text-xs text-ink-3">
                        {att.contentType}
                      </p>
                    </div>
                    {att.data && (
                      <button
                        onClick={() => downloadAttachment(att)}
                        className="ml-1 rounded p-1 text-ink-3 transition-colors hover:bg-accent hover:text-ink-1 max-sm:min-h-[44px] max-sm:min-w-[44px]"
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
        </div>
      ) : null}

      {/* The three verbs a reader wants, on a bar that cannot scroll away. It sits
          outside the message's scroll area, so it is on screen when the message is long,
          and it lifts above the iPhone home indicator. "Reply" carries the word as well
          as the arrow: an arrow alone next to a back arrow is a guess. */}
      {email && (
        <div className={`shrink-0 border-t border-line bg-background/95 px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] ${
            inline
              // Inline is inside a scrolling list, so a bar at the bottom of the block
              // scrolls away with it. Sticky depended on its block being in view and still
              // measured on screen while painting under the fold. Fixed cannot be scrolled
              // out: the verbs float above the list, and the body carries padding so the
              // last lines are not hidden underneath them.
              ? "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-30 max-sm:backdrop-blur-sm"
              : "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-30 max-sm:backdrop-blur-sm"
          }`}>
          <div className="mx-auto flex w-full max-w-[720px] items-center gap-1.5 overflow-x-auto sm:gap-2">
            <Button
              onClick={() => onReply?.({ ...email, alias: arrivedAt })}
              variant="outline"
              className="shrink-0 gap-1.5 px-2.5 text-[13px] max-sm:min-h-11 sm:flex-none sm:px-3"
            >
              <Reply className="size-3.5" /> Reply
            </Button>
            {onReplyAll && (
              <Button
                onClick={() => onReplyAll({ ...email, alias: arrivedAt })}
                variant="ghost"
                className="shrink-0 gap-1.5 px-2.5 text-[13px] max-sm:min-h-11 text-ink-2 sm:px-3"
              >
                <Users className="size-3.5" /> <span className="max-sm:hidden">Reply all</span>
                <span className="sm:hidden">All</span>
              </Button>
            )}
            {onForward && (
              <Button
                onClick={() => onForward({ ...email, alias: arrivedAt })}
                variant="ghost"
                className="shrink-0 gap-1.5 px-2.5 text-[13px] max-sm:min-h-11 text-ink-2 sm:px-3"
              >
                <Forward className="size-3.5" /> <span className="max-sm:hidden">Forward</span>
                <span className="sm:hidden">Fwd</span>
              </Button>
            )}
            {email && !spamReport && (
              <Button
                onClick={async () => {
                  // The server cannot read this message, so the report carries it. Built
                  // from what is already decrypted on screen, text first: rspamd learns
                  // from words and links, and sending less is sending less.
                  const addr = (v) =>
                    typeof v === 'object' && v ? v.address || v.email || v.name || '' : String(v || '')
                  const raw = [
                    `From: ${addr(email.from)}`,
                    `To: ${(Array.isArray(email.to) ? email.to : [email.to]).map(addr).filter(Boolean).join(', ')}`,
                    `Subject: ${email.subject || ''}`,
                    `Date: ${email.date ? new Date(email.date).toUTCString() : new Date().toUTCString()}`,
                    'Content-Type: text/plain; charset=utf-8',
                    '',
                    String(email.textBody || '').slice(0, 200000),
                  ].join('\r\n')
                  try {
                    const result = await reportSpam(uid, inJunk ? 'ham' : 'spam', raw)
                    // The server may file the message without being able to teach the
                    // filter (too short, already known). Say which happened.
                    const verdict = inJunk ? 'ham' : 'spam'
                    setSpamReport(result?.note || verdict)
                    setSpamError('')
                    // The list behind this reader has to change now: a reported message
                    // that stays visible until the next refresh looks like the report failed.
                    onReported?.(uid, verdict)
                  } catch (err) {
                    // An honest failure beats a button that lies about having taught it.
                    setSpamError(err?.response?.data?.error || 'Could not report this message')
                  }
                }}
                variant="ghost"
                className="shrink-0 gap-1.5 px-2.5 text-[13px] max-sm:min-h-11 text-ink-2 sm:px-3"
                title={
                  spamError ||
                  (inJunk
                    ? 'Not spam: move it back to the Inbox and teach the filter.'
                    : 'Teach the filter: this is spam. The message text is sent to the server.')
                }
              >
                <ShieldAlert className="size-3.5" />
                <span className="max-sm:hidden">{inJunk ? 'Not spam' : 'Report spam'}</span>
                <span className="sm:hidden">{inJunk ? 'Not spam' : 'Spam'}</span>
              </Button>
            )}
            {spamReport && (
              <span className="px-2 text-[12.5px] text-ink-3" role="status">
                {spamReport === 'ham'
                  ? 'Moved back to the Inbox'
                  : spamReport === 'spam'
                    ? 'Reported — the filter will learn from it'
                    : `Moved to Junk — ${spamReport}`}
              </span>
            )}
            {spamError && !spamReport && (
              <span className="px-2 text-[12.5px] text-destructive" role="alert">
                {spamError}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default EmailView
