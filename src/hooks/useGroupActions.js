import api from '@/api'
import { storage } from '@/storage'

export function useGroupActions({ setGroups, setSelectedFolder, setModalState }) {
  const createGroup = async (name) => {
    if (!name) return
    try {
      const token = storage.getToken()
      const res = await api.post('/group/create', { title: name, filter_addresses: [] }, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setGroups((prev) => [...prev, res.data])
    } catch {}
    setModalState({ type: null })
  }

  const renameGroup = async (uid, name) => {
    if (!name) return
    try {
      const token = storage.getToken()
      const res = await api.post('/group/update', `{"uid":"${uid}","title":${JSON.stringify(name)}}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setGroups((prev) => prev.map((g) => (g.uid === uid ? res.data : g)))
    } catch {}
    setModalState({ type: null })
  }

  const deleteGroup = async (uid) => {
    try {
      const token = storage.getToken()
      await api.post('/group/delete', `{"uid":"${uid}"}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setGroups((prev) => prev.filter((g) => g.uid !== uid))
    } catch {}
    setSelectedFolder('inbox')
    setModalState({ type: null })
  }

  return { createGroup, renameGroup, deleteGroup }
}
