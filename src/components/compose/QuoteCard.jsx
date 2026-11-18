import { useState } from 'react'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { ChevronDown } from 'lucide-react'

/**
 * A reply's quote, as a closed card.
 *
 * The body of a reply carries the whole thread, so before this the composer either showed all
 * of it — a page of someone else's words above which you type two lines — or hid it entirely
 * with CSS, so you could not check a single line without revealing everything.
 *
 * The card shows what the quote *is* ("On 18 Nov 2026, Ines Novak wrote") and its first line,
 * and opens in place. The content stays in the document, so it is still sent, and the node
 * serialises back to a plain `<blockquote>` for every other mail client.
 */
export function QuoteCard({ editor, getPos, node }) {
  const [open, setOpen] = useState(false)

  // The attribution line ("On … wrote:") is the paragraph immediately before the quote, which
  // is where a reply builder puts it. Read from the document rather than stored twice.
  let attribution = ''
  try {
    const before = editor.state.doc.resolve(getPos()).nodeBefore
    const text = (before?.textContent || '').trim()
    if (/wrote:$/.test(text)) attribution = text
  } catch {
    /* the node may be detached mid-update; the fallback below is fine */
  }

  const preview = (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 96)

  return (
    <NodeViewWrapper className="my-2 overflow-hidden rounded-lg border border-line bg-secondary/40">
      <button
        type="button"
        contentEditable={false}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors duration-120 hover:bg-secondary/60 max-sm:min-h-11"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-ink-2">
            {attribution || 'Quoted message'}
          </span>
          {!open && preview && (
            <span className="mt-0.5 block truncate text-[12px] text-ink-3">{preview}</span>
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`mt-0.5 size-4 shrink-0 text-ink-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {/* Mounted either way: the content has to stay in the document (it is what gets sent),
          so it is hidden rather than unmounted. */}
      <div className={open ? 'border-t border-line px-3 py-2' : 'hidden'}>
        <NodeViewContent className="text-[13.5px] leading-relaxed text-ink-2 [&_p]:my-1" />
      </div>
    </NodeViewWrapper>
  )
}

export default QuoteCard
