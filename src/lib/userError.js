// Turning a transport failure into a sentence a person can act on.
//
// Screens were printing whatever axios produced — "Request failed with status code 500" in a
// mono block, or the server's bare `error` string — which reads as a broken app rather than
// "try again". This maps the status to a sentence, keeps a server sentence when it is clearly
// written for humans, and never invents detail it does not have.
//
// @param error   whatever was thrown (axios error, Error, anything)
// @param options { fallback, status: { 401: '…', … } } — per-call wording where the generic
//                sentence would be wrong. A failed login is not "your session expired".
export function userFacingError(error, options = {}) {
  const { fallback = 'Something went wrong. Please try again.', status: overrides = {} } = options

  if (!error) return fallback
  const response = error.response
  if (!response) {
    if (error.code === 'ECONNABORTED' || /timeout/i.test(String(error.message || ''))) {
      return 'The connection timed out. Check your network and try again.'
    }
    return "Can't reach the server. Check your connection and try again."
  }

  const status = response.status
  if (overrides[status]) return overrides[status]

  if (status === 401) return 'Your session has expired. Sign in again to continue.'
  if (status === 403) return "You don't have permission to do that."
  if (status === 404) return 'That item no longer exists.'
  if (status === 409) return 'That conflicts with something that already exists.'
  if (status === 413) return 'That is too large to send.'
  if (status === 429) return 'Too many attempts. Wait a moment and try again.'
  if (status >= 500) return 'The server had a problem. Nothing was lost — try again in a moment.'

  // A server sentence is usually written for a person; a bare code ("invalid_json") is not.
  const said = response.data?.error
  if (typeof said === 'string' && said.trim() && said.length <= 200 && /\s/.test(said.trim())) {
    return said.trim()
  }
  return fallback
}
