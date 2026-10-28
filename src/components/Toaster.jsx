import { useEffect, useState } from 'react'
import { subscribeToasts, dismissToast } from '@/lib/toast'

/**
 * Bottom centre, above the safe area, one line each. Nothing here is a dialog:
 * a toast is for something that already worked, never for a decision.
 */
export default function Toaster() {
  const [items, setItems] = useState([])
  useEffect(() => subscribeToasts(setItems), [])

  if (items.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4"
      style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}
      role="status"
      aria-live="polite"
    >
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => dismissToast(item.id)}
          className="toast-in pointer-events-auto max-w-[92vw] rounded-lg border border-line-strong bg-card/95 px-3.5 py-2 text-left text-[12.5px] text-ink-1 shadow-[0_10px_30px_rgba(0,0,0,.45)] backdrop-blur-sm transition-colors duration-120 hover:border-primary/40 sm:max-w-md"
        >
          {item.message}
        </button>
      ))}
    </div>
  )
}
