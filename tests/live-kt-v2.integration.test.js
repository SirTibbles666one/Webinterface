import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { verifyProof, isPinnedSigner, verifyHeadSignature } from '@/kt'

// Integration check, off by default: verifies a REAL proof from the live server against
// the client's own leaf hashing. This is the one thing unit tests cannot prove — that the
// server's v2 leaf encoding and the client's agree. Run with LIVE_KT=1.
const live = process.env.LIVE_KT === '1'

describe.skipIf(!live)('live key transparency', () => {
  it('a v2 leaf folds to the signed head and the signer is pinned', async () => {
    // Fetched outside the test (the test DOM enforces CORS); this proves the CLIENT's
    // hashing against a real server leaf, which is the part unit tests cannot reach.
    const file = process.env.KT_PROOF_FILE || '/tmp/kt-proof.json'
    const proof = JSON.parse(fs.readFileSync(file, 'utf8'))
    console.log('proof keys:', Object.keys(proof), '| leaf keys:', Object.keys(proof.leaf ?? {}))

    // The published signing key must be witnessed by the leaf.
    expect(proof.leaf.sig).toBeTruthy()

    const result = verifyProof(proof)
    console.log('verifyProof:', JSON.stringify(result))
    expect(result.ok).toBe(true)

    expect(isPinnedSigner(proof.head)).toBe(true)
    expect(verifyHeadSignature(proof.head)).toBe(true)
  })
})
