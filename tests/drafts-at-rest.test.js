import { describe, it, expect, beforeEach, vi } from 'vitest'

// Drafts are encrypted under a key derived from the session's private-key material, which lives in
// memory only now. These tests hold both facts: the ciphertext is on disk, and the ability to read
// it ends with the page.
const loadModules = async () => {
  vi.resetModules()
  const store = await import('@/lib/draftStore')
  const { keySession } = await import('@/keySession')
  return { store, keySession }
}

const makeKey = () =>
  crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  )

describe('drafts at rest', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('never writes the body to localStorage in the clear', async () => {
    const { store, keySession } = await loadModules()
    await keySession.set((await makeKey()).privateKey)
    await store.loadDrafts()
    store.put({ id: 'draft_1', to: 'bank@example.com', subject: 'Transfer', body: 'the password is hunter2' })
    await store.reencryptAll()

    const raw = localStorage.getItem('openneutron.drafts.v1')
    expect(raw).toBeTruthy()
    expect(raw).not.toMatch(/hunter2/)
    expect(raw).not.toMatch(/bank@example\.com/)
    expect(raw).not.toMatch(/Transfer/)
    expect(JSON.parse(raw).ct).toBeTruthy()
  })

  it('never puts the private key in storage at all', async () => {
    const { keySession } = await loadModules()
    await keySession.set((await makeKey()).privateKey)
    expect(sessionStorage.getItem('openneutron.private_key')).toBeNull()
    expect(localStorage.getItem('openneutron.private_key')).toBeNull()
  })

  it('reads drafts back while the same key is in memory', async () => {
    const { store, keySession } = await loadModules()
    await keySession.set((await makeKey()).privateKey)
    await store.loadDrafts()
    store.put({ id: 'draft_1', body: 'the password is hunter2' })
    await store.reencryptAll()

    const drafts = await store.loadDrafts()
    expect(drafts).toHaveLength(1)
    expect(drafts[0].body).toBe('the password is hunter2')
  })

  it('shows nothing rather than garbage once the key is gone', async () => {
    const { store, keySession } = await loadModules()
    await keySession.set((await makeKey()).privateKey)
    await store.loadDrafts()
    store.put({ id: 'draft_1', body: 'secret' })
    await store.reencryptAll()

    keySession.clear()
    vi.resetModules()
    const fresh = await import('@/lib/draftStore')
    expect(await fresh.loadDrafts()).toEqual([])
  })

  it('migrates a plaintext draft left by the old storage and removes the plaintext', async () => {
    localStorage.setItem('openneutron', JSON.stringify({ token: 't', drafts: [{ id: 'draft_old', body: 'legacy secret' }] }))
    const { store, keySession } = await loadModules()
    await keySession.set((await makeKey()).privateKey)
    const drafts = await store.loadDrafts()
    expect(drafts).toHaveLength(1)
    expect(drafts[0].body).toBe('legacy secret')
    expect(localStorage.getItem('openneutron')).not.toMatch(/legacy secret/)
  })
})
