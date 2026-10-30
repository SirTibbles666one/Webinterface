import api from '@/api'
import { storage } from '@/storage'

export function useEmailActions({ emailMeta, setEmailMeta, setUids, setPreviews, setSelectedUid, setGroups, groups }) {
  const patchMeta = (uid, patch) => {
    setEmailMeta((prev) => {
      const updated = { ...prev, [uid]: { ...prev[uid], ...patch } }
      storage.setEmailMeta(uid, patch)
      return updated
    })
  }

  const markRead = async (uid) => {
    if (emailMeta[uid]?.unread === false) return
    patchMeta(uid, { unread: false })
    try {
      const token = storage.getToken()
      await api.post('/email/read', `{"uid":"${uid}"}`, { headers: { Authorization: `Bearer ${token}` } })
    } catch {}
  }

  const markUnread = async (uid) => {
    patchMeta(uid, { unread: true })
    try {
      const token = storage.getToken()
      await api.post('/email/unread', `{"uid":"${uid}"}`, { headers: { Authorization: `Bearer ${token}` } })
    } catch {}
  }

  const toggleStar = async (uid) => {
    const next = !emailMeta[uid]?.starred
    patchMeta(uid, { starred: next })
    try {
      const token = storage.getToken()
      await api.post(
        '/email/star',
        `{"uid":"${uid}","starred":${next}}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
    } catch {}
  }

  const deleteEmail = async (uid) => {
    try {
      const token = storage.getToken()
      const headers = { Authorization: `Bearer ${token}` }
      await api.post('/email/delete', `{"uid":"${uid}"}`, { headers })
      for (const g of groups) {
        if (g.email_uids.includes(uid)) {
          try { await api.post('/group/remove-email', `{"group_uid":${g.uid},"email_uid":${uid}}`, { headers }) } catch {}
        }
      }
      setUids((prev) => prev.filter((u) => u !== uid))
      setPreviews((prev) => { const { [uid]: _, ...rest } = prev; return rest })
      setSelectedUid((prev) => (prev === uid ? null : prev))
      setGroups((prev) => prev.map((g) => ({ ...g, email_uids: g.email_uids.filter((u) => u !== uid) })))
    } catch {}
  }

  const moveToGroup = async (emailUid, groupId) => {
    try {
      const token = storage.getToken()
      const headers = { Authorization: `Bearer ${token}` }
      for (const g of groups) {
        if (g.uid !== groupId && g.email_uids.includes(emailUid)) {
          try { await api.post('/group/remove-email', `{"group_uid":${g.uid},"email_uid":${emailUid}}`, { headers }) } catch {}
        }
      }
      await api.post('/group/add-email', `{"group_uid":${groupId},"email_uid":${emailUid}}`, { headers })
    } catch {}
    setGroups((prev) => prev.map((g) => {
      if (g.uid === groupId) return { ...g, email_uids: [...new Set([...g.email_uids, emailUid])] }
      return { ...g, email_uids: g.email_uids.filter((u) => u !== emailUid) }
    }))
  }

  const removeFromGroup = async (emailUid, groupId) => {
    try {
      const token = storage.getToken()
      await api.post('/group/remove-email', `{"group_uid":${groupId},"email_uid":${emailUid}}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {}
    setGroups((prev) => prev.map((g) =>
      g.uid === groupId ? { ...g, email_uids: g.email_uids.filter((u) => u !== emailUid) } : g,
    ))
  }

  return { patchMeta, markRead, markUnread, toggleStar, deleteEmail, moveToGroup, removeFromGroup }
}
