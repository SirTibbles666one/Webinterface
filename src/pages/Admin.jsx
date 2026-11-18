import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, RefreshCw, Plus, Trash2, ShieldCheck, Shield, KeyRound, Copy, X,
  Search, Server, HardDrive, Inbox, ExternalLink, Power,
  History,
} from 'lucide-react'
import EmptyArt from '@/components/EmptyArt'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmModal, InputModal, Modal, ModalHeader, ModalContent, ModalFooter } from '@/components/ui/Modal'
import {
  adminGetUsers, adminCreateUser, adminDeleteUser, adminSetAdminStatus, adminSetSuspended,
  adminGetWaitlist, adminApproveWaitlist, adminGetPending, adminApprovePending,
  adminDenyPending, adminSetRecoveryAddress, adminSendRecovery,
  adminGetRecipients, adminGetDiskUsage, adminListAudit, adminMailHealth, adminSetRole,
} from '@/api'
import { storage } from '@/storage'

/**
 * Admin: four tabs, one shell, the same tokens as the rest of the app.
 *
 * This used to be a single long page of stacked tables — pending accounts,
 * invites, then every user — with no way to answer the question an operator
 * actually has ("why did mail not arrive"). The four questions are now four
 * tabs, and each one loads the data it needs.
 */

const TABS = [
  { id: 'people', label: 'People', icon: Inbox },
  { id: 'access', label: 'Access', icon: ShieldCheck },
  { id: 'deliverability', label: 'Deliverability', icon: Server },
  { id: 'system', label: 'System', icon: HardDrive },
  // Last, because it is where you go when something needs explaining rather than doing.
  { id: 'activity', label: 'Activity', icon: History },
]

const inviteStatus = (status) => {
  if (status === 'pending') return 'waiting for a decision'
  if (status === 'approved') return 'code issued, not used yet'
  if (status === 'used') return 'account created with this code'
  return status
}

