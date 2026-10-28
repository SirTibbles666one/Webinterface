import { useState } from 'react'
import { ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react'

/**
 * Several setup gaps, one strip.
 *
 * These used to stack — a full banner per missing key — which pushed the mail
 * down and made two warnings compete. One line states the count, the expand says
 * what each one costs, and the row is sand because this is attention, not danger.
 */
export default function SetupStrip({ items, onOpen, onDismiss }) {
  const [open, setOpen] = useState(false)
  if (!items || items.length === 0) return null

  return (
    <div className="border-b border-line">
      <div className="mx-auto flex w-full max-w-[1040px] items-center gap-2 px-4 py-1.5 max-sm:min-h-[36px]">
        <ShieldAlert className="size-3.5 shrink-0 text-sand" aria-hidden="true" />

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1.5 text-left text-[12px] text-ink-2 hover:text-ink-1"
        >
          {open ? <ChevronDown className="size-3.5 text-ink-3" /> : <ChevronRight className="size-3.5 text-ink-3" />}
          <span className="truncate">
            {items.length === 1 ? 'One thing not set up yet' : `${items.length} things not set up yet`}
            <span className="text-ink-3"> — {items.map((i) => i.label).join(', ')}</span>
          </span>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onOpen}
            className="rounded-md px-2 py-1 text-[11.5px] font-medium text-sand transition-colors duration-120 hover:bg-sand/10 max-sm:min-h-[34px] max-sm:px-2.5"
          >
            Set up
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="rounded p-1 text-ink-3 transition-colors duration-120 hover:text-ink-1"
          >
            ×
          </button>
        </div>
      </div>

      {open && (
        <ul className="animate-rise space-y-1.5 px-4 pb-3 pl-10">
          {items.map((item) => (
            <li key={item.id} className="text-[12px] leading-relaxed text-ink-2">
              <span className="font-medium text-ink-1">{item.label}.</span> {item.note}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
