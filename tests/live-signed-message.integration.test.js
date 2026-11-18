import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { encryptEmail, decryptEmail } from '@/crypto'
import { signEnvelope, verifyEnvelope, unpack, toB64, fromB64 } from '@/lib/msgSign'
import { generateSigKeyPair, signBytes, verifyBytes } from '@/lib/sigKey'

// End-to-end: create an account whose keys this test controls, seal and SIGN a message
// with the app's own code, send it through the live API, read it back, and verify it the
// way the reader will. Then tamper with it and prove the verifier refuses.
//
// Network goes through curl deliberately: the test DOM enforces CORS, and this is the one
// place that has to talk to production. OFF unless LIVE_SIG=1.
const live = process.env.LIVE_SIG === '1'
const BASE = 'https://mail.slothlee.xyz'
const ADMIN = () => fs.readFileSync('/data/cache/scratch/mailrecon/adm.tok', 'utf8').trim()

const call = (path, { method = 'POST', body, token } = {}) => {
  const args = ['-s', '-X', method, BASE + path, '-H', 'Content-Type: application/json']
  if (token) args.push('-H', `Authorization: Bearer ${token}`)
  if (body !== undefined) args.push('--data-binary', JSON.stringify(body))
  const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  // Server uids are u128 emitted as JSON numbers; JSON.parse turns them into floats and
  // destroys the low digits (1.478e+38). The client patches this the same way, and the
  // fact that it has to is worth knowing.
  const safe = out.replace(/([:[,]\s*)(\d{16,})/g, '$1"$2"')
  try {
    return JSON.parse(safe)
  } catch {
    return { raw: out }
  }
}

describe.skipIf(!live)('a signed message, end to end', () => {
  it('is verified on arrival and refused once tampered', async () => {
    const USER = 'zzsig' + String(Date.now()).slice(-6)
    const created = call('/api/admin/users', { body: { username: USER }, token: ADMIN() })
    expect(created.message || created.setup_token).toBeTruthy()

    // First login with the one-time setup token, then complete setup through the real
    // endpoint so key transparency records the account.
    const first = call('/api/auth/login', { body: { username: USER, password: created.setup_token } })
    expect(first.token).toBeTruthy()

    const pair = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt'],
    )
    const spki = Buffer.from(await crypto.subtle.exportKey('spki', pair.publicKey)).toString('base64')
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    const { bcrypt } = await import('/data/workspace/Webinterface/node_modules/hash-wasm')
    const AUTH_SALT = Uint8Array.from(Buffer.from('OpenNeutronAuth1', 'ascii'))
    const password = 'sig-' + Date.now()
    const hash = await bcrypt({ password: new TextEncoder().encode(password), salt: AUTH_SALT, costFactor: 10, outputType: 'encoded' })

    const setup = call('/api/user/setup', {
      body: { password: hash, public_key: spki, encrypted_private_key: 'wrapped-in-test' },
      token: first.token,
    })
    expect(setup.code === undefined || setup.code === null).toBe(true)

    // Publish the signing key, then sign in with the hash (what the client sends).
    const sigPair = generateSigKeyPair()
    const published = call('/api/user/sigkey', { body: { sig_key: toB64(sigPair.publicKey) }, token: first.token })
    expect(published.message || published.sig_key).toBeTruthy()

    const session = call('/api/auth/login', { body: { username: USER, password: hash } })
    expect(session.token).toBeTruthy()
    const me = `${USER}@slothlee.xyz`

    // Compose and seal exactly as the composer does.
    const raw = [
      `From: ${me}`, `To: ${me}`, 'Subject: Signed envelope probe',
      'Date: ' + new Date().toUTCString(), 'Message-ID: <sig-' + Date.now() + '@slothlee.xyz>',
      'Content-Type: text/plain; charset=utf-8', '', 'A signed message body.',
    ].join('\r\n')
    const sealed = await encryptEmail(raw, pair.publicKey)
    const sentAt = Math.floor(Date.now() / 1000)

    const signed = signEnvelope({
      payload: fromB64(sealed.data_encrypted),
      privateKey: sigPair.secretKey,
      sign: signBytes,
      recipient: me,
      sender: me,
      sentAt,
    })

    const send = call('/api/email/sendencrypted', {
      token: session.token,
      body: {
        localcopy: {
          to: [me], timestamp: sentAt, public_key_hash: 'test',
          raw_data: sealed.data_encrypted, message_key: sealed.aes_encrypted,
        },
        recipients: { [me]: { aes_encrypted: sealed.aes_encrypted, data_encrypted: toB64(signed), e2ee: true } },
        subject: 'Signed envelope probe',
      },
    })
    expect(send.code === undefined || send.code === null).toBe(true)

    await new Promise((r) => setTimeout(r, 2500))
    const list = call('/api/email/list', { token: session.token, body: { limit: 5, offset: 0 } })
    expect(list.uids?.length).toBeGreaterThan(0)
    const got = call('/api/email/get', { token: session.token, body: { uid: list.uids[0] } })
    if (!got.data) throw new Error('no data in get: ' + JSON.stringify(got).slice(0, 200))
    const payload = fromB64(got.data)

    // 1) as sent: verified
    const state = verifyEnvelope({
      payload, publicKey: sigPair.publicKey, verify: verifyBytes,
      recipient: me, sender: me, sentAt,
    })
    expect(state).toBe('verified')

    // 2) the body still decrypts underneath the envelope
    const opened = await decryptEmail(toB64(unpack(payload).payload), got.message_key, pair.privateKey, null, USER)
    expect(opened).toContain('A signed message body.')

    // 3) tampered: a single flipped ciphertext byte is refused
    const tampered = new Uint8Array(payload)
    tampered[20] ^= 0xff
    expect(verifyEnvelope({
      payload: tampered, publicKey: sigPair.publicKey, verify: verifyBytes,
      recipient: me, sender: me, sentAt,
    })).toBe('invalid')

    // 4) re-attributed to another sender: refused
    expect(verifyEnvelope({
      payload, publicKey: sigPair.publicKey, verify: verifyBytes,
      recipient: me, sender: 'someone@else.example', sentAt,
    })).toBe('invalid')

    fs.writeFileSync('/tmp/sig-e2e-user.txt', USER)
    console.log('E2E user:', USER, '| state:', state)
    return undefined
  }, 120000)
})
