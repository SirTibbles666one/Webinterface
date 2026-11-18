import { describe, it, expect } from 'vitest'
import { signatureState, candidateRecipients, findSigKey, bareAddress } from '@/lib/verifyMessage'
import { signEnvelope, toB64 } from '@/lib/msgSign'
import { generateSigKeyPair, signBytes } from '@/lib/sigKey'

const payload = new Uint8Array([...new Uint8Array(12).fill(1), ...new Uint8Array(16).fill(2)])
const SENDER = 'ines@northwind.studio'
const ME = 'qa@slothlee.xyz'

const signedFor = (recipient, sender = SENDER) => {
  const keys = generateSigKeyPair()
  const envelope = signEnvelope({
    payload, privateKey: keys.secretKey, sign: signBytes, recipient, sender, sentAt: 1_700_000_000,
  })
  return { b64: toB64(envelope), publicKey: toB64(keys.publicKey) }
}

const parsedFor = (to) => ({ from: { name: 'Ines', email: SENDER }, to, cc: [] })
const keysReturning = (sigKey) => async () => ({ keys: { [SENDER]: { address: SENDER, sig_key: sigKey } } })

describe('what the reader may claim', () => {
  it('verifies a signature made for this mailbox', async () => {
    const { b64, publicKey } = signedFor(ME)
    const state = await signatureState({
      payloadB64: b64, parsed: parsedFor([ME]), deliveredTo: ME, username: 'qa', fetchKeys: keysReturning(publicKey),
    })
    expect(state).toBe('verified')
  })

  it('says unsigned when the sender has published no key', async () => {
    const { b64 } = signedFor(ME)
    const state = await signatureState({
      payloadB64: b64, parsed: parsedFor([ME]), deliveredTo: ME, username: 'qa', fetchKeys: async () => ({ keys: {} }),
    })
    expect(state).toBe('unsigned')
  })

  it('says unsigned for a message with no envelope at all', async () => {
    const state = await signatureState({
      payloadB64: toB64(payload), parsed: parsedFor([ME]), deliveredTo: ME, username: 'qa', fetchKeys: keysReturning('x'),
    })
    expect(state).toBe('unsigned')
  })

  it('says invalid when the signature was made for someone else', async () => {
    const { b64, publicKey } = signedFor('someone@else.example')
    const state = await signatureState({
      payloadB64: b64, parsed: parsedFor([ME]), deliveredTo: ME, username: 'qa', fetchKeys: keysReturning(publicKey),
    })
    expect(state).toBe('invalid')
  })

  it('says invalid when the key does not match the signature', async () => {
    const { b64 } = signedFor(ME)
    const other = generateSigKeyPair()
    const state = await signatureState({
      payloadB64: b64, parsed: parsedFor([ME]), deliveredTo: ME, username: 'qa', fetchKeys: keysReturning(toB64(other.publicKey)),
    })
    expect(state).toBe('invalid')
  })

  it('a BCC-style delivery still verifies: the reader only needs its own address', async () => {
    const { b64, publicKey } = signedFor(ME)
    const state = await signatureState({
      payloadB64: b64,
      parsed: parsedFor(['someone-else@example.com']), // the recipient is not in To
      deliveredTo: ME,
      username: 'qa',
      fetchKeys: keysReturning(publicKey),
    })
    expect(state).toBe('verified')
  })
})

describe('address handling', () => {
  it('only considers the reader\'s own addresses', () => {
    const candidates = candidateRecipients({
      parsed: { to: ['Other <other@example.com>', 'QA <qa@slothlee.xyz>'], cc: ['qa@elsewhere.example'] },
      deliveredTo: 'qa+tag@slothlee.xyz',
      username: 'qa',
    })
    expect(candidates.sort()).toEqual(['qa@elsewhere.example', 'qa@slothlee.xyz'])
  })

  it('strips display names and case', () => {
    expect(bareAddress('Ines Novak <Ines@Northwind.Studio>')).toBe('ines@northwind.studio')
    expect(bareAddress('ines@northwind.studio')).toBe('ines@northwind.studio')
  })

  it('finds a sig key in a keyed map or a list, without knowing the shape', () => {
    expect(findSigKey({ keys: { [SENDER]: { sig_key: 'k'.repeat(120) } } }, SENDER)).toBeTruthy()
    expect(findSigKey({ recipients: [{ address: SENDER, sig_key: 'k'.repeat(120) }] }, SENDER)).toBeTruthy()
    expect(findSigKey({ recipients: [{ address: 'x@y.z', sig_key: 'k'.repeat(120) }] }, SENDER)).toBeNull()
  })
})