const bytes = (n) => {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

const when = (seconds) => (seconds ? new Date(seconds * 1000).toLocaleString() : 'unknown')

function Panel({ title, note, action, children }) {
  return (
    <section>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="display text-[18px] text-ink-1">{title}</h2>
          {note && <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-3">{note}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card">{children}</div>
    </section>
  )
}

function Empty({ children, art }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {art && <EmptyArt kind={art} className="h-11 w-[58px] text-ink-4" />}
      <p className={`max-w-[46ch] text-[12.5px] leading-relaxed text-ink-3 ${art ? 'mt-3' : ''}`}>{children}</p>
    </div>
  )
}

function Admin() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('people')
  const [error, setError] = useState('')
  const [modalState, setModalState] = useState({ type: null })

  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [pending, setPending] = useState([])
  const [pendingLoading, setPendingLoading] = useState(true)
  const [invites, setInvites] = useState([])
  const [invitesLoading, setInvitesLoading] = useState(true)
  const [recipients, setRecipients] = useState(null)
  const [disk, setDisk] = useState(null)
  // null = not read yet; { records, total, chain } once the server answers.
  const [audit, setAudit] = useState(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [health, setHealth] = useState(null)

  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState('')
  const [query, setQuery] = useState('')
  const [recovery, setRecovery] = useState(null)
  // The setup token exists only in the create response; if this panel is
  // closed the password cannot be shown again, so it lives beside the modal.
  const [created, setCreated] = useState(null)

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true)
    try {
      const data = await adminGetUsers()
      setUsers(data.users ?? [])
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load accounts')
    } finally {
      setUsersLoading(false)
    }
  }, [])

  const fetchPending = useCallback(async () => {
    setPendingLoading(true)
    try {
      const data = await adminGetPending()
      setPending(data.entries ?? [])
    } catch {
      setPending([])
    } finally {
      setPendingLoading(false)
    }
  }, [])

  const fetchInvites = useCallback(async () => {
    setInvitesLoading(true)
    try {
      const data = await adminGetWaitlist()
      setInvites(data.entries ?? [])
    } catch {
      setInvites([])
    } finally {
      setInvitesLoading(false)
    }
  }, [])

  const fetchDelivery = useCallback(async () => {
    try {
      const [r, d] = await Promise.all([adminGetRecipients(), adminGetDiskUsage()])
      setRecipients(r?.recipients ?? [])
      setDisk(d?.users ?? [])
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not read delivery state')
    }
  }, [])

  const fetchHealth = useCallback(async () => {
    try {
      setHealth(await adminMailHealth())
    } catch {
      // Leave it null: the card renders "could not be read" rather than zeros.
      setHealth(null)
    }
  }, [])

  const fetchAudit = useCallback(async () => {
    setAuditLoading(true)
    try {
      const data = await adminListAudit({ limit: 50 })
      setAudit(data)
    } catch (err) {
      // A server without the route is not an empty log — say which it is.
      const status = err?.response?.status
      setAudit({ records: [], total: 0, chain: null, unavailable: status === 404 || status === 501 })
    } finally {
      setAuditLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'activity' && audit === null) fetchAudit()
  }, [tab, audit, fetchAudit])

  useEffect(() => {
    if (tab === 'deliverability' && health === null) fetchHealth()
  }, [tab, health, fetchHealth])

  useEffect(() => {
    if (!storage.getIsAdmin()) {
      navigate('/')
      return
    }
    fetchUsers()
    fetchPending()
    fetchInvites()
    fetchDelivery()
  }, [fetchUsers, fetchPending, fetchInvites, fetchDelivery, navigate])

  const refresh = (which = tab) => {
    setError('')
    if (which === 'activity') fetchAudit()
    if (which === 'people') fetchUsers()
    if (which === 'access') { fetchPending(); fetchInvites() }
    if (which === 'deliverability') fetchHealth()
    if (which === 'deliverability' || which === 'system') fetchDelivery()
  }

  // ── decisions ────────────────────────────────────────────────────────────
  const decidePending = async (username, action) => {
    setBusy(username)
    setError('')
    try {
      if (action === 'approve') await adminApprovePending(username)
      else await adminDenyPending(username)
      await Promise.all([fetchPending(), fetchUsers()])
    } catch (err) {
      setError(err?.response?.data?.error || `Could not ${action} that account`)
    } finally {
      setBusy('')
    }
  }

  const approveInvite = async (email) => {
    setBusy(email)
    setError('')
    try {
      await adminApproveWaitlist(email)
      await fetchInvites()
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not approve that request')
    } finally {
      setBusy('')
    }
  }

  const inviteMessage = (entry) => `Your Sloth Lee Mail invite code is: ${entry.code}

Go to https://mail.slothlee.xyz/signup and paste it to create your account. It works once.`

  const copyInvite = async (entry) => {
    try {
      await navigator.clipboard.writeText(inviteMessage(entry))
      setCopied(entry.email)
      setTimeout(() => setCopied(''), 2500)
    } catch {
      setError('Could not copy — select the code and copy it by hand')
    }
  }

  const shareInvite = async (entry) => {
    const text = inviteMessage(entry)
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Sloth Lee Mail invite', text })
        return
      }
      window.location.href =
        `mailto:${encodeURIComponent(entry.email)}?subject=${encodeURIComponent('Your Sloth Lee Mail invite')}&body=${encodeURIComponent(text)}`
    } catch {
      // A cancelled share sheet is not an error worth showing.
    }
  }

  const createUser = async (username) => {
    setModalState({ type: null })
    try {
      const data = await adminCreateUser(username.trim())
      setCreated({
        username: data?.username || username.trim(),
        token: data?.setup_token || '',
        copied: false,
        error: '',
      })
      fetchUsers()
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not create that account')
    }
  }

  const deleteUser = async () => {
    const { username } = modalState
    setModalState({ type: null })
    try {
      await adminDeleteUser(username)
      fetchUsers()
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not delete that account')
    }
  }

  const toggleAdmin = async (user) => {
    if (user.username === storage.getUsername()) return
    try {
      await adminSetAdminStatus(user.username, !user.is_admin)
      setUsers((prev) => prev.map((u) => (u.username === user.username ? { ...u, is_admin: !u.is_admin } : u)))
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not change that role')
    }
  }

  // Staff is the moderation role: suspend and approve, but no delete, no re-keying, no
  // granting. Offered only where admin is not already the answer.
  const toggleStaff = async (user) => {
    setBusy(user.username)
    setError('')
    try {
      await adminSetRole(user.username, user.role === 'staff' ? 'user' : 'staff')
      await fetchUsers()
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not change that role')
    } finally {
      setBusy('')
    }
  }

  // Suspending is reversible: the mailbox and its mail stay, sign-in stops.
  // The server refuses to suspend the caller, so the button is disabled for
  // the signed-in admin instead of round-tripping into a 409.
  const [suspendTarget, setSuspendTarget] = useState(null)
  const [suspendReason, setSuspendReason] = useState('')
  const [suspendHours, setSuspendHours] = useState(0)

  const toggleSuspended = async (user, suspended) => {
    // Switching an account ON is immediate. Switching it OFF asks first — why, and for how
    // long — because that is the decision the person on the other side will ask about.
    if (suspended) {
      setSuspendReason('')
      setSuspendHours(0)
      setSuspendTarget(user)
      return
    }
    setBusy(user.username)
    setError('')
    try {
      await adminSetSuspended(user.username, false, 'switched back on from the admin panel')
      await fetchUsers()
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not change that account')
    } finally {
      setBusy('')
    }
  }

  const confirmSuspend = async () => {
    const user = suspendTarget
    if (!user) return
    setSuspendTarget(null)
    setBusy(user.username)
    setError('')
    try {
      await adminSetSuspended(user.username, true, suspendReason.trim(), suspendHours || null)
      await fetchUsers()
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not change that account')
    } finally {
      setBusy('')
    }
  }

  const signInMessage = (username, token) =>
    `Your Sloth Lee Mail account (${username}) is ready.  Sign in at ${window.location.origin}/login ` +
    `Username: ${username} One-time password: ${token}  You will be asked to choose your own password ` +
    'and create your key the first time you sign in. The one-time password stops working as soon as you do.'

  const copySignIn = async () => {
    try {
      await navigator.clipboard.writeText(signInMessage(created.username, created.token))
      setCreated((c) => c && { ...c, copied: true, error: '' })
      setTimeout(() => setCreated((c) => c && { ...c, copied: false }), 2000)
    } catch {
      setCreated((c) => c && { ...c, error: 'Clipboard unavailable — select the password and copy it by hand' })
    }
  }

  // ── recovery (kept from the old page: the only way to help a locked-out user) ──
  const openRecovery = (user) => setRecovery({
    username: user.username, email: user.recovery_email || '', saving: false, sending: false, result: null, error: '', copied: false,
  })

  const saveRecoveryAddress = async () => {
    setRecovery((r) => ({ ...r, saving: true, error: '' }))
    try {
      const data = await adminSetRecoveryAddress(recovery.username, recovery.email.trim())
      setRecovery((r) => ({ ...r, saving: false, email: data.recovery_email || '' }))
      fetchUsers()
    } catch (err) {
      setRecovery((r) => ({ ...r, saving: false, error: err?.response?.data?.error || 'Could not save that address' }))
    }
  }

  const sendRecoveryEmail = async () => {
    setRecovery((r) => ({ ...r, sending: true, error: '', result: null }))
    try {
      const data = await adminSendRecovery(recovery.username)
      setRecovery((r) => ({ ...r, sending: false, result: data }))
    } catch (err) {
      setRecovery((r) => ({ ...r, sending: false, error: err?.response?.data?.error || 'Could not send the recovery email' }))
    }
  }

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => `${u.username} ${u.email ?? ''}`.toLowerCase().includes(q))
  }, [users, query])

  const diskTotals = useMemo(() => {
    const rows = disk ?? []
    return {
      messages: rows.reduce((n, r) => n + (r.email_count ?? 0), 0),
      bytesUsed: rows.reduce((n, r) => n + (r.disk_usage_bytes ?? 0), 0),
      biggest: [...rows].sort((a, b) => (b.disk_usage_bytes ?? 0) - (a.disk_usage_bytes ?? 0)).slice(0, 5),
    }
  }, [disk])

  const aliasCount = recipients ? Math.max(0, recipients.length - users.length) : 0

  const cell = 'px-4 py-3 text-[12.5px]'

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-[1080px] items-center gap-3 px-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] text-ink-2 transition-colors duration-120 hover:bg-accent hover:text-ink-1"
          >
            <ArrowLeft className="size-3.5" /> Mail
          </button>
          <span className="display text-[16px] text-ink-1">Admin</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => refresh()}
              className="rounded-md p-2 text-ink-3 transition-colors duration-120 hover:bg-accent hover:text-ink-1"
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw className="size-4" />
            </button>
            <Button size="sm" className="gap-1.5" onClick={() => setModalState({ type: 'create' })}>
              <Plus className="size-3.5" /> New mailbox
            </Button>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[1080px]">
          {/* Four short labels do not fit a phone in one row: "System" sat past the
              edge, so the fourth surface was effectively missing. A grid shows all
              four; the desktop row keeps its tighter 38px rhythm. */}
          <div className="grid grid-cols-2 gap-1 px-4 pb-2 sm:flex sm:overflow-x-auto sm:[scrollbar-width:none]">
          {TABS.map(({ id, label, icon: Icon }) => {
            const count = id === 'people' ? users.length : id === 'access' ? pending.length : 0
            const active = tab === id
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors duration-120 sm:min-h-[38px] ${
                  active ? 'bg-secondary font-medium text-ink-1' : 'text-ink-3 hover:bg-accent hover:text-ink-1'
                }`}
              >
                <Icon className="size-3.5" />
                {label}
                {count > 0 && <span className="mono text-[11px] text-ink-3">{count}</span>}
              </button>
            )
          })}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1080px] space-y-8 px-4 py-6">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-[12.5px] text-destructive">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} aria-label="Dismiss" className="text-destructive/70 hover:text-destructive">
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* ── People ─────────────────────────────────────────────────────── */}
        {tab === 'people' && (
          <Panel
            title="Mailboxes"
            note="Every account on this server. Deleting one removes its mail, its key and its addresses; that cannot be undone."
          >
            <div className="flex min-h-[44px] items-center gap-2 border-b border-line px-4 py-2 sm:min-h-0">
              <Search className="size-3.5 text-ink-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or address"
                className="w-full bg-transparent text-[12.5px] text-ink-1 placeholder:text-ink-3 focus:outline-none max-sm:min-h-[44px]"
              />
              <span className="mono shrink-0 text-[11px] text-ink-3">
                {filteredUsers.length} of {users.length}
              </span>
            </div>

            {usersLoading ? (
              <Empty>Loading accounts…</Empty>
            ) : filteredUsers.length === 0 ? (
              <Empty>
                {users.length > 0
                  ? 'No account matches that search.'
                  : error
                    ? `The account list could not be read${error ? `: ${error}` : ''}.`
                    : 'No accounts yet.'}
              </Empty>
            ) : (
              <>
                {/* The table is ~450px wide inside its own container, so at 390 it
                    scrolled sideways and its action column sat past the edge — the
                    page reported no overflow and the controls read as missing. Below
                    sm one card per account, every action full width and in reach. */}
                <ul className="divide-y divide-line sm:hidden">
                  {filteredUsers.map((user) => {
                    const self = user.username === storage.getUsername()
                    return (
                      <li key={user.uid ?? user.username} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[13.5px] font-medium text-ink-1">{user.username}</p>
                            <p className="mono mt-0.5 truncate text-[11px] text-ink-3">
                              {user.email ?? `${user.username}@slothlee.xyz`}
                            </p>
                          </div>
                          {!user.is_admin && (
                            <button
                              onClick={() => toggleStaff(user)}
                              disabled={busy === user.username}
                              aria-label={user.role === 'staff' ? 'Revoke staff' : 'Grant staff'}
                              className={`inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full border px-3 text-[11px] ${
                                user.role === 'staff'
                                  ? 'border-primary/35 bg-primary/10 text-primary'
                                  : 'border-line text-ink-3'
                              }`}
                            >
                              {user.role === 'staff' ? <ShieldCheck className="size-3" /> : <Shield className="size-3" />}
                              {user.role === 'staff' ? 'staff' : 'no staff'}
                            </button>
                          )}
                          <button
                            onClick={() => toggleAdmin(user)}
                            disabled={self}
                            aria-label={user.is_admin ? 'Revoke admin' : 'Grant admin'}
                            className={`inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full border px-3 text-[11px] ${
                              user.is_admin
                                ? 'border-primary/35 bg-primary/10 text-primary'
                                : 'border-line text-ink-3'
                            } ${self ? 'opacity-60' : ''}`}
                          >
                            {user.is_admin ? <ShieldCheck className="size-3" /> : <Shield className="size-3" />}
                            {user.is_admin ? 'admin' : 'user'}
                          </button>
                        </div>
                        <p className="mt-1.5 text-[11.5px] text-ink-3">
                          {user.recovery_email ?? 'No recovery address'}
                        </p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            onClick={() => openRecovery(user)}
                            className="min-h-[44px] gap-1.5 text-[12.5px] text-ink-2"
                          >
                            <KeyRound className="size-4" /> Recovery
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setModalState({ type: 'delete', username: user.username })}
                            disabled={self}
                            className="min-h-[44px] gap-1.5 text-[12.5px] text-destructive"
                          >
                            <Trash2 className="size-4" /> Delete
                          </Button>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => toggleSuspended(user, !user.suspended)}
                          disabled={self || busy === user.username}
                          className={`mt-2 w-full min-h-[44px] gap-1.5 text-[12.5px] ${
                            user.suspended ? 'border-primary/40 text-primary' : 'text-ink-2'
                          }`}
                        >
                          <Power className="size-4" />
                          {self ? 'This is your account' : user.suspended ? 'Switch it back on' : 'Switch this account off'}
                        </Button>
                      </li>
                    )
                  })}
                </ul>

              <table className="hidden w-full sm:table">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className={`${cell} label`}>Mailbox</th>
                    <th className={`${cell} label hidden sm:table-cell`}>Recovery</th>
                    <th className={`${cell} label`}>Role</th>
                    <th className={`${cell} label text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => {
                    const self = user.username === storage.getUsername()
                    return (
                      <Fragment key={user.uid ?? user.username}>
                        <tr className="border-b-0">
                          <td className={cell}>
                            <p className="truncate font-medium text-ink-1" title={user.username}>{user.username}</p>
                            <p className="mono truncate text-[11px] text-ink-3">{user.email ?? `${user.username}@slothlee.xyz`}</p>
                          </td>
                          <td className={`${cell} hidden sm:table-cell`}>
                            {user.recovery_email ? (
                              <span className="text-ink-2">{user.recovery_email}</span>
                            ) : (
                              // "not set" reads as a dead end; the useful thing to
                              // offer is the way to set it.
                              <button
                                onClick={() => openRecovery(user)}
                                className="text-[12px] text-ink-3 underline decoration-line-strong underline-offset-2 transition-colors duration-120 hover:text-primary"
                              >
                                Set recovery
                              </button>
                            )}
                          </td>
                          <td className={cell}>
                            <button
                              onClick={() => toggleAdmin(user)}
                              disabled={self}
                              title={self ? 'You cannot change your own role' : user.is_admin ? 'Revoke admin' : 'Grant admin'}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors duration-120 max-sm:min-h-[30px] max-sm:px-2.5 ${
                                user.is_admin
                                  ? 'border-primary/35 bg-primary/10 text-primary'
                                  : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2'
                              } ${self ? 'opacity-60' : ''}`}
                            >
                              {user.is_admin ? <ShieldCheck className="size-3" /> : <Shield className="size-3" />}
                              {user.is_admin ? 'admin' : 'user'}
                            </button>
                          </td>
                          <td className={`${cell} text-right`}>
                            <button
                              onClick={() => openRecovery(user)}
                              title={`Password recovery for ${user.username}`}
                              aria-label={`Password recovery for ${user.username}`}
                              className="rounded p-1.5 text-ink-3 transition-colors duration-120 hover:bg-accent hover:text-primary max-sm:p-2.5"
                            >
                              <KeyRound className="size-4" />
                            </button>
                            <button
                              onClick={() => setModalState({ type: 'delete', username: user.username })}
                              title={`Delete ${user.username}`}
                              aria-label={`Delete ${user.username}`}
                              className="rounded p-1.5 text-ink-3 transition-colors duration-120 hover:bg-destructive/10 hover:text-destructive max-sm:p-2.5"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </td>
                        </tr>
                        {/* Switching an account off keeps its mail; only the
                            way in stops. Right-aligned under the row so it reads as
                            an action on that account, not a band across the table. */}
                        <tr className="border-b border-line/70 last:border-0">
                          <td colSpan={4} className="px-4 pb-3 pt-0">
                            <div className="flex justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => toggleSuspended(user, !user.suspended)}
                              disabled={self || busy === user.username}
                              title={
                                self
                                  ? 'You cannot switch your own account off'
                                  : user.suspended
                                    ? 'Let this account sign in again'
                                    : 'Keep the mail, stop sign-in'
                              }
                              className={`gap-1.5 text-[12.5px] ${
                                user.suspended ? 'border-primary/40 text-primary hover:bg-primary/10' : 'text-ink-2'
                              }`}
                            >
                              <Power className="size-4" />
                              {self ? 'This is your account' : user.suspended ? 'Switch it back on' : 'Switch this account off'}
                            </Button>
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
              </>
            )}
          </Panel>
        )}

        {/* ── Access ─────────────────────────────────────────────────────── */}
        {tab === 'access' && (
          <>
            <Panel
              title="Waiting for a decision"
              note="Accounts created at /signup without an invite code. They cannot sign in until approved; denying deletes the account, so no name can sit on a mailbox nobody can read."
            >
              {pendingLoading ? (
                <Empty>Loading…</Empty>
              ) : pending.length === 0 ? (
                <Empty art={error ? undefined : 'queue'}>
                  {error
                    ? `The queue could not be read: ${error}.`
                    : 'Nobody is waiting. Requests appear here the moment someone signs up.'}
                </Empty>
              ) : (
                <ul>
                  {pending.map((entry) => (
                    <li key={entry.username} className="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3 last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="mono text-[12.5px] text-ink-1">{entry.username}</p>
                        <p className="text-[11px] text-ink-3">
                          asked {when(entry.requested_at)}
                          {entry.ip ? ` · from ${entry.ip}` : ' · address unknown'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => decidePending(entry.username, 'approve')} disabled={busy === entry.username}>
                          {busy === entry.username ? 'Working…' : 'Approve'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => decidePending(entry.username, 'deny')}
                          disabled={busy === entry.username}
                          title="Deny and delete this request"
                        >
                          Deny
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Invite requests"
              note="People who asked for access at /signup. Approving mints a single-use code; send it however they actually read messages."
            >
              {invitesLoading ? (
                <Empty>Loading…</Empty>
              ) : invites.length === 0 && error ? (
                <Empty>{`The request list could not be read${error ? `: ${error}` : ''}.`}</Empty>
              ) : invites.length === 0 ? (
                <Empty>
                  No requests yet. The link to share is{' '}
                  <a href="/signup" className="text-primary underline underline-offset-2">mail.slothlee.xyz/signup</a>.
                </Empty>
              ) : (
                <ul>
                  {invites.map((entry) => (
                    <li key={entry.email} className="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3 last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] text-ink-1">{entry.email}</p>
                        <p className="text-[11px] text-ink-3">
                          {when(entry.requested_at)} · {inviteStatus(entry.status)}
                        </p>
                      </div>
                      {entry.status === 'pending' ? (
                        <Button size="sm" onClick={() => approveInvite(entry.email)} disabled={busy === entry.email}>
                          {busy === entry.email ? 'Approving…' : 'Approve'}
                        </Button>
                      ) : entry.code ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="mono rounded bg-secondary px-2 py-1 text-[11px] text-ink-2">
                            {entry.code.slice(0, 8)}…
                          </code>
                          <Button size="sm" variant="outline" onClick={() => copyInvite(entry)}>
                            {copied === entry.email ? 'Copied' : 'Copy'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => shareInvite(entry)}>
                            Send
                          </Button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-ink-3">code already used</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        )}

        {/* ── Deliverability ─────────────────────────────────────────────── */}
        {tab === 'deliverability' && (
          <Panel
            title="Mail health"
            note="What the filter is doing and what is stuck. Every figure carries the moment it was measured; a card without a timestamp is a rumour."
          >
            {!health ? (
              <Empty>Mail health could not be read just now.</Empty>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 border-b border-line px-4 py-3 sm:grid-cols-4">
                  {health.rspamd ? (
                    <>
                      <div>
                        <p className="label">Scanned</p>
                        <p className="mono mt-1 text-[15px] text-ink-1">{health.rspamd.scanned}</p>
                      </div>
                      <div>
                        <p className="label">Rejected</p>
                        <p className="mono mt-1 text-[15px] text-ink-1">{health.rspamd.rejected}</p>
                      </div>
                      <div>
                        <p className="label">Tagged</p>
                        <p className="mono mt-1 text-[15px] text-ink-1">{health.rspamd.tagged}</p>
                      </div>
                      <div>
                        <p className="label">Bayes learned</p>
                        <p className="mono mt-1 text-[15px] text-ink-1">{health.rspamd.learned}</p>
                      </div>
                    </>
                  ) : (
                    <div className="col-span-2 sm:col-span-4">
                      {/* Unavailable, never zeros: zeros read as "nothing is wrong". */}
                      <p className="text-[13px] text-destructive" role="alert">
                        The filter is unavailable — {health.rspamd_error || 'no answer'}.
                      </p>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 border-b border-line px-4 py-3 sm:grid-cols-4">
                  <div>
                    <p className="label">Queue</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">
                      {health.queue_available ? health.queue.depth : 'unknown'}
                    </p>
                  </div>
                  <div>
                    <p className="label">Deferred</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">
                      {health.queue_available ? health.queue.deferred : 'unknown'}
                    </p>
                  </div>
                  <div>
                    <p className="label">In junk</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">{health.junk?.messages ?? 0}</p>
                  </div>
                  <div>
                    <p className="label">Accounts with junk</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">{health.junk?.accounts ?? 0}</p>
                  </div>
                </div>
                <p className="px-4 py-2 text-[11.5px] text-ink-3">
                  as of {new Date((health.as_of ?? 0) * 1000).toLocaleString()}
                  {health.queue_available
                    ? ` · queue as of ${new Date((health.queue.at ?? 0) * 1000).toLocaleTimeString()}`
                    : ' · the host has not written a queue snapshot recently'}
                  {health.rspamd ? ` · rspamd ${health.rspamd.version}` : ''}
                </p>
              </>
            )}
          </Panel>
        )}

        {tab === 'activity' && (
          <Panel
            title="Activity"
            note="Every administrative action, newest first. Records are hash-chained: each one carries the hash of the record before it, so a deleted or edited row breaks the chain and is named here."
          >
            {auditLoading && audit === null ? (
              <Empty>Loading…</Empty>
            ) : audit?.unavailable ? (
              <Empty>This server does not keep an audit log.</Empty>
            ) : (
              <>
                {/* One integrity line, not a badge per row: per-row badges would imply a
                    per-row check that does not happen. */}
                {audit?.chain && (
                  <div className="border-b border-line px-4 py-2 text-[12px]">
                    {audit.chain.ok ? (
                      <span className="text-ink-3">
                        ✓ Chain intact — {audit.chain.count} record{audit.chain.count === 1 ? '' : 's'}
                      </span>
                    ) : (
                      <span className="text-destructive" role="alert">
                        ⚠ The log may have been edited: record {audit.chain.count} {audit.chain.why}
                      </span>
                    )}
                  </div>
                )}
                {audit?.records?.length ? (
                  <>
                    {/* Phones get cards, like the People tab. */}
                    <ul className="divide-y divide-line sm:hidden">
                      {audit.records.map((r, i) => (
                        <li key={`${r.at}-${i}`} className="px-4 py-3">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="min-w-0 flex-1 text-[13.5px] text-ink-1">
                              <span className="text-ink-3">{r.actor}</span> {r.action}
                              {r.target ? <span className="text-ink-2"> · {r.target}</span> : null}
                            </p>
                            <span className="mono shrink-0 text-[11.5px] text-ink-3">
                              {new Date(r.at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          {r.detail ? <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{r.detail}</p> : null}
                        </li>
                      ))}
                    </ul>
                    <table className="hidden w-full text-left text-[13px] sm:table">
                      <thead>
                        <tr className="border-b border-line">
                          <th className="label px-4 py-2">When</th>
                          <th className="label px-4 py-2">Who</th>
                          <th className="label px-4 py-2">Action</th>
                          <th className="label px-4 py-2">Target</th>
                          <th className="label px-4 py-2">Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audit.records.map((r, i) => (
                          <tr key={`${r.at}-${i}`} className="border-b border-line/60">
                            <td className="mono whitespace-nowrap px-4 py-2 text-ink-3">
                              {new Date(r.at * 1000).toLocaleString()}
                            </td>
                            <td className="px-4 py-2 text-ink-2">{r.actor}</td>
                            <td className="px-4 py-2 text-ink-1">{r.action}</td>
                            <td className="px-4 py-2 text-ink-2">{r.target || '—'}</td>
                            <td className="px-4 py-2 text-ink-3">{r.detail || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <Empty>No administrative actions recorded yet.</Empty>
                )}
              </>
            )}
          </Panel>
        )}
        {tab === 'deliverability' && (
          <Panel
            title="Addresses this server accepts"
            note="Postfix is rebuilt from this list every few seconds. If an address is missing here, mail to it is rejected at RCPT with 'user unknown' — this is the first thing to check when mail does not arrive."
            action={
              <a
                href="/signup"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-ink-2 transition-colors duration-120 hover:bg-accent hover:text-ink-1"
              >
                Public signup <ExternalLink className="size-3" />
              </a>
            }
          >
            {recipients === null ? (
              <Empty>{error ? `The recipient map could not be read: ${error}` : 'Loading…'}</Empty>
            ) : recipients.length === 0 ? (
              <Empty>No addresses are being accepted. That is a fault, not an empty state.</Empty>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 border-b border-line px-4 py-3">
                  <div>
                    <p className="label">Accepted</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">{recipients.length}</p>
                  </div>
                  <div>
                    <p className="label">Mailboxes</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">{users.length}</p>
                  </div>
                  <div>
                    <p className="label">Aliases</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">{aliasCount}</p>
                  </div>
                </div>
                <ul className="flex flex-wrap gap-1.5 p-4">
                  {recipients.map((name) => (
                    <li key={name} className="mono rounded-md bg-secondary px-2 py-1 text-[11.5px] text-ink-2">
                      {name}@slothlee.xyz
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        )}

        {/* ── System ─────────────────────────────────────────────────────── */}
        {tab === 'system' && (
          <Panel title="Storage" note="Where the disk goes, per mailbox. Messages are counted from the mail index; sizes are what those messages occupy on disk.">
            {disk === null ? (
              <Empty>{error ? `Storage figures could not be read: ${error}` : 'Loading…'}</Empty>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 border-b border-line px-4 py-3 sm:grid-cols-3">
                  <div>
                    <p className="label">Messages</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">{diskTotals.messages}</p>
                  </div>
                  <div>
                    <p className="label">On disk</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">{bytes(diskTotals.bytesUsed)}</p>
                  </div>
                  <div>
                    <p className="label">Mailboxes</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">{disk.length}</p>
                  </div>
                </div>
                {diskTotals.biggest.length === 0 ? (
                  <Empty>No mail stored yet.</Empty>
                ) : (
                  <>
                  <div className="flex items-baseline justify-between border-b border-line px-4 py-2">
                    <p className="label">Largest mailboxes</p>
                    <p className="mono text-[10.5px] text-ink-3">
                      {diskTotals.biggest.length} of {disk.length} · bar is share of total
                    </p>
                  </div>
                  <ul>
                    {diskTotals.biggest.map((row) => {
                      const share = diskTotals.bytesUsed ? (row.disk_usage_bytes ?? 0) / diskTotals.bytesUsed : 0
                      const width = Math.max(1.5, Math.round(share * 1000) / 10)
                      return (
                        <li key={row.username} className="border-b border-line/70 px-4 py-2.5 last:border-0">
                          <div className="flex items-baseline gap-3">
                            <span className="flex-1 truncate text-[12.5px] text-ink-1">{row.username}</span>
                            <span className="mono text-[11.5px] text-ink-3">{row.email_count} messages</span>
                            <span className="mono w-16 text-right text-[11.5px] text-ink-2">{bytes(row.disk_usage_bytes)}</span>
                          </div>
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line/70">
                            <div className="h-full rounded-full bg-primary/70" style={{ width: `${width}%` }} />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                  </>
                )}
              </>
            )}
          </Panel>
        )}
      </main>

      <InputModal
        isOpen={modalState.type === 'create'}
        onClose={() => setModalState({ type: null })}
        title="New mailbox"
        label="Username"
        placeholder="yourname"
        confirmText="Create"
        onConfirm={createUser}
      />

      <Modal isOpen={Boolean(suspendTarget)} onClose={() => setSuspendTarget(null)}>
        <ModalHeader title={`Switch off ${suspendTarget?.username ?? ''}`} onClose={() => setSuspendTarget(null)} />
        <ModalContent>
          <label className="label" htmlFor="suspend-reason">Reason (shown to the account holder)</label>
          <textarea
            id="suspend-reason"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            rows={3}
            placeholder="abuse report, payment, requested by the owner…"
            className="mt-1 w-full resize-y rounded-md border border-border bg-input px-3 py-2 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring/50"
          />
          <label className="label mt-3 block" htmlFor="suspend-for">For how long</label>
          <select
            id="suspend-for"
            value={suspendHours}
            onChange={(e) => setSuspendHours(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-[13px] text-foreground"
          >
            <option value={0}>Until someone switches it back on</option>
            <option value={1}>1 hour</option>
            <option value={24}>24 hours</option>
            <option value={168}>7 days</option>
            <option value={720}>30 days</option>
          </select>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            The mailbox, its key and every message stay where they are; the account is refused
            at sign-in and at SMTP. A timed suspension lifts by itself.
          </p>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setSuspendTarget(null)}>Cancel</Button>
          <Button onClick={confirmSuspend}>Switch off</Button>
        </ModalFooter>
      </Modal>

      <ConfirmModal
        isOpen={modalState.type === 'delete'}
        onClose={() => setModalState({ type: null })}
        title="Delete mailbox"
        description={`Delete "${modalState.username}"? Their mail, their key and every address are removed. This cannot be undone.`}
        confirmText="Delete"
        onConfirm={deleteUser}
      />

      {/* A one-time password that is never shown again: this panel is the
          only chance to hand it over, so it stays until dismissed. */}
      {created && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-line bg-card p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="display text-[16px] text-ink-1">Account created</h3>
                <p className="mono mt-0.5 text-[11.5px] text-ink-3">{created.username}@slothlee.xyz</p>
              </div>
              <button onClick={() => setCreated(null)} aria-label="Close" className="rounded p-1 text-ink-3 hover:text-ink-1">
                <X className="size-4" />
              </button>
            </div>

            <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
              Hand this over: it is a one-time password, not a reset link. It is the only way in
              until they choose their own password.
            </p>

            <code className="mono mt-3 block break-all rounded-lg border border-line bg-background/40 p-3 text-[12px] text-ink-1">
              {created.token || 'The server did not return a one-time password'}
            </code>

            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
              It stops working the moment they set their own password, and the account is unusable
              without it — there is no way to show it again.
            </p>

            <Button variant="outline" className="mt-3 w-full gap-2" disabled={!created.token} onClick={copySignIn}>
              <Copy className="size-3.5" /> {created.copied ? 'Copied' : 'Copy sign-in message'}
            </Button>

            {created.error && <p className="mt-2 text-[12px] text-destructive">{created.error}</p>}
          </div>
        </div>
      )}

      {recovery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-line bg-card p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="display text-[16px] text-ink-1">Password recovery</h3>
                <p className="mono mt-0.5 text-[11.5px] text-ink-3">{recovery.username}@slothlee.xyz</p>
              </div>
              <button onClick={() => setRecovery(null)} aria-label="Close" className="rounded p-1 text-ink-3 hover:text-ink-1">
                <X className="size-4" />
              </button>
            </div>

            <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
              The link goes to a recovery address, not to the mailbox — someone who cannot sign in
              cannot read their own inbox.
            </p>

            <label htmlFor="rec-addr" className="mt-3 block text-[12px] font-medium text-ink-2">
              Recovery address
            </label>
            <div className="mt-1 flex gap-2">
              <Input
                id="rec-addr"
                type="email"
                value={recovery.email}
                onChange={(e) => setRecovery((r) => ({ ...r, email: e.target.value }))}
                placeholder="them@elsewhere.com"
              />
              <Button variant="outline" onClick={saveRecoveryAddress} disabled={recovery.saving}>
                {recovery.saving ? 'Saving…' : 'Save'}
              </Button>
            </div>

            <div className="mt-4 rounded-lg border border-line bg-background/40 p-3">
              <Button onClick={sendRecoveryEmail} disabled={recovery.sending || !recovery.email.trim()} className="w-full">
                {recovery.sending ? 'Sending…' : 'Send recovery email'}
              </Button>

              {recovery.result && (
                <div className="mt-3 space-y-2 text-[12px]">
                  <p className={recovery.result.emailed ? 'text-primary' : 'text-sand'}>
                    {recovery.result.emailed
                      ? `Sent to ${recovery.result.sent_to}`
                      : `Not mailed: ${recovery.result.mail_error || 'unknown error'}`}
                  </p>
                  <p className="text-ink-3">
                    Or hand this link over yourself — it works once and expires in{' '}
                    {recovery.result.expires_in_minutes} minutes:
                  </p>
                  <code className="mono block break-all rounded bg-field p-2 text-[11px] text-ink-2">
                    {`${window.location.origin}/reset?t=${recovery.result.token}`}
                  </code>
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={async () => {
                      const link = `${window.location.origin}/reset?t=${recovery.result.token}`
                      const message = `Reset your Sloth Lee Mail password (${recovery.username}) within ${recovery.result.expires_in_minutes} minutes:\n\n${link}\n\nSetting a new password creates a new key, so mail encrypted to the old key cannot be read afterwards.`
                      try {
                        await navigator.clipboard.writeText(message)
                        setRecovery((r) => ({ ...r, copied: true }))
                        setTimeout(() => setRecovery((r) => (r ? { ...r, copied: false } : r)), 2000)
                      } catch {
                        setRecovery((r) => ({ ...r, error: 'Clipboard unavailable — select the link and copy it by hand' }))
                      }
                    }}
                  >
                    <Copy className="size-3.5" /> {recovery.copied ? 'Copied' : 'Copy message'}
                  </Button>
                </div>
              )}

              {recovery.error && <p className="mt-2 text-[12px] text-destructive">{recovery.error}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Admin
