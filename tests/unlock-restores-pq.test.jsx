import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// The bug this pins: unlocking restored the RSA key and stopped there, so on a post-quantum
// account every message sealed with the hybrid envelope failed with `pq_key_missing` and the
// inbox read "(encrypted)" while the mailbox was, in fact, unlocked. Sign-in loaded the PQ key;
// unlocking did not.
const loadPostQuantumKey = vi.fn(async () => true)
vi.mock('@/lib/pqSetup', () => ({ loadPostQuantumKey: (...args) => loadPostQuantumKey(...args) }))
vi.mock('@/lib/keyRecovery', () => ({ ensureStoredKey: vi.fn(async () => {}) }))
vi.mock('@/crypto', () => ({ decryptPrivateKey: vi.fn(async () => ({ fake: 'key' })) }))

const set = vi.fn(async () => {})
vi.mock('@/keySession', () => ({
  keySession: {
    set: (...a) => set(...a),
    getSalt: () => 'salt-value',
  },
}))

vi.mock('@/storage', () => ({
  storage: {
    getEncryptedKey: () => 'encrypted-key-blob',
    getLoginSalt: () => 'salt-value',
  },
}))

import { UnlockModal } from '@/components/UnlockModal'

describe('unlocking a mailbox', () => {
  beforeEach(() => {
    loadPostQuantumKey.mockClear()
    set.mockClear()
  })

  it('loads the post-quantum half as well as the private key', async () => {
    const onUnlocked = vi.fn()
    render(<UnlockModal isOpen onUnlocked={onUnlocked} />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } })
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }))

    await waitFor(() => expect(onUnlocked).toHaveBeenCalled())

    expect(set).toHaveBeenCalled()
    expect(loadPostQuantumKey).toHaveBeenCalledTimes(1)
    // the same password and salt the private key was unwrapped with
    expect(loadPostQuantumKey).toHaveBeenCalledWith('correct horse', 'salt-value')
  })

  it('still unlocks when the account has no post-quantum key', async () => {
    loadPostQuantumKey.mockResolvedValueOnce(false)
    const onUnlocked = vi.fn()
    render(<UnlockModal isOpen onUnlocked={onUnlocked} />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }))

    await waitFor(() => expect(onUnlocked).toHaveBeenCalled())
  })
})
