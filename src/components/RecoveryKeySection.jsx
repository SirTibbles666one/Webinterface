import { useEffect, useState } from 'react'
import { KeyRound, ShieldCheck, ShieldAlert } from 'lucide-react'
import RecoveryKeySetup from '@/components/RecoveryKeySetup'
import { userRecoveryKeyStatus } from '@/api'
import { keySession } from '@/keySession'
import { storage } from '@/storage'

const when = (seconds) => (seconds ? new Date(seconds * 1000).toLocaleString() : null)

/**
 * "Recovery key" section for settings, available to any signed-in user.
 *
 * Without this, a recovery key could only be created during first-time setup -
 * so every account that already existed had no way to get one.
 */
export default function RecoveryKeySection() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [privateKey, setPrivateKey] = useState(null)

  const refresh = async () => {
    try {
      const data = await userRecoveryKeyStatus()
      setStatus(data)
      setError('')
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not read recovery key status')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const start = async () => {
    const key = await keySession.get()
    if (!key) {
      setError('Unlock your mailbox first — the recovery key has to wrap your private key.')
      return
    }
    setPrivateKey(key)
    setCreating(true)
  }

  return (
    <section className="rounded-xl bg-background/50 p-3">
      <div className="flex items-center gap-2">
        <KeyRound className="w-3.5 h-3.5 text-primary" />
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-2">Recovery key</h3>
      </div>

      {status === null && !error && <p className="mt-2 text-xs text-ink-3">Checking…</p>}

      {status && (
        <div className="mt-2 space-y-2">
          {status.set ? (
            <p className="flex items-start gap-1.5 text-xs text-green-400">
              <ShieldCheck className="mt-0.5 w-3.5 h-3.5 shrink-0" />
              <span>
                Set {when(status.set_at)}. {status.used_at > 0 && `Last used ${when(status.used_at)} — create a new one.`}
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-amber-400">
              <ShieldAlert className="mt-0.5 w-3.5 h-3.5 shrink-0" />
              <span>
                No recovery key. If you forget your password, your encrypted mail cannot be recovered.
              </span>
            </p>
          )}

          <button
            onClick={start}
            className="w-full rounded-lg border border-line-strong px-3 py-2 text-xs hover:bg-foreground/5"
          >
            {status.set ? 'Replace recovery key' : 'Create recovery key'}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {creating && privateKey && (
        <RecoveryKeySetup
          privateKey={privateKey}
          username={storage.getUsername()}
          onDone={() => {
            setCreating(false)
            setPrivateKey(null)
            refresh()
          }}
        />
      )}
    </section>
  )
}
