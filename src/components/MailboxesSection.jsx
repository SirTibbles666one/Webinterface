import { useCallback, useEffect, useState } from 'react'
import { FolderPlus, Trash2 } from 'lucide-react'
import { listMailboxes, saveMailbox, deleteMailbox } from '@/api'
import { toast } from '@/lib/toast'

/**
 * Named sets of the account's own addresses.
 *
 * A mailbox here is not another place mail can land — every address already
 * delivers to this account. It is a name over a few of them, so the inbox can be
 * read one group at a time. Nothing is moved or deleted by making one, and
 * removing it puts its messages back where they were.
 */
export function MailboxesSection() {
  const [rows, setRows] = useState([])
  const [addresses, setAddresses] = useState([])
  const [limit, setLimit] = useState(8)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const data = await listMailboxes()
      setRows(data?.mailboxes ?? [])
      setAddresses(data?.addresses ?? [])
      setLimit(data?.max ?? 8)
      setError('')
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not read your mailboxes')
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // An address sits in one mailbox at most, so the ones already spoken for are
  // shown but cannot be picked. The server enforces this too; the set is only so
  // the checkbox does not offer something that will be refused.
  const taken = new Set(rows.flatMap((row) => row.addresses ?? []))

  const toggle = (address) => {
    setPicked((cur) => (cur.includes(address) ? cur.filter((a) => a !== address) : [...cur, address]))
  }

  const save = async () => {
    const wanted = name.trim()
    if (!wanted) return
    setBusy(true)
    setError('')
    try {
      await saveMailbox(wanted, picked)
      setName('')
      setPicked([])
      await refresh()
      toast(`Saved ${wanted}`)
    } catch (err) {
      setError(err.response?.data?.error ?? 'That mailbox could not be saved')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (which) => {
    setBusy(true)
    setError('')
    try {
      await deleteMailbox(which)
      await refresh()
    } catch (err) {
      setError(err.response?.data?.error ?? 'That mailbox could not be removed')
    } finally {
      setBusy(false)
    }
  }

  const full = rows.length >= limit

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        A mailbox is a name for a set of your addresses — Work, Shop, whatever you like. It appears above
        the folders so you can read one at a time, and it follows you onto every device. Mail is never moved
        or deleted by this: removing a mailbox puts its messages back where they were.
      </p>

      {error && (
        <p className="rounded-lg border border-destructive/40 px-3 py-2 text-[12px] text-destructive">
          {error}
        </p>
      )}

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.name}
              className="flex items-start justify-between gap-3 rounded-xl border border-line px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink-1">{row.name}</p>
                <p className="mono mt-0.5 truncate text-[11px] text-ink-3">
                  {(row.addresses ?? []).length > 0 ? row.addresses.join(', ') : 'no addresses yet'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(row.name)}
                disabled={busy}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-destructive/30 text-destructive transition-colors duration-120 active:bg-destructive/10 disabled:opacity-45 sm:min-h-9 sm:min-w-9"
                aria-label={`Remove ${row.name}`}
                title={`Remove ${row.name}`}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-xl border border-line p-3">
        <p className="flex items-center gap-2 text-[12px] text-ink-2">
          <FolderPlus className="size-4 text-ink-3" /> New mailbox
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Work"
          maxLength={32}
          disabled={full || busy}
          className="mt-2 h-11 w-full rounded-lg border border-line bg-transparent px-3 text-[13px] text-ink-1 placeholder:text-ink-4 focus:border-primary focus:outline-none sm:h-9"
        />
        <div className="mt-3 space-y-1">
          {addresses.length === 0 && (
            <p className="text-[11.5px] text-ink-4">Add an address first — your own is not enough on its own.</p>
          )}
          {addresses.map((address) => {
            const elsewhere = taken.has(address)
            return (
              <label
                key={address}
                className={`flex min-h-[44px] items-center gap-2.5 rounded-lg px-1 text-[12.5px] sm:min-h-9 ${
                  elsewhere ? 'text-ink-4' : 'text-ink-2'
                }`}
              >
                <input
                  type="checkbox"
                  checked={picked.includes(address)}
                  disabled={elsewhere || busy || full}
                  onChange={() => toggle(address)}
                  className="size-4 accent-current"
                />
                <span className="mono truncate">{address}</span>
                {elsewhere && <span className="ml-auto text-[11px]">in another mailbox</span>}
              </label>
            )
          })}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={busy || full || !name.trim()}
          className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground transition-colors duration-120 disabled:opacity-45 sm:min-h-9"
        >
          {full ? `That is all ${limit}` : busy ? 'Saving…' : 'Save mailbox'}
        </button>
      </div>
    </div>
  )
}

export default MailboxesSection
