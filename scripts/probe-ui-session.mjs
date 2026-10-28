/**
 * Bring up a throwaway account whose keys exist, so the UI can be driven in a
 * real signed-in session without anyone typing a password into a form.
 *
 * Prints the token and the account name; the browser probe injects them into
 * localStorage. Delete the account afterwards with the admin API.
 *
 *   node scripts/probe-ui-session.mjs [username]
 */
import fs from 'node:fs'
import { hashPassword, generateKeyPair, exportPublicKeyBase64, encryptPrivateKey } from '../src/lib/probeCrypto.mjs'

const BASE = 'https://mail.slothlee.xyz/api'
const USER = (process.argv[2] || 'uipq').toLowerCase()
const password = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
const adminToken = fs.readFileSync('/tmp/admin.jwt', 'utf8').trim()

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = {}
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 120) } }
  return { status: res.status, json }
}

async function main() {
  await call('DELETE', '/admin/users', { username: USER }, adminToken)
  const created = await call('POST', '/admin/users', { username: USER }, adminToken)
  if (![200, 201].includes(created.status)) throw new Error(`create failed ${created.status}`)

  const passwordHash = await hashPassword(password)
  const creds = await call('POST', '/admin/users/credentials', { username: USER, password: passwordHash }, adminToken)
  if (creds.status !== 200) throw new Error(`credentials failed ${creds.status}`)

  const login = await call('POST', '/auth/login', { username: USER, password: passwordHash })
  if (login.status !== 200 || !login.json.token) throw new Error(`login failed ${login.status}`)
  const token = login.json.token
  const salt = login.json.salt || login.json.server_salt

  const rsa = await generateKeyPair()
  const publicKeyB64 = await exportPublicKeyBase64(rsa.publicKey)
  const encryptedKey = await encryptPrivateKey(rsa.privateKey, password, salt)
  const setup = await call('POST', '/user/setup',
    { password: passwordHash, public_key: publicKeyB64, encrypted_private_key: encryptedKey }, token)
  if (setup.status !== 200) throw new Error(`setup failed ${setup.status} ${JSON.stringify(setup.json)}`)

  fs.writeFileSync('/tmp/ui-probe.json', JSON.stringify({ username: USER, token, salt }), { mode: 0o600 })
  console.log(JSON.stringify({ username: USER, ready: true, tokenWritten: '/tmp/ui-probe.json' }))
}

main().catch((err) => { console.error(err.message); process.exit(1) })
