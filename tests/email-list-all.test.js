import { describe, it, expect, vi, beforeEach } from 'vitest'

// The server pages /email/list (DEFAULT_PAGE 200). This client must never mistake one
// page for the mailbox: a short list here silently truncated password re-encryption and
// mailbox export, and the credential swap that follows it destroys the old key.
const post = vi.fn()
vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual }
})
vi.mock('/src/api.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual }
})

// api.js builds its own axios instance at import time; stub that instead of the module.
vi.mock('axios', () => {
  const instance = { post: (...args) => post(...args), get: vi.fn(), interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } }
  return { default: { create: () => instance }, create: () => instance }
})

import { emailListAll } from '@/api'

const page = (n, start) => ({ data: { uids: Array.from({ length: n }, (_, i) => String(start + i)) } })

describe('emailListAll', () => {
  beforeEach(() => { post.mockReset(); localStorage.setItem('openneutron', JSON.stringify({ token: 't', username: 'u' })) })

  it('pages until a short page comes back', async () => {
    post
      .mockResolvedValueOnce(page(500, 0))
      .mockResolvedValueOnce(page(500, 500))
      .mockResolvedValueOnce(page(3, 1000))

    const uids = await emailListAll()

    expect(uids).toHaveLength(1003)
    expect(post).toHaveBeenCalledTimes(3)
    expect(post.mock.calls[1][1]).toMatchObject({ offset: 500 })
    expect(post.mock.calls[2][1]).toMatchObject({ offset: 1000 })
  })

  it('stops on an exactly-full final page', async () => {
    post.mockResolvedValueOnce(page(500, 0)).mockResolvedValueOnce(page(0, 500))
    expect(await emailListAll()).toHaveLength(500)
  })

  it('throws instead of returning a plausible prefix when a page fails', async () => {
    post.mockResolvedValueOnce(page(500, 0)).mockRejectedValueOnce(new Error('500'))
    await expect(emailListAll()).rejects.toThrow()
  })
})
