import { describe, it, expect } from 'vitest'
import {
  generateKeyPair,
  exportPublicKeyBase64,
  generatePqKeyPair,
  sealHybridPayload,
  decryptEmailBytes,
} from '@/crypto'

// The chain behind "I unlocked it and everything still says (encrypted)":
// a hybrid-sealed message cannot be opened without the post-quantum secret, and the failure
// carries a code of its own. The compose-or-read path turns that code into "unlock to read";
// without the code it renders as encryption, which is what made a working mailbox look locked.
const b64 = (u8) => Buffer.from(u8).toString('base64')
const plain = new TextEncoder().encode('MESSAGE FROM: Ines <ines@northwind.studio>\n\nQuarter close.\n')

describe('a hybrid-sealed message', () => {
  it('is unreadable without the post-quantum secret, and says why', async () => {
    const rsa = await generateKeyPair()
    const rsaPub = await exportPublicKeyBase64(rsa.publicKey)
    const pq = generatePqKeyPair()
    const sealed = await sealHybridPayload(plain, rsaPub, b64(pq.publicKey), 'qa')

    await expect(
      decryptEmailBytes(sealed.data, sealed.messageKey, rsa.privateKey, null, 'qa'),
    ).rejects.toMatchObject({ code: 'pq_key_missing' })
  })

  it('opens with the secret that sign-in and unlock now both load', async () => {
    const rsa = await generateKeyPair()
    const rsaPub = await exportPublicKeyBase64(rsa.publicKey)
    const pq = generatePqKeyPair()
    const sealed = await sealHybridPayload(plain, rsaPub, b64(pq.publicKey), 'qa')

    const out = await decryptEmailBytes(
      sealed.data,
      sealed.messageKey,
      rsa.privateKey,
      b64(pq.secretKey),
      'qa',
    )
    expect(new TextDecoder().decode(out)).toContain('Quarter close.')
  })

  it('does not open with a different post-quantum key', async () => {
    const rsa = await generateKeyPair()
    const rsaPub = await exportPublicKeyBase64(rsa.publicKey)
    const pq = generatePqKeyPair()
    const other = generatePqKeyPair()
    const sealed = await sealHybridPayload(plain, rsaPub, b64(pq.publicKey), 'qa')

    await expect(
      decryptEmailBytes(sealed.data, sealed.messageKey, rsa.privateKey, b64(other.secretKey), 'qa'),
    ).rejects.toThrow()
  })
})
