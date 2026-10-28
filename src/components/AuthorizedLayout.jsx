import { useState, useCallback, useEffect, useMemo } from 'react'
import Sidebar from '@/components/Sidebar'
import EmailList from '@/components/EmailList'
import ScheduledPanel from '@/components/ScheduledPanel'
import EmailView from '@/components/EmailView'
import ComposeWindow from '@/components/ComposeWindow'
import { ConfirmModal, InputModal } from '@/components/ui/Modal'
import { TopBar } from '@/components/TopBar'
import { PgpModal } from '@/components/PgpModal'
import { hasIdentity } from '@/pgp'
import { Lock, ShieldAlert } from 'lucide-react'
import { UnlockModal } from '@/components/UnlockModal'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'
import { EmailToolbar } from '@/components/EmailToolbar'
import { useEmailFetch } from '@/hooks/useEmailFetch'
import { useSentEmails } from '@/hooks/useSentEmails'
import { useEmailActions } from '@/hooks/useEmailActions'
import { useGroupActions } from '@/hooks/useGroupActions'
import { keySession } from '@/keySession'
import { mergeServerFlags } from '@/lib/mailboxState'
import { storage } from '@/storage'
import { buildQuotedBody } from '@/emailParser'
import api, { userRecoveryKeyStatus } from '@/api'

const PAGE_SIZE = 20

