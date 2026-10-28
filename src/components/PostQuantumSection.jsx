import { useEffect, useState } from 'react'
import { Check, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { keySession } from '@/keySession'
import { enablePostQuantum, fetchPostQuantumStatus } from '@/lib/pqSetup'
import { toast } from '@/lib/toast'

/**
 * Post-quantum protection, stated as what it is.
 *
 * Mail is sealed to the account key with RSA today; RSA is what a quantum
 * computer breaks outright, and mail is the data someone harvests now to read
 * later. Turning this on adds an ML-KEM-768 half to every new message, so
 * opening one needs both keys.
 *
 * Two things this panel refuses to blur: messages stored before the switch stay
 * RSA-only (they would have to be decrypted and re-sealed one by one), and the
 * key itself is wrapped with the account password, so enabling it needs that
 * password once — in the browser, never sent anywhere.
 */
export default function PostQuantumSection() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetchPostQuantumStatus()
      .then((s) => { if (alive) setStatus(s) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const enable = async (e) => {
    e.preventDefault()
    setError('')
    if (!password) { setError('Enter your password to protect the new key with it'); return }
    setBusy(true)
    try {
      await enablePostQuantum(password, keySession.getSalt())
      setStatus(await fetchPostQuantumStatus())
      setPassword('')
      toast('Post-quantum protection is on for new mail')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'That could not be enabled')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
        <Loader2 className="size-3.5 animate-spin" /> Checking…
      </div>
    )
  }

  const on = !!status?.enabled

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        {on ? (
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
        ) : (
          <KeyRound className="mt-0.5 size-3.5 shrink-0 text-sand" />
        )}
        <div className="min-w-0">
          <p className="text-[12.5px] text-ink-1">
            {on ? 'On — ML-KEM-768' : 'Not enabled'}
          </p>
          <p className="mt-0.5 max-w-[62ch] text-[11.5px] leading-relaxed text-ink-3">
            {on
              ? 'New mail is sealed with an RSA key and a post-quantum key together: opening it needs both, so breaking one leaves the message closed. Mail stored before you switched stays sealed with RSA alone — that cannot be changed after the fact.'
              : 'Mail is sealed with RSA only. RSA is the part a quantum computer breaks, and stored mail is exactly what gets harvested today to read later. Turning this on adds a post-quantum half to every new message.'}
          </p>
        </div>
      </div>

      {!on && (
        <form onSubmit={enable} className="space-y-2">
          <label htmlFor="pq-password" className="label">
            Account password
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="pq-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Used once, here, to wrap the new key"
              autoComplete="current-password"
              className="max-w-[260px] max-sm:min-h-[44px]"
            />
            <Button type="submit" disabled={busy} className="gap-2 max-sm:min-h-[44px]">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {busy ? 'Creating…' : 'Turn on'}
            </Button>
          </div>
          <p className="text-[11px] text-ink-4">
            The key is wrapped with your password in this browser before it is stored. The server
            never sees the password or the unwrapped key.
          </p>
          {error && <p className="text-[11.5px] text-destructive">{error}</p>}
        </form>
      )}
    </div>
  )
}
