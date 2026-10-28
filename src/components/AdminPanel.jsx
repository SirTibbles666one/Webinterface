import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, ArrowLeft, RefreshCw, ShieldCheck, Shield, KeyRound, Copy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmModal, InputModal } from '@/components/ui/Modal'
import { adminGetUsers, adminCreateUser, adminDeleteUser, adminSetAdminStatus, adminGetWaitlist, adminApproveWaitlist, adminGetPending, adminApprovePending, adminDenyPending, adminSetRecoveryAddress, adminSendRecovery } from '@/api'
import { storage } from '@/storage'

// Plain words: "used" alone reads like the invite was wasted, when it means
// someone actually created an account with it.
const inviteStatus = (status) => {
  if (status === 'pending') return 'waiting'
  if (status === 'approved') return 'code issued, not used yet'
  if (status === 'used') return 'account created with this code'
  return status
}

const AdminPanel = () => {
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalState, setModalState] = useState({ type: null })
  const [invites, setInvites] = useState([])
  const [invitesLoading, setInvitesLoading] = useState(true)
  const [approving, setApproving] = useState('')
  const [copied, setCopied] = useState('')

  // ── Self-registration approval queue ─────────────────────────────────────
  // Signups without an invite code are created but cannot sign in until they
  // are approved here. Denying deletes the account, so a name cannot sit on a
  // mailbox receiving mail nobody can read.
  const [pending, setPending] = useState([])
  const [pendingLoading, setPendingLoading] = useState(true)
  const [pendingBusy, setPendingBusy] = useState('')

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

  const handlePending = async (username, action) => {
    setPendingBusy(username)
    setError('')
    try {
      if (action === 'approve') await adminApprovePending(username)
      else await adminDenyPending(username)
      await Promise.all([fetchPending(), fetchUsers()])
    } catch (err) {
      setError(err.response?.data?.error || `Could not ${action} that account`)
    } finally {
      setPendingBusy('')
    }
  }

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminGetUsers()
      setUsers(data.users ?? [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Password recovery ────────────────────────────────────────────────────
  const [recovery, setRecovery] = useState(null)

  const openRecovery = (user) => {
    setRecovery({
      username: user.username,
      email: user.recovery_email || '',
      saving: false,
      sending: false,
      result: null,
      error: '',
      copied: false,
    })
  }

  const saveRecoveryAddress = async () => {
    if (!recovery) return
    setRecovery((r) => ({ ...r, saving: true, error: '' }))
    try {
      const data = await adminSetRecoveryAddress(recovery.username, recovery.email.trim())
      setRecovery((r) => ({ ...r, saving: false, email: data.recovery_email || '' }))
      await fetchUsers()
    } catch (err) {
      setRecovery((r) => ({
        ...r,
        saving: false,
        error: err?.response?.data?.error || 'Could not save that address',
      }))
    }
  }

  const sendRecoveryEmail = async () => {
    if (!recovery) return
    setRecovery((r) => ({ ...r, sending: true, error: '', result: null }))
    try {
      const data = await adminSendRecovery(recovery.username)
      setRecovery((r) => ({ ...r, sending: false, result: data }))
    } catch (err) {
      setRecovery((r) => ({
        ...r,
        sending: false,
        error: err?.response?.data?.error || 'Could not send the recovery email',
      }))
    }
  }

  const copyRecoveryMessage = async () => {
    if (!recovery?.result) return
    const link = `${window.location.origin}/reset?t=${recovery.result.token}`
    const message = `Reset your Sloth Lee Mail password (${recovery.username}) within ${recovery.result.expires_in_minutes} minutes:\n\n${link}\n\nSetting a new password creates a new key, so mail encrypted to the old key cannot be read afterwards.`
    try {
      await navigator.clipboard.writeText(message)
      setRecovery((r) => ({ ...r, copied: true }))
      setTimeout(() => setRecovery((r) => (r ? { ...r, copied: false } : r)), 2000)
    } catch {
      setRecovery((r) => ({ ...r, error: 'Clipboard unavailable — select the link and copy it by hand' }))
    }
  }

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

  const handleApprove = async (email) => {
    setApproving(email)
    setError('')
    try {
      await adminApproveWaitlist(email)
      await fetchInvites()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not approve that request')
    } finally {
      setApproving('')
    }
  }

  const copyInvite = async (entry) => {
    const message = `Your Sloth Lee Mail invite code is: ${entry.code}

Go to https://mail.slothlee.xyz/signup and paste it to create your account. It works once.`
    try {
      await navigator.clipboard.writeText(message)
      setCopied(entry.email)
      setTimeout(() => setCopied(''), 2500)
    } catch {
      setError('Could not copy — long-press the code instead')
    }
  }


  // Send the code yourself rather than relying on the server's email: the share
  // sheet reaches whatever channel the person actually reads (SMS, WhatsApp,
  // their own mail app), which is the reliable path for a hand-approved invite.
  const shareInvite = async (entry) => {
    const text = `Your Sloth Lee Mail invite code is: ${entry.code}

Go to https://mail.slothlee.xyz/signup and paste it to create your account. It works once.`
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

  useEffect(() => {
    if (!storage.getIsAdmin()) {
      navigate('/')
      return
    }
    fetchUsers()
    fetchInvites()
    fetchPending()
  }, [fetchUsers, fetchInvites, fetchPending, navigate])

  const handleCreate = async (username) => {
    setModalState({ type: null })
    try {
      await adminCreateUser(username.trim())
      fetchUsers()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user')
    }
  }

  const handleDelete = async () => {
    const { username } = modalState
    setModalState({ type: null })
    try {
      await adminDeleteUser(username)
      fetchUsers()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete user')
    }
  }

  const handleToggleAdmin = async (user) => {
    const myUsername = storage.getUsername()
    if (user.username === myUsername) return // never change own role
    try {
      await adminSetAdminStatus(user.username, !user.is_admin)
      setUsers((prev) =>
        prev.map((u) => u.username === user.username ? { ...u, is_admin: !u.is_admin } : u)
      )
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update admin status')
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-md text-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
              title="Back to inbox"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
                <h1 className="text-xl font-semibold">Admin management</h1>
                <p className="text-sm text-foreground/60">
                    Due to nature of the application, there isnt anything much you can do here except creating new users or deleting existing ones.
                </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchUsers}
              className="p-2 rounded-md text-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <Button
              onClick={() => setModalState({ type: 'create' })}
              className="flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New User
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-4 py-2.5 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
            {error}
          </div>
        )}

        <div className="border border-border rounded-lg overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-border bg-secondary/20 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">
                Pending accounts
                {pending.length > 0 && (
                  <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary align-middle">
                    {pending.length}
                  </span>
                )}
              </h2>
              <p className="text-xs text-foreground/50">
                Signed up at <span className="font-mono">/signup</span> without an invite code. They
                cannot sign in until approved; denying deletes the account.
              </p>
            </div>
            <button
              onClick={fetchPending}
              className="p-2 rounded-md text-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
              title="Refresh pending accounts"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {pendingLoading ? (
            <div className="py-8 text-center text-sm text-foreground/50">Loading…</div>
          ) : pending.length === 0 ? (
            <div className="py-8 text-center text-sm text-foreground/50">
              Nobody is waiting for approval.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {pending.map((entry) => (
                <li key={entry.username} className="px-4 py-3 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate font-mono">{entry.username}</p>
                    <p className="text-[11px] text-foreground/45">
                      {new Date(entry.requested_at * 1000).toLocaleString()}
                      {entry.ip ? ` · from ${entry.ip}` : ' · address unknown'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => handlePending(entry.username, 'approve')}
                      disabled={pendingBusy === entry.username}
                    >
                      {pendingBusy === entry.username ? 'Working…' : 'Approve'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePending(entry.username, 'deny')}
                      disabled={pendingBusy === entry.username}
                      title="Delete this account request"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border border-border rounded-lg overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-border bg-secondary/20 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">Invites</h2>
              <p className="text-xs text-foreground/50">
                People request access at <span className="font-mono">/signup</span>. Approving
                gives you a single-use code to send them.
              </p>
            </div>
            <button
              onClick={fetchInvites}
              className="p-2 rounded-md text-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
              title="Refresh invites"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {invitesLoading ? (
            <div className="py-8 text-center text-sm text-foreground/50">Loading…</div>
          ) : invites.length === 0 ? (
            <div className="py-8 text-center text-sm text-foreground/50">
              No requests yet. The link to share is https://mail.slothlee.xyz/signup
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {invites.map((entry) => (
                <li key={entry.email} className="px-4 py-3 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{entry.email}</p>
                    <p className="text-[11px] text-foreground/45">
                      {new Date(entry.requested_at * 1000).toLocaleString()} · {inviteStatus(entry.status)}
                    </p>
                  </div>
                  {entry.status === 'pending' ? (
                    <Button size="sm" onClick={() => handleApprove(entry.email)} disabled={approving === entry.email}>
                      {approving === entry.email ? 'Approving…' : 'Approve'}
                    </Button>
                  ) : entry.code ? (
                    <div className="flex items-center gap-2">
                      <code className="text-[11px] font-mono bg-secondary/40 rounded px-2 py-1">
                        {entry.code.slice(0, 8)}…
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyInvite(entry)}
                      >
                        {copied === entry.email ? 'Copied' : 'Copy code + link'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => shareInvite(entry)}>
                        Send it
                      </Button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-foreground/40">code already used</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-sm text-foreground/50">Loading…</div>
          ) : users.length === 0 ? (
            <div className="py-16 text-center text-sm text-foreground/50">No users found</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left px-4 py-2.5 font-medium text-foreground/60">Username</th>
                  <th className="text-left px-4 py-2.5 font-medium text-foreground/60">Email</th>
                  <th className="text-left px-4 py-2.5 font-medium text-foreground/60">Admin</th>
                  <th className="w-10 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {users.map((user, idx) => {
                  const isSelf = user.username === storage.getUsername()
                  return (
                  <tr
                    key={user.uid ?? user.username}
                    className={`border-b border-border last:border-0 ${idx % 2 === 0 ? '' : 'bg-secondary/10'}`}
                  >
                    <td className="px-4 py-3 font-medium">{user.username}</td>
                    <td className="px-4 py-3 text-foreground/70">{user.email ?? '-'}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => !isSelf && handleToggleAdmin(user)}
                        disabled={isSelf}
                        title={isSelf ? 'Cannot change your own role' : user.is_admin ? 'Revoke admin' : 'Grant admin'}
                        className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border transition-colors ${
                          isSelf
                            ? 'opacity-50 cursor-not-allowed border-transparent'
                            : 'cursor-pointer hover:opacity-80'
                        } ${
                          user.is_admin
                            ? 'bg-primary/15 border-primary/30 text-primary'
                            : 'bg-secondary border-border text-foreground/50 hover:border-foreground/30'
                        }`}
                      >
                        {user.is_admin
                          ? <><ShieldCheck className="w-3 h-3" /> Admin</>
                          : <><Shield className="w-3 h-3" /> User</>}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openRecovery(user)}
                        className="p-1.5 mr-1 rounded text-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors"
                        title={`Recovery for ${user.username}`}
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setModalState({ type: 'delete', username: user.username })}
                        className="p-1.5 rounded text-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title={`Delete ${user.username}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <InputModal
        isOpen={modalState.type === 'create'}
        onClose={() => setModalState({ type: null })}
        title="Create New User"
        label="Username"
        placeholder="e.g. john"
        confirmText="Create"
        onConfirm={handleCreate}
      />

      {recovery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-medium">Password recovery</h3>
                <p className="mt-0.5 text-xs text-foreground/50">{recovery.username}@slothlee.xyz</p>
              </div>
              <button onClick={() => setRecovery(null)} className="p-1 rounded hover:bg-foreground/10">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="mt-3 text-xs text-foreground/60">
              The link is sent to a recovery address, not to the mailbox — someone who cannot sign
              in cannot read their own inbox.
            </p>

            <label className="mt-3 block text-xs uppercase tracking-wide text-foreground/50">
              Recovery address
            </label>
            <div className="mt-1 flex gap-2">
              <input
                type="email"
                value={recovery.email}
                onChange={(e) => setRecovery((r) => ({ ...r, email: e.target.value }))}
                placeholder="them@elsewhere.com"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <Button variant="outline" onClick={saveRecoveryAddress} disabled={recovery.saving}>
                {recovery.saving ? 'Saving…' : 'Save'}
              </Button>
            </div>

            <div className="mt-4 rounded-lg border border-border bg-background/50 p-3">
              <Button
                onClick={sendRecoveryEmail}
                disabled={recovery.sending || !recovery.email.trim()}
                className="w-full"
              >
                {recovery.sending ? 'Sending…' : 'Send recovery email'}
              </Button>

              {recovery.result && (
                <div className="mt-3 space-y-2 text-xs">
                  <p className={recovery.result.emailed ? 'text-green-400' : 'text-amber-400'}>
                    {recovery.result.emailed
                      ? `Sent to ${recovery.result.sent_to}`
                      : `Not mailed: ${recovery.result.mail_error || 'unknown error'}`}
                  </p>
                  <p className="text-foreground/60">
                    Or hand this link over yourself — it works once and expires in{' '}
                    {recovery.result.expires_in_minutes} minutes:
                  </p>
                  <code className="block break-all rounded bg-black/40 p-2 text-[11px] text-foreground/80">
                    {`${window.location.origin}/reset?t=${recovery.result.token}`}
                  </code>
                  <Button variant="outline" onClick={copyRecoveryMessage} className="w-full">
                    <Copy className="mr-2 w-3.5 h-3.5" />
                    {recovery.copied ? 'Copied' : 'Copy message'}
                  </Button>
                </div>
              )}

              {recovery.error && <p className="mt-2 text-xs text-destructive">{recovery.error}</p>}
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={modalState.type === 'delete'}
        onClose={() => setModalState({ type: null })}
        title="Delete User"
        description={`Are you sure you want to delete "${modalState.username}"? This cannot be undone.`}
        confirmText="Delete"
        onConfirm={handleDelete}
      />
    </div>
  )
}

export default AdminPanel
