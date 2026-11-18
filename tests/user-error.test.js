import { describe, it, expect } from 'vitest'
import { userFacingError } from '@/lib/userError'

const withStatus = (status, data = {}) => ({ response: { status, data } })

describe('userFacingError', () => {
  it('never shows a raw axios sentence', () => {
    const axiosish = new Error('Request failed with status code 500')
    axiosish.response = { status: 500, data: {} }
    const text = userFacingError(axiosish)
    expect(text).not.toMatch(/status code/i)
    expect(text).toMatch(/server had a problem/i)
  })

  it('explains a dropped connection rather than "Network Error"', () => {
    const err = new Error('Network Error')
    expect(userFacingError(err)).toMatch(/can't reach the server/i)
  })

  it('names a timeout', () => {
    expect(userFacingError({ code: 'ECONNABORTED' })).toMatch(/timed out/i)
  })

  it('maps the statuses that have an obvious action', () => {
    expect(userFacingError(withStatus(401))).toMatch(/session has expired/i)
    expect(userFacingError(withStatus(403))).toMatch(/permission/i)
    expect(userFacingError(withStatus(429))).toMatch(/too many attempts/i)
    // A size refusal has to name a number the reader can act on, and must not sound retryable.
    const tooBig = userFacingError(withStatus(413))
    expect(tooBig).toMatch(/24 MB/)
    expect(tooBig).toMatch(/remove the largest one|share a link/i)
  })

  it('lets a call site override a status where the generic sentence is wrong', () => {
    // A refused login is not an expired session.
    const opts = { status: { 401: 'Wrong username or password.' } }
    expect(userFacingError(withStatus(401), opts)).toBe('Wrong username or password.')
  })

  it('keeps a server sentence written for a person', () => {
    const text = userFacingError(withStatus(400, { error: 'That mailbox name is already taken.' }))
    expect(text).toBe('That mailbox name is already taken.')
  })

  it('does not pass through a bare code as if it were a sentence', () => {
    expect(userFacingError(withStatus(400, { error: 'invalid_json' }))).toMatch(/something went wrong/i)
    expect(userFacingError(withStatus(400, { error: 'x'.repeat(400) }))).toMatch(/something went wrong/i)
  })

  it('uses the fallback when there is nothing to go on', () => {
    expect(userFacingError(undefined)).toMatch(/something went wrong/i)
    expect(userFacingError(null, { fallback: 'Send failed. Please try again.' })).toBe('Send failed. Please try again.')
  })
})
