import React, { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from './button'

/* What a keyboard may land on inside the panel. The panel itself is excluded —
   it is tabIndex -1 so focus can be parked on it, not so Tab can stop there. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/* Visible means what a keyboard user can see: not display:none, not
   visibility:hidden, not hidden, not aria-hidden. Layout boxes are not
   consulted because a zero-sized rect is also what a browser without layout
   (jsdom, a prerender) reports for a perfectly good button. */
function focusableIn(panel) {
  if (!panel) return []
  return Array.from(panel.querySelectorAll(FOCUSABLE)).filter((el) => {
    if (el.disabled || el.getAttribute('aria-hidden') === 'true') return false
    if (el.closest('[hidden], [aria-hidden="true"]')) return false
    const style = window.getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })
}

/**
 * The one dialog shell.
 *
 * It carries the things a dialog cannot be trusted to remember per call site:
 * a dialog role and a label for assistive tech, Escape as a real way out,
 * Tab wrapping inside the panel instead of walking into the page behind it,
 * focus moved in on open and returned to where it came from on close, and the
 * page behind it not scrolling while it is up. Call sites pass `label` when the
 * header is not the first thing inside.
 *
 * The trap is a keydown on the document rather than a real `inert` on #root:
 * this dialog renders inline, inside #root, so making the root inert would make
 * the dialog inert too. A portal would be the other way to earn `inert`, and it
 * is a bigger change than the defect.
 */
export function Modal({ isOpen, children, onClose, label, dismissible = true, initialFocusRef = null }) {
  const [mounted, setMounted] = React.useState(false)
  const [show, setShow] = React.useState(false)
  const panelRef = useRef(null)
  const returnFocusTo = useRef(null)
  const titleId = useId()

  useEffect(() => {
    if (!isOpen) {
      setShow(false)
      const t = setTimeout(() => setMounted(false), 220)
      return () => clearTimeout(t)
    }
    setMounted(true)
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShow(true)))
    return () => cancelAnimationFrame(raf)
  }, [isOpen])

  // Escape closes, Tab stays inside, and the page behind does not scroll: on a
  // phone a dialog over a scrolling list otherwise lets the list move under the
  // thumb. The trap listens on the document, not the panel, because the way a
  // trap fails is focus being outside the panel already — a panel-scoped
  // handler never fires to pull it back.
  useEffect(() => {
    if (!isOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation()
        onClose?.()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const items = focusableIn(panel)
      if (items.length === 0) {
        e.preventDefault()
        panel.focus?.()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!panel.contains(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen, onClose, dismissible])

  // Focus enters the dialog, and goes back to the control that opened it. Without
  // the return leg, closing a dialog drops the caret at the top of the document and
  // a keyboard user has to walk back to where they were.
  useEffect(() => {
    if (!isOpen) return undefined
    returnFocusTo.current = document.activeElement
    const t = setTimeout(() => {
      const target =
        initialFocusRef?.current ||
        panelRef.current?.querySelector('input:not([type=hidden]), textarea, select') ||
        panelRef.current?.querySelector('button, [href]') ||
        panelRef.current
      target?.focus?.()
    }, 30)
    return () => {
      clearTimeout(t)
      const back = returnFocusTo.current
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus()
    }
  }, [isOpen, initialFocusRef])

  if (!mounted) return null

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${
        show ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label ? undefined : `${titleId}-title`}
        aria-label={label}
        tabIndex={-1}
        className={`bg-card border border-border rounded-lg w-full max-w-md m-4 outline-none transition-all duration-200 ${
          show ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <ModalTitleContext.Provider value={titleId}>{children}</ModalTitleContext.Provider>
      </div>
    </div>
  )
}

const ModalTitleContext = React.createContext(null)

export function ModalHeader({ title, onClose, dismissible = true }) {
  const titleId = React.useContext(ModalTitleContext)
  return (
    <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
      <h2 id={titleId ? `${titleId}-title` : undefined} className="text-lg font-semibold text-foreground">
        {title}
      </h2>
      {dismissible && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-9 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-accent hover:text-foreground max-sm:size-11"
        >
          <X className="size-5" />
        </button>
      )}
    </div>
  )
}

export function ModalContent({ children }) {
  return <div className="p-6 space-y-4">{children}</div>
}

export function ModalFooter({ children }) {
  return <div className="flex flex-wrap justify-end gap-3 p-4 border-t border-border bg-secondary/30">{children}</div>
}

export function ConfirmModal({ isOpen, title, description, confirmText = 'Confirm', onConfirm, onClose }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalHeader title={title} onClose={onClose} />
      <ModalContent>
        <p className="text-foreground/75">{description}</p>
      </ModalContent>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="destructive" onClick={onConfirm}>{confirmText}</Button>
      </ModalFooter>
    </Modal>
  )
}

export function InputModal({ isOpen, title, label, placeholder, initialValue = '', confirmText = 'Save', onConfirm, onClose }) {
  const [value, setValue] = React.useState(initialValue)

  React.useEffect(() => {
    if (isOpen) {
      setValue(initialValue ?? '')
    }
  }, [isOpen, initialValue])

  const handleConfirm = () => {
    onConfirm(value)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalHeader title={title} onClose={onClose} />
      <ModalContent>
        {label && <p className="text-sm font-medium text-foreground/85 mb-2">{label}</p>}
        <input
          autoFocus
          aria-label={label || title}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleConfirm()
            }
          }}
          placeholder={placeholder}
          className="w-full h-10 text-sm bg-input border border-border rounded-md px-3 text-foreground outline-none focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground/60 max-sm:min-h-[44px]"
        />
      </ModalContent>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleConfirm}>{confirmText}</Button>
      </ModalFooter>
    </Modal>
  )
}
