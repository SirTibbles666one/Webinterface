import axios from 'axios'
import { storage } from './storage'
import { keySession } from './keySession'

// u128 ids come back as JSON *numbers*, so JSON.parse turns a 20-digit uid into a float
// and destroys the low digits (1.4786006677720391e+38). Quoting runs of 16+ digits before
// parsing is the only reason message ids address anything — verified in the signed-message
// end-to-end test, where /email/get answered "Invalid JSON" until this was replicated.
//
// It is also indiscriminate: any 16+ digit run after `:`/`,`/`[` inside a message body is
// quoted too, which corrupts that body. The real fix is uids as strings on the wire
// (docs/UID-ON-THE-WIRE.md); until then this must stay.
const QUOTE_BIG_DIGITS = /([,:[]\s*)(\d{16,})/g

// Does this parsed value contain a number too big to have survived as a double?
function hasUnsafeNumber(node, depth = 0) {
  if (depth > 6 || node === null || typeof node !== 'object') {
    return typeof node === 'number' && Number.isFinite(node) && Math.abs(node) > Number.MAX_SAFE_INTEGER
  }
  if (Array.isArray(node)) return node.some((item) => hasUnsafeNumber(item, depth + 1))
  return Object.values(node).some((value) => hasUnsafeNumber(value, depth + 1))
}

export function preserveBigInts(data) {
  if (typeof data !== 'string') return data

  // Parse cleanly first. Ids travel as strings now, so a well-formed response needs no
  // patching — and patching one anyway corrupts any message body holding a 16-digit number
  // after a colon, which is exactly why such messages used to render as "(encrypted)".
  let parsed
  try {
    parsed = JSON.parse(data)
  } catch {
    parsed = undefined
  }
  // A clean parse is only trustworthy if it did not silently mangle an id: a numeric uid
  // beyond 2^53 has already lost digits by the time it is a `number`. Only then fall back
  // to the quoting pass, which is what old servers need and new ones never trigger.
  if (parsed !== undefined && !hasUnsafeNumber(parsed)) return parsed
  try {
    return JSON.parse(data.replace(QUOTE_BIG_DIGITS, '$1"$2"'))
  } catch {
    return parsed !== undefined ? parsed : data
  }
}

const api = axios.create({
  //baseURL: 'http://openneutron.com:8080',
  //baseURL: 'http://localhost:8080/api',
  baseURL: '/api/',
  headers: {
    'Content-Type': 'application/json',
  },
  transformResponse: [preserveBigInts],
})

// A 401 from one call is not proof the session is over: an endpoint reached
// without its Authorization header answers exactly like an expired token, and
// signing the user out for that is how a single page logs them out mid-use. Ask
// the server whether the token itself is still good before throwing the session
// away — /user/me through plain axios, so this check cannot recurse.
let checkingSession = false

async function tokenRejected(token) {
  try {
    await axios.get('/api/user/me', { headers: { Authorization: `Bearer ${token}` } })
    return false
  } catch (e) {
    return e?.response?.status === 401
  }
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status = err?.response?.status
    const url = err?.config?.url || ''
    if (status === 401 && !url.includes('/auth/') && !checkingSession) {
      const token = storage.getToken()
      checkingSession = true
      const dead = token ? await tokenRejected(token) : true
      checkingSession = false
      if (dead) {
        keySession.clear()
        storage.clear()
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  },
)

/**
 * Tell the filter what this person calls spam (or not spam).
 *
 * The message has to travel with the report: the server stores mail encrypted and cannot
 * read it, so it cannot learn from what it holds. This is the one moment a message is
 * deliberately shown to the server — per message, on purpose, never automatic.
 */
/**
 * The Junk view. A separate read rather than a client-side filter: the server already
 * keeps junk out of the Inbox, so asking for it is the only way to see it.
 */
export const listJunk = async () => {
  const token = storage.getToken()
  if (!token) return []
  const res = await api.post(
    '/email/list',
    { junk: true, limit: 500, offset: 0 },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return (res.data?.uids ?? []).map(String)
}

export const reportSpam = async (uid, verdict, raw) => {
  // Every other call here sends its own Authorization header — this one shipped without it
  // and the endpoint answered 401, which the button then showed. Never assume the axios
  // instance carries a session.
  const token = storage.getToken()
  if (!token) throw new Error('Not signed in')
  const res = await api.post(
    '/spam/report',
    { uid: String(uid), verdict, raw },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return res.data
}

export const getUser = async () => {
  const token = storage.getToken()
  if (!token) return null
  try {
    const response = await api.get('/user/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    return response.data
  } catch {
    return null
  }
}

export const adminGetWaitlist = async () => {
  const token = storage.getToken()
  const response = await api.get('/admin/waitlist', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminApproveWaitlist = async (email) => {
  const token = storage.getToken()
  const response = await api.post(
    '/admin/waitlist/approve',
    { email },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const adminGetPending = async () => {
  const token = storage.getToken()
  const response = await api.get('/admin/pending', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminApprovePending = async (username) => {
  const token = storage.getToken()
  const response = await api.post(
    '/admin/pending/approve',
    { username },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const adminDenyPending = async (username) => {
  const token = storage.getToken()
  const response = await api.post(
    '/admin/pending/deny',
    { username },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

/**
 * What administrators have done. Admin-only on the server, and reading it is itself recorded
 * — which is why this is a POST: it is an action, not a page fetch.
 */
export const adminListAudit = async ({ offset = 0, limit = 50, target = '' } = {}) => {
  const token = storage.getToken()
  const response = await api.post(
    '/admin/audit',
    { offset, limit, ...(target ? { target } : {}) },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const adminGetUsers = async () => {
  const token = storage.getToken()
  const response = await api.get('/admin/users', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminCreateUser = async (username) => {
  const token = storage.getToken()
  const response = await api.post('/admin/users', { username }, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminDeleteUser = async (username) => {
  const token = storage.getToken()
  const response = await api.delete('/admin/users', {
    data: { username },
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminSetAdminStatus = async (username, isAdmin) => {
  const token = storage.getToken()
  const response = await api.post('/admin/users/admin', { username, is_admin: isAdmin }, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminSetCredentials = async (username, passwordHash, publicKey, encryptedPrivateKey) => {
  const token = storage.getToken()
  const response = await api.post('/admin/users/credentials', {
    username,
    password: passwordHash,
    public_key: publicKey,
    encrypted_private_key: encryptedPrivateKey,
  }, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const pgpPublishWkd = async (payload) => {
  const token = storage.getToken()
  const response = await api.post('/pgp/wkd/publish', payload, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const pgpWkdStatus = async () => {
  const token = storage.getToken()
  const response = await api.get('/pgp/wkd/status', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const userGetKey = async () => {
  const token = storage.getToken()
  const response = await api.post('/user/key', {}, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

// Publish the account's ML-DSA-65 verifying key. The server logs the hash into key
// transparency before storing the key, so a recipient can tie the two together.
export const userPublishSigKey = async (sigKey) => {
  const token = storage.getToken()
  const response = await api.post('/user/sigkey', { sig_key: sigKey }, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const userSigKey = async () => {
  const token = storage.getToken()
  const response = await api.get('/user/sigkey', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const userSetCredentials = async (passwordHash, publicKey, encryptedPrivateKey) => {
  const token = storage.getToken()
  const response = await api.post('/user/credentials', {
    password: passwordHash,
    public_key: publicKey,
    encrypted_private_key: encryptedPrivateKey,
  }, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

// Every uid in the mailbox, not the first page of it.
//
// /email/list is paginated (DEFAULT_PAGE 200) and this used to post a null body, so
// callers that treat the result as "the whole mailbox" — changing a password, exporting
// an archive — silently acted on at most 200 messages. A short list here is a data-loss
// bug, so it either pages to the end or throws; it never returns a plausible prefix.
export const emailListAll = async () => {
  const token = storage.getToken()
  const limit = 500
  const all = []
  for (let offset = 0; ; offset += limit) {
    const response = await api.post('/email/list', { limit, offset }, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const page = response.data?.uids ?? []
    all.push(...page)
    if (page.length < limit) return all
    if (offset > 200000) throw new Error('This mailbox is too large to page through here.')
  }
}

export const emailGetRaw = async (uid) => {
  const token = storage.getToken()
  const response = await api.post('/email/get', `{"uid":"${uid}"}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  return { data: response.data.data, message_key: response.data.message_key }
}

export const emailSetRaw = async (uid, data, messageKey) => {
  const token = storage.getToken()
  const bodyStr = messageKey
    ? `{"uid":"${uid}","data":"${data}","message_key":"${messageKey}"}`
    : `{"uid":"${uid}","data":"${data}"}`
  const response = await api.post('/email/set', bodyStr, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  return response.data
}

export default api
// Public: redeem a password-reset token mailed to a user's recovery address.
export const resetWithToken = async (token, credentials) => {
  const response = await api.post('/user/reset', { token, credentials })
  return response.data
}

export const adminSetRecoveryAddress = async (username, email) => {
  const token = storage.getToken()
  const response = await api.post('/admin/users/recovery-address', { username, email }, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminSendRecovery = async (username) => {
  const token = storage.getToken()
  const response = await api.post('/admin/users/send-recovery', { username }, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const userSetRecoveryKey = async (wrappedKey, kdfSalt, authProof) => {
  const token = storage.getToken()
  const response = await api.post('/user/recovery-key', {
    wrapped_key: wrappedKey, kdf_salt: kdfSalt, auth_proof: authProof,
  }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const userRecoveryKeyStatus = async () => {
  const token = storage.getToken()
  const response = await api.get('/user/recovery-key', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

// Public: the wrapped key, so a client holding the recovery secret can unwrap it.
export const userFetchRecoveryBlob = async (username) => {
  const response = await api.post('/user/recovery-key/blob', { username })
  return response.data
}

export const userRestoreWithRecoveryKey = async (payload) => {
  const response = await api.post('/user/recovery-key/restore', payload)
  return response.data
}

/* ---------------------------------------------------- two-factor auth --- */

export const userTwoFactorStatus = async () => {
  const token = storage.getToken()
  const response = await api.get('/user/2fa', { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const userTwoFactorStart = async () => {
  const token = storage.getToken()
  const response = await api.post('/user/2fa/start', {}, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const userTwoFactorConfirm = async (code) => {
  const token = storage.getToken()
  const response = await api.post('/user/2fa/confirm', { code }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const userTwoFactorDisable = async (code) => {
  const token = storage.getToken()
  const response = await api.post('/user/2fa/disable', { code }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

// Public: redeems the login challenge issued after the password step.
export const loginSecondFactor = async (challenge, code) => {
  const response = await api.post('/auth/login/2fa', { challenge, code })
  return response.data
}

/* ------------------------------------------------- security keys --- */

// Public: the challenge the key will sign, for a login already past the password.
export const loginSecurityKeyBegin = async (challenge) => {
  const response = await api.post('/auth/login/webauthn/begin', { challenge })
  return response.data
}

// Public: an assertion, verified server-side before any token is minted.
export const loginSecurityKeyFinish = async (challenge, challengeId, assertion) => {
  const response = await api.post('/auth/login/webauthn/finish', {
    challenge,
    challenge_id: challengeId,
    ...assertion,
  })
  return response.data
}

export const userSecurityKeys = async () => {
  const token = storage.getToken()
  const response = await api.get('/user/webauthn', { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

// Adding a key needs a fresh code, so a stolen session cannot enrol its own.
export const userSecurityKeyRegisterBegin = async (code) => {
  const token = storage.getToken()
  const response = await api.post('/user/webauthn/register/begin', { code }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const userSecurityKeyRegisterFinish = async (payload) => {
  const token = storage.getToken()
  const response = await api.post('/user/webauthn/register/finish', payload, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const userSecurityKeyRemove = async (id, code) => {
  const token = storage.getToken()
  const response = await api.post('/user/webauthn/remove', { id, code }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

/* --------------------------------------------------- active sessions --- */

export const userSessions = async () => {
  const token = storage.getToken()
  const response = await api.get('/user/sessions', { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

// Messages held for a chosen time: what is waiting, and taking one back.
export const listScheduled = async () => {
  const token = storage.getToken()
  const response = await api.get('/scheduled', { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const cancelScheduled = async (id) => {
  const token = storage.getToken()
  const response = await api.post('/scheduled/cancel', { id }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

// Disposable addresses: mail to one lands in this mailbox, and switching it off
// stops it working for the sender.
// New-mail notifications. The key is public, but everything else belongs to the
// signed-in account, and this file is where the token is attached.
export const pushKey = async () => {
  const response = await api.get('/push/key')
  return response.data
}

export const pushStatus = async () => {
  const token = storage.getToken()
  const response = await api.get('/push/status', { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const pushSubscribe = async ({ endpoint, key, auth, ua }) => {
  const token = storage.getToken()
  const response = await api.post(
    '/push/subscribe',
    { endpoint, keys: { p256dh: key, auth }, ua },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const pushUnsubscribe = async (endpoint) => {
  const token = storage.getToken()
  const response = await api.post(
    '/push/unsubscribe',
    { endpoint },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const pushTest = async () => {
  const token = storage.getToken()
  const response = await api.post('/push/test', {}, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const listAliases = async () => {
  const token = storage.getToken()
  const response = await api.get('/aliases', { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const createAlias = async ({ local = '', label = '' } = {}) => {
  const token = storage.getToken()
  const response = await api.post('/aliases', { local, label }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const setAliasDisabled = async (local, disabled) => {
  const token = storage.getToken()
  const response = await api.post('/aliases/disable', { local, disabled }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const deleteAlias = async (local) => {
  const token = storage.getToken()
  const response = await api.post('/aliases/delete', { local }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

// Messages put away until a time you chose. The server leaves a snoozed message
// out of every other folder, so this list is the only place it appears — and a
// reload is not what brings it back, the clock is.
export const listSnoozed = async () => {
  const token = storage.getToken()
  const response = await api.post('/email/snoozed', {}, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const snoozeEmail = async (uid, until) => {
  const token = storage.getToken()
  const response = await api.post('/email/snooze', { uid, until }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const unsnoozeEmail = async (uid) => {
  const token = storage.getToken()
  const response = await api.post('/email/unsnooze', { uid }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

// Named mailboxes: a set of the account's own address and aliases, read together.
// The server decides what the caller may put in one, and says so with its own
// error rather than letting the client guess.
export const listMailboxes = async () => {
  const token = storage.getToken()
  const response = await api.get('/mailboxes', { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const saveMailbox = async (name, addresses) => {
  const token = storage.getToken()
  const response = await api.post('/mailboxes', { name, addresses }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const deleteMailbox = async (name) => {
  const token = storage.getToken()
  const response = await api.post('/mailboxes/delete', { name }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

// Switching an account off is a reversible deny: the mail stays, sign-in stops.
export const adminSetSuspended = async (username, suspended, reason = '') => {
  const token = storage.getToken()
  const response = await api.post(
    '/admin/users/suspend',
    { username, suspended, reason },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const userRevokeSession = async (id) => {
  const token = storage.getToken()
  const response = await api.post('/user/sessions/revoke', { id }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const userRevokeAllSessions = async () => {
  const token = storage.getToken()
  const response = await api.post('/user/sessions/revoke-all', {}, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

// Close your own account. The server verifies the password token and removes
// the mailbox, its mail, recovery record, second factor and sessions.
export const userDeleteAccount = async (passwordToken) => {
  const token = storage.getToken()
  const response = await api.post(
    '/user/delete-account',
    { password: passwordToken },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

// What Postfix is actually told to accept, and how much space each mailbox takes.
// Both are read-only views of server state — no new capability.
export const adminGetRecipients = async () => {
  const token = storage.getToken()
  const response = await api.get('/admin/recipients', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminGetDiskUsage = async () => {
  const token = storage.getToken()
  const response = await api.get('/admin/disk-usage', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

// One RFC 822 message, base64, with the date the message itself carries. The
// server encrypts it to the account key exactly as SMTP delivery would.
export const importMessage = async (raw, dateUnix) => {
  const { data } = await api.post(
    '/import/message',
    { raw, date_unix: dateUnix ?? null },
    { headers: { Authorization: `Bearer ${storage.getToken()}` } },
  )
  return data
}