const AuthorizedLayout = () => {
  const [selectedUid, setSelectedUid] = useState(null)
  const [navOpen, setNavOpen] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState('inbox')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState('all')
  const [page, setPage] = useState(0)
  const [emailMeta, setEmailMeta] = useState(() => storage.getEmailMeta())
  const [groups, setGroups] = useState([])
  const [checkedUids, setCheckedUids] = useState(new Set())
  const [modalState, setModalState] = useState({ type: null })
  const [composeOpen, setComposeOpen] = useState(false)
  const [replyData, setReplyData] = useState(null)
  const [composeDraftId, setComposeDraftId] = useState(null)
  const [drafts, setDrafts] = useState(() => storage.getDrafts())
  const [userEmail, setUserEmail] = useState('')
  const [isAdmin, setIsAdmin] = useState(() => storage.getIsAdmin())
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [showPgp, setShowPgp] = useState(false)
  const [keyPromptDismissed, setKeyPromptDismissed] = useState(false)
  // null = unknown (not fetched yet), false = no recovery key on file.
  const [recoveryKeySet, setRecoveryKeySet] = useState(null)
  const [recoveryPromptDismissed, setRecoveryPromptDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    userRecoveryKeyStatus()
      .then((data) => { if (!cancelled) setRecoveryKeySet(!!data.set) })
      .catch(() => { if (!cancelled) setRecoveryKeySet(null) })
    return () => { cancelled = true }
  }, [showPgp])
  const [hasOwnKey, setHasOwnKey] = useState(true)
  const [needsUnlock, setNeedsUnlock] = useState(false)
  const [serverStatus, setServerStatus] = useState('checking')

  const { uids, setUids, previews, setPreviews, loading, hasMore, fetchEmails, loadMore } = useEmailFetch()
  const { sentUids, setSentUids, fetchSentUids, fetchSentPreviews } = useSentEmails(setPreviews)
  const { markRead, markUnread, toggleStar, deleteEmail, moveToGroup, removeFromGroup } = useEmailActions({
    emailMeta, setEmailMeta, setUids, setPreviews, setSelectedUid, setGroups, groups,
  })
  const { createGroup, renameGroup, deleteGroup } = useGroupActions({ setGroups, setSelectedFolder, setModalState })

  const checkServer = useCallback(async () => {
    try {
      const token = storage.getToken()
      const res = await api.get('/user/me', { headers: { Authorization: `Bearer ${token}` } })
      const user = res.data
      if (user) {
        setUserEmail(user.email ?? user.username ?? '')
        const admin = user.is_admin ?? false
        setIsAdmin(admin)
        storage.set({ is_admin: admin })
      }
      setServerStatus('ok')
    } catch {
      setServerStatus('unreachable')
    }
  }, [])

  const fetchGroups = useCallback(async () => {
    try {
      const token = storage.getToken()
      const res = await api.get('/group/list', { headers: { Authorization: `Bearer ${token}` } })
      setGroups(res.data.groups ?? [])
    } catch {}
  }, [])

  const handleRefresh = useCallback(() => {
    fetchEmails(0)
  }, [fetchEmails])

  useEffect(() => {
    checkServer()
    fetchEmails(0)
    fetchGroups()
    // The private key lives only in the session; a reload drops it, and without
    // it every message renders as undecryptable. Ask once, up front.
    keySession.get().then((k) => { if (!k) setNeedsUnlock(true) })

    // Adopt the server's read/starred state so this browser agrees with every
    // other one. Until this lands, meta is treated as a cache, not the truth.
    api.post('/email/flags', {}, { headers: { Authorization: `Bearer ${storage.getToken()}` } })
      .then((res) => {
        const flags = res.data?.flags ?? []
        if (!flags.length) return
        setEmailMeta((prev) => {
          const merged = mergeServerFlags(prev, flags)
          storage.saveEmailMeta(merged)
          return merged
        })
      })
      .catch(() => {})
    const serverPollId = setInterval(() => checkServer(), 30000)
    return () => {
      clearInterval(serverPollId)
    }
  }, [])

  useEffect(() => {
    try {
      setHasOwnKey(hasIdentity())
    } catch {
      setHasOwnKey(true)
    }
  }, [showPgp])

  const visibleUids = (() => {
    if (selectedFolder === 'inbox') return uids
    if (selectedFolder === 'starred') return uids.filter((uid) => emailMeta[uid]?.starred)
    if (selectedFolder === 'sent') return sentUids
    if (selectedFolder === 'drafts') return drafts.map((d) => d.id)
    const group = groups.find((g) => g.uid === selectedFolder)
    if (group) return group.email_uids.filter((uid) => uids.includes(uid) || sentUids.includes(uid))
    return uids
  })()

  const draftPreviews = useMemo(() => {
    const map = {}
    for (const d of drafts) {
      map[d.id] = {
        subject:  d.subject || '(no subject)',
        from:     { email: '', name: d.to?.[0] ? `To: ${d.to[0]}` : '(no recipients)' },
        date:     d.updatedAt ? new Date(d.updatedAt) : null,
        preview:  d.body?.slice(0, 100) ?? '',
        isDraft:  true,
      }
    }
    return map
  }, [drafts])

  const allPreviews = selectedFolder === 'drafts' ? draftPreviews : previews

  const filteredUids = useMemo(() => {
    if (selectedFolder === 'drafts') return visibleUids
    let result = visibleUids
    if (filterMode === 'unread') result = result.filter((uid) => emailMeta[uid]?.unread !== false)
    else if (filterMode === 'read') result = result.filter((uid) => emailMeta[uid]?.unread === false)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((uid) => {
        const p = previews[uid]
        if (!p) return false
        return (
          p.subject?.toLowerCase().includes(q) ||
          p.from?.name?.toLowerCase().includes(q) ||
          p.from?.email?.toLowerCase().includes(q)
        )
      })
    }
    return result
  }, [visibleUids, filterMode, searchQuery, emailMeta, previews, selectedFolder])

  const totalFiltered = filteredUids.length
  const pageCount = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageStart = totalFiltered === 0 ? 0 : safePage * PAGE_SIZE + 1
  const pageEnd = Math.min((safePage + 1) * PAGE_SIZE, totalFiltered)
  const pagedUids = filteredUids.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  useEffect(() => { setPage(0) }, [selectedFolder, filterMode, searchQuery])

  useEffect(() => {
    if (selectedFolder === 'sent') {
      fetchSentUids().then((uids) => {
        const missing = uids.filter((uid) => !previews[uid])
        if (missing.length > 0) fetchSentPreviews(missing)
      })
    }
  }, [selectedFolder])

  const folderLabel = (() => {
    if (selectedFolder === 'inbox') return 'Inbox'
    if (selectedFolder === 'starred') return 'Starred'
    if (selectedFolder === 'sent') return 'Sent'
    if (selectedFolder === 'drafts') return 'Drafts'
    return groups.find((g) => g.uid === selectedFolder)?.title ?? 'Inbox'
  })()

  const handleSelect = (uid) => {
    if (String(uid).startsWith('draft_')) {
      const draft = drafts.find((d) => d.id === uid)
      if (draft) {
        setReplyData({ to: draft.to ?? [], cc: draft.cc ?? [], bcc: draft.bcc ?? [], subject: draft.subject ?? '', body: draft.body ?? '' })
        setComposeDraftId(draft.id)
        setComposeOpen(true)
      }
      return
    }
    setSelectedUid(uid)
    markRead(uid)
  }

  const handleLogout = () => {
    keySession.clear()
    storage.clear()
    console.log('[Logout] localStorage after clear:', JSON.stringify(JSON.parse(localStorage.getItem('openneutron') || '{}')))
    window.location.reload()
  }

  const handleCheck = (uid) => {
    setCheckedUids(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  const handleToggleSelectAll = () => {
    const allChecked = pagedUids.every(uid => checkedUids.has(uid))
    setCheckedUids(allChecked ? new Set() : new Set(pagedUids))
  }

  const deleteSelected = async () => {
    const toDelete = [...checkedUids]
    setModalState({ type: null })
    const token = storage.getToken()
    const headers = { Authorization: `Bearer ${token}` }
    await Promise.all(toDelete.map(async (uid) => {
      try {
        await api.post('/email/delete', `{"uid":${uid}}`, { headers })
        for (const g of groups) {
          if (g.email_uids.includes(uid)) {
            try { await api.post('/group/remove-email', `{"group_uid":${g.uid},"email_uid":${uid}}`, { headers }) } catch {}
          }
        }
      } catch {}
    }))
    setUids(prev => prev.filter(u => !toDelete.includes(u)))
    setPreviews(prev => { const n = { ...prev }; toDelete.forEach(u => delete n[u]); return n })
    setSelectedUid(prev => (toDelete.includes(prev) ? null : prev))
    setGroups(prev => prev.map(g => ({ ...g, email_uids: g.email_uids.filter(u => !toDelete.includes(u)) })))
    setCheckedUids(new Set())
  }

  const markSelectedRead = () => {
    checkedUids.forEach(uid => markRead(uid))
    setCheckedUids(new Set())
  }

  const markSelectedUnread = () => {
    checkedUids.forEach(uid => markUnread(uid))
    setCheckedUids(new Set())
  }

  const moveSelectedToGroup = (groupId) => {
    checkedUids.forEach(uid => moveToGroup(uid, groupId))
    setCheckedUids(new Set())
  }

  const handleRemoveFromGroup = useCallback((uid) => removeFromGroup(uid, selectedFolder), [removeFromGroup, selectedFolder])

  const handleSent = useCallback((newUid) => {
    if (!newUid) return
    const uid = String(newUid)
    setSentUids((prev) => (prev.includes(uid) ? prev : [uid, ...prev]))
    fetchSentPreviews([uid])
  }, [fetchSentPreviews])

  const handleComposeClose = useCallback((savedDraft) => {
    if (savedDraft) {
      storage.saveDraft(savedDraft)
      setDrafts(storage.getDrafts())
    }
    setComposeOpen(false)
    setReplyData(null)
    setComposeDraftId(null)
  }, [])

  const handleDeleteDraft = useCallback((draftId) => {
    storage.deleteDraft(draftId)
    setDrafts(storage.getDrafts())
  }, [])

  const handleComposeTo = useCallback((emailAddr) => {
    setReplyData({ to: [emailAddr], subject: '', body: '' })
    setComposeDraftId(null)
    setComposeOpen(true)
  }, [])

  const handleReply = useCallback((email) => {
    const sender = email.replyTo?.[0] ?? email.from
    const replyAddr = sender?.email ?? ''
    const subj = /^Re:/i.test(email.subject ?? '') ? email.subject : `Re: ${email.subject ?? ''}`
    setReplyData({
      to:        replyAddr ? [replyAddr] : [],
      subject:   subj,
      body:      `\n\n${buildQuotedBody(email)}`,
      inReplyTo: email.messageId ?? '',
      references: email.messageId ?? '',
      // Answer from the address they wrote to, not from the real one.
      fromAlias: email.alias ?? '',
    })
    setComposeOpen(true)
  }, [])

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        <div className="hidden md:block w-64 shrink-0">
          <Sidebar
            selectedFolder={selectedFolder}
            onSelectFolder={setSelectedFolder}
            groups={groups}
            onRequestCreateGroup={() => setModalState({ type: 'create-group' })}
            onRequestRenameGroup={(id, name) => setModalState({ type: 'rename-group', id, name })}
            onRequestDeleteGroup={(id, name) => setModalState({ type: 'delete-group', id, name })}
            emailMeta={emailMeta}
            uids={uids}
            sentCount={sentUids.length}
            draftsCount={drafts.length}
            onCompose={() => setComposeOpen(true)}
          />
        </div>
        {/* Mobile folder drawer */}
        {navOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setNavOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-background border-r border-border shadow-2xl">
              <Sidebar
                selectedFolder={selectedFolder}
                onSelectFolder={(folder) => { setSelectedFolder(folder); setNavOpen(false) }}
                groups={groups}
                onRequestCreateGroup={() => { setNavOpen(false); setModalState({ type: 'create-group' }) }}
                onRequestRenameGroup={(id, name) => { setNavOpen(false); setModalState({ type: 'rename-group', id, name }) }}
                onRequestDeleteGroup={(id, name) => { setNavOpen(false); setModalState({ type: 'delete-group', id, name }) }}
                emailMeta={emailMeta}
                uids={uids}
                sentCount={sentUids.length}
                draftsCount={drafts.length}
                onCompose={() => { setNavOpen(false); setComposeOpen(true) }}
              />
            </div>
          </div>
        )}
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            userEmail={userEmail}
            isAdmin={isAdmin}
            serverStatus={serverStatus}
            onLogout={handleLogout}
            onRetryServer={checkServer}
            onChangePassword={() => setShowChangePassword(true)}
            onOpenNav={() => setNavOpen(true)}
            onOpenPgp={() => setShowPgp(true)}
          />
          {recoveryKeySet === false && !recoveryPromptDismissed && (
            <div className="flex items-start gap-3 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/25 text-[12px]">
              <ShieldAlert className="w-3.5 h-3.5 mt-0.5 text-amber-400 shrink-0" />
              <p className="flex-1 text-foreground/80">
                <span className="font-medium">No recovery key.</span> If you forget your password,
                your encrypted mail cannot be recovered — the reset link cannot open it either.
              </p>
              <button
                onClick={() => { setShowPgp(true); setRecoveryPromptDismissed(true) }}
                className="shrink-0 rounded-md border border-amber-500/40 px-2 py-1 text-amber-300 hover:bg-amber-500/10"
              >
                Create recovery key
              </button>
              <button
                onClick={() => setRecoveryPromptDismissed(true)}
                className="shrink-0 text-foreground/40 hover:text-foreground/70"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}
          {!hasOwnKey && !keyPromptDismissed && (
            <div className="flex items-start gap-3 px-4 py-2.5 bg-primary/10 border-b border-primary/20 text-[12px]">
              <Lock className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
              <p className="flex-1 text-foreground/80">
                <span className="font-medium">No OpenPGP key yet.</span> Mail between mailboxes on
                this server is already encrypted with your account key. An OpenPGP key is what lets
                you exchange encrypted mail with people on other providers.
              </p>
              <button
                onClick={() => setShowPgp(true)}
                className="shrink-0 rounded-md border border-primary/40 px-2 py-1.5 sm:py-1 text-primary hover:bg-primary/10"
              >
                Create OpenPGP key
              </button>
              <button
                onClick={() => setKeyPromptDismissed(true)}
                className="shrink-0 text-foreground/40 hover:text-foreground/70"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}
          <div className="flex-1 flex min-h-0">
            <div className="w-full md:w-[680px] md:shrink-0 border-l border-r border-border flex flex-col overflow-hidden">
              {selectedFolder !== 'drafts' && (
              <EmailToolbar
                pagedUids={pagedUids}
                checkedUids={checkedUids}
                totalFiltered={totalFiltered}
                pageStart={pageStart}
                pageEnd={pageEnd}
                safePage={safePage}
                pageCount={pageCount}
                hasMore={selectedFolder === 'inbox' && hasMore}
                groups={groups}
                onToggleSelectAll={handleToggleSelectAll}
                onDeleteSelected={() => setModalState({ type: 'delete-selected' })}
                onMarkSelectedRead={markSelectedRead}
                onMarkSelectedUnread={markSelectedUnread}
                onMoveSelectedToGroup={moveSelectedToGroup}
                onPrevPage={() => setPage(p => Math.max(0, p - 1))}
                onNextPage={() => {
                  const next = safePage + 1
                  setPage(next)
                  if (next >= pageCount - 1 && hasMore) loadMore()
                }}
                onRefresh={handleRefresh}
                refreshing={loading}
              />
              )}
              {selectedFolder === 'sent' && <ScheduledPanel />}
              <EmailList
                uids={pagedUids}
                previews={allPreviews}
                emailMeta={emailMeta}
                selectedUid={selectedUid}
                checkedUids={checkedUids}
                onSelect={handleSelect}
                onCheck={handleCheck}
                onToggleSelectAll={handleToggleSelectAll}
                loading={loading}
                hasMore={selectedFolder === 'inbox' && hasMore}
                onLoadMore={loadMore}
                onMarkRead={markRead}
                onMarkUnread={markUnread}
                onToggleStar={toggleStar}
                onDeleteEmail={(uid) => {
                  if (String(uid).startsWith('draft_')) { handleDeleteDraft(uid) }
                  else setModalState({ type: 'delete-email', uid })
                }}
                onMoveToGroup={moveToGroup}
                onRemoveFromGroup={handleRemoveFromGroup}
                groups={groups}
                folderLabel={folderLabel}
                selectedFolder={selectedFolder}
                filterMode={filterMode}
                onFilterModeChange={(m) => { setFilterMode(m); setPage(0) }}
              />
            </div>
            <div className={`${selectedUid ? 'fixed inset-0 z-40 bg-background flex flex-col md:static md:z-auto md:block' : 'hidden md:block'} flex-1 min-w-0`}>
              {selectedUid && (
                <button
                  onClick={() => setSelectedUid(null)}
                  className="md:hidden flex items-center gap-1.5 px-3 py-2 border-b border-border text-sm text-foreground/70"
                >
                  <span aria-hidden="true">←</span> Back to inbox
                </button>
              )}
              <EmailView
                key={selectedUid}
                uid={selectedUid}
                myEmail={userEmail}
                emailMeta={selectedUid ? (emailMeta[selectedUid] ?? {}) : null}
                arrivedAt={selectedUid ? (previews[selectedUid]?.alias ?? null) : null}
                onToggleStar={toggleStar}
                onMarkRead={markRead}
                onMarkUnread={markUnread}
                onDeleteEmail={(uid) => setModalState({ type: 'delete-email', uid })}
                onMessageDeleted={(uid) => {
                  // The server already deleted it, so drop the row without asking
                  // the delete endpoint again. The open message stays on screen:
                  // it is the last time it can be read.
                  setUids((prev) => prev.filter((u) => u !== uid))
                  setPreviews((prev) => {
                    const next = { ...prev }
                    delete next[uid]
                    return next
                  })
                }}
                onMoveToGroup={moveToGroup}
                onRemoveFromGroup={handleRemoveFromGroup}
                groups={groups}
                selectedFolder={selectedFolder}
                onReply={handleReply}
                onComposeTo={handleComposeTo}
              />
            </div>
          </div>
        </div>
      </div>

      <InputModal
        isOpen={modalState.type === 'create-group'}
        onClose={() => setModalState({ type: null })}
        title="Create New Group"
        label="Group Name"
        placeholder="e.g. Work, Family"
        onConfirm={createGroup}
      />
      <InputModal
        isOpen={modalState.type === 'rename-group'}
        onClose={() => setModalState({ type: null })}
        title="Rename Group"
        label="New Group Name"
        initialValue={modalState.name}
        onConfirm={(name) => renameGroup(modalState.id, name)}
      />
      <ConfirmModal
        isOpen={modalState.type === 'delete-email'}
        onClose={() => setModalState({ type: null })}
        title="Delete Email"
        description="Permanently delete this email? This cannot be undone."
        confirmText="Delete"
        onConfirm={() => { deleteEmail(modalState.uid); setModalState({ type: null }) }}
      />
      <ConfirmModal
        isOpen={modalState.type === 'delete-selected'}
        onClose={() => setModalState({ type: null })}
        title="Delete Selected"
        description={`Permanently delete ${checkedUids.size} email${checkedUids.size !== 1 ? 's' : ''}? This cannot be undone.`}
        confirmText={`Delete ${checkedUids.size}`}
        onConfirm={deleteSelected}
      />
      <ConfirmModal
        isOpen={modalState.type === 'delete-group'}
        onClose={() => setModalState({ type: null })}
        title="Delete Group"
        description={`Are you sure you want to delete the group "${modalState.name}"? This cannot be undone.`}
        confirmText="Delete"
        onConfirm={() => deleteGroup(modalState.id)}
      />

      {composeOpen && (
        <ComposeWindow
          myEmail={userEmail}
          onClose={handleComposeClose}
          onSent={handleSent}
          replyData={replyData}
          draftId={composeDraftId}
          onDeleteDraft={handleDeleteDraft}
        />
      )}

      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />

      <PgpModal
        isOpen={showPgp}
        onClose={() => setShowPgp(false)}
        accountEmail={userEmail}
      />

      <UnlockModal
        isOpen={needsUnlock && !showPgp}
        onUnlocked={() => window.location.reload()}
      />
    </div>
  )
}

export default AuthorizedLayout
