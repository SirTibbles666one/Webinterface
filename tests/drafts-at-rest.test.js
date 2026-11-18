import { describe, it, expect, beforeEach, vi } from 'vitest'

// jsdom has localStorage and sessionStorage but not WebCrypto's subtle for everything we need,
// so the session key material is stubbed and the real crypto does the work.
const PRIVATE_KEY_JSON = JSON.stringify({ format: 'jwk', data: { kty: 'RSA', d: 'secret-material', n: 'modulus' } })

const loadStore = async () => {
  vi.resetModules()
  return import('@/lib/draftStore')
}

describe('drafts at rest', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    sessionStorage.setItem('openneutron.private_key', PRIVATE_KEY_JSON)
  })

  it('never writes the body to localStorage in the clear', async () => {
    const store = await loadStore()
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

  it('reads them back with the same session key', async () => {
    const store = await loadStore()
    await store.loadDrafts()
    store.put({ id: 'draft_1', body: 'the password is hunter2' })
    await store.reencryptAll()

    const reopened = await loadStore()
    const drafts = await reopened.loadDrafts()
    expect(drafts).toHaveLength(1)
    expect(drafts[0].body).toBe('the password is hunter2')
  })

  it('shows nothing rather than garbage when the key no longer matches', async () => {
    const store = await loadStore()
    await store.loadDrafts()
    store.put({ id: 'draft_1', body: 'secret' })
    await store.reencryptAll()

    sessionStorage.setItem('openneutron.private_key', JSON.stringify({ format: 'jwk', data: { d: 'a-different-key' } }))
    const reopened = await loadStore()
    const drafts = await reopened.loadDrafts()
    expect(drafts).toEqual([])
  })

  it('migrates a plaintext draft left by the old storage and removes the plaintext', async () => {
    localStorage.setItem('openneutron', JSON.stringify({ token: 't', drafts: [{ id: 'draft_old', body: 'legacy secret' }] }))
    const store = await loadStore()
    const drafts = await store.loadDrafts()
    expect(drafts).toHaveLength(1)
    expect(drafts[0].body).toBe('legacy secret')
    expect(localStorage.getItem('openneutron')).not.toMatch(/legacy secret/)
  })
})
