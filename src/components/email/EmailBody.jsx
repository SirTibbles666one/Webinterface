import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { ExternalLink } from 'lucide-react'
import { segmentLinks } from '@/emailParser'
import { PgpBody } from '@/components/email/PgpBody'
import { looksEncrypted } from '@/pgp'

// Configure DOMPurify: strip scripts/styles/event-handlers, force all links to open in new tab
const DOMPURIFY_CONFIG = {
  FORBID_TAGS: ['script', 'style', 'link', 'meta', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['action', 'formaction'],
  ADD_ATTR: ['target', 'rel'],
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})


// Pull the armour out of whichever part carries it: in an HTML part it arrives
// wrapped in tags, and decryptBody needs the bare block.
function extractArmor(value) {
  if (typeof value !== 'string' || !looksEncrypted(value)) return null
  const match = value.match(/-----BEGIN PGP MESSAGE-----[\s\S]*?-----END PGP MESSAGE-----/)
  return match ? match[0] : null
}

function sanitizeHtml(html) {
  return DOMPurify.sanitize(html, DOMPURIFY_CONFIG)
}

// Mail is written for a 600px column and says so: `width="600"` attributes and
// `width:600px` inline styles on tables and cells. On a phone that width does not
// exist, and because the reader sits inside a scroll area whose content wrapper is
// `display: table` (it sizes to its widest child), the message did not overflow the
// page — it widened the column past the viewport and had its right edge cut off.
//
// So the fixed widths are removed rather than fought with: drop width/height
// attributes, drop width and nowrap from inline styles, and let the message reflow
// to the column it is actually in. Images keep their aspect through `height: auto`
// in the stylesheet.
function fitToColumn(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const el of doc.body.querySelectorAll('*')) {
    el.removeAttribute('width')
    el.removeAttribute('height')
    const style = el.getAttribute('style')
    if (!style) continue
    const kept = style
      .split(';')
      .map((decl) => decl.trim())
      .filter((decl) => decl && !/^(min-)?width\s*:/i.test(decl) && !/^white-space\s*:\s*nowrap/i.test(decl))
    if (kept.length) el.setAttribute('style', kept.join('; '))
    else el.removeAttribute('style')
  }
  return doc.body.innerHTML
}

// Heuristic: treat textBody as HTML if it starts with an HTML tag
function looksLikeHtml(text) {
  return /^\s*<[a-zA-Z]/.test(text)
}

const ATTR_RE = /^On .{3,300} wrote:\s*$/

function parseBlocks(text) {
  const lines = text.split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('>')) {
      const start = i
      while (i < lines.length && lines[i].startsWith('>')) i++
      blocks.push({ type: 'quote', lines: lines.slice(start, i) })
    } else if (ATTR_RE.test(line.trim()) && i + 1 < lines.length && lines[i + 1].startsWith('>')) {
      blocks.push({ type: 'attribution', content: line })
      i++
    } else {
      const start = i
      while (
        i < lines.length &&
        !lines[i].startsWith('>') &&
        !(ATTR_RE.test(lines[i].trim()) && i + 1 < lines.length && lines[i + 1].startsWith('>'))
      ) i++
      const content = lines.slice(start, i).join('\n')
      if (content.trim()) blocks.push({ type: 'text', content })
    }
  }
  return blocks
}

function stripQuotePrefix(line) {
  return line.replace(/^>+\s?/, '')
}

function TextWithLinks({ text }) {
  return segmentLinks(text).map((seg, i) =>
    seg.type === 'link' ? (
      <a
        key={i}
        href={seg.value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline decoration-primary/40 hover:decoration-primary inline-flex items-baseline gap-0.5 break-all"
      >
        {seg.value}
        <ExternalLink className="size-3 inline shrink-0 opacity-60 ml-0.5 self-center" />
      </a>
    ) : (
      <span key={i}>{seg.value}</span>
    ),
  )
}

// The whole message, on the screen, on a phone.
//
// Mail is written against a fixed pixel canvas (600px tables, 640px centred bodies).
// Reflow squeezes most of it into a phone column, but a phone is also short: a message
// that reflows still runs off the bottom, so "the whole email" was never on screen.
//
// On a phone the message is therefore scaled to fit the space it has — width first,
// then height — and a button switches to full size for reading. Desktop keeps the
// reflowed, unscaled view. The floor is 0.55: below that the type stops being text and
// the message is long enough that the reader is scrolling anyway, so only the width is
// fitted and the height is left to scroll.
function FitToScreen({ html }) {
  const wrap = useRef(null)
  const inner = useRef(null)
  const [scaled, setScaled] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // A new message opens fitted, never inheriting the previous one's zoom.
  useEffect(() => {
    setExpanded(false)
    setScaled(false)
  }, [html])

  useEffect(() => {
    const box = wrap.current
    const body = inner.current
    if (!box || !body) return

    const apply = () => {
      body.style.width = ''
      body.style.transform = ''
      body.style.transformOrigin = ''
      box.style.height = ''
      box.style.overflowX = ''

      const availW = box.clientWidth
      if (!availW) return

      if (!(window.innerWidth < 640) || expanded) {
        setScaled(false)
        return
      }

      const naturalW = body.scrollWidth
      const widthOverflows = naturalW > availW + 1
      const widthScale = widthOverflows ? availW / naturalW : 1

      // Measure the height at the width the scale will be applied to, not at the
      // squeezed width, or the aspect ratio is wrong and the fit is not a fit.
      if (widthOverflows) body.style.width = `${naturalW}px`
      const naturalH = body.scrollHeight
      const top = box.getBoundingClientRect().top
      const availH = Math.max(window.innerHeight - top - 16, 200)
      const heightScale = naturalH > availH ? availH / naturalH : 1

      // A message can overflow on height alone: it reflows into the column and then
      // runs off the bottom, which is the case a width-only fit never touched.
      if (widthScale >= 0.995 && heightScale >= 0.995) {
        setScaled(false)
        return
      }

      let scale = Math.min(widthScale, heightScale)
      // A long message cannot be shown whole and be read: below this the type is a
      // thumbnail. Those keep the reflowed width and scroll, and offer no toggle,
      // because there is no bigger version to switch back to.
      if (scale < 0.4) {
        body.style.width = ''
        setScaled(false)
        return
      }

      body.style.transform = `scale(${scale})`
      body.style.transformOrigin = 'top left'
      box.style.height = `${Math.ceil(naturalH * scale)}px`
      box.style.overflowX = naturalW * scale <= availW + 1 ? 'hidden' : 'auto'
      setScaled(true)
    }

    apply()
    // A message's size is not known at any single moment: the column resizes, an image
    // arrives, a webfont reflows, the document is mutated, or it simply settles late.
    const ro = new ResizeObserver(apply)
    ro.observe(box)
    const mo = new MutationObserver(apply)
    mo.observe(body, { childList: true, subtree: true })
    const imgs = [...body.querySelectorAll('img')]
    imgs.forEach((img) => img.addEventListener('load', apply))
    const onResize = () => apply()
    window.addEventListener('resize', onResize)
    const timers = [120, 500, 1500].map((ms) => setTimeout(apply, ms))
    return () => {
      ro.disconnect()
      mo.disconnect()
      imgs.forEach((img) => img.removeEventListener('load', apply))
      window.removeEventListener('resize', onResize)
      timers.forEach(clearTimeout)
    }
  }, [html, expanded])

  return (
    <>
      <div ref={wrap} className="email-html-fit">
        <div
          ref={inner}
          className="email-html-body"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      {(scaled || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 min-h-11 w-full rounded-md border border-line px-3 text-[12.5px] text-ink-2 transition-colors duration-120 hover:bg-accent hover:text-ink-1"
        >
          {expanded ? 'Fit the message to the screen' : 'Show it at full size'}
        </button>
      )}
    </>
  )
}

export function EmailBody({ textBody, htmlBody, senderHint }) {
  // An OpenPGP message is ciphertext and needs its own reader.
  //
  // This must not depend on htmlBody being absent: the parser hands back an
  // htmlBody for nearly every message, and requiring its absence meant the
  // encrypted branch never ran -- the armour was rendered as ordinary body
  // text, which is exactly how "OpenPGP does not work" looked.
  const armored = extractArmor(htmlBody) || extractArmor(textBody)
  if (armored) {
    return <PgpBody armored={armored} senderHint={senderHint} />
  }

  // Prefer explicit htmlBody; fall back to textBody that looks like HTML
  const resolvedHtml = htmlBody || (textBody && looksLikeHtml(textBody) ? textBody : null)

  if (resolvedHtml) {
    return <FitToScreen html={fitToColumn(sanitizeHtml(resolvedHtml))} />
  }

  const text = textBody || ''
  const blocks = parseBlocks(text)

  return (
    <div className="email-text-body font-sans text-foreground/90 space-y-1">
      {blocks.map((block, i) => {
        if (block.type === 'attribution') {
          return (
            <p key={i} className="text-xs text-foreground/40 italic pt-4 pb-0.5 select-none">
              {block.content}
            </p>
          )
        }
        if (block.type === 'quote') {
          return (
            <blockquote
              key={i}
              className="border-l-2 border-foreground/20 pl-3 space-y-px"
            >
              {block.lines.map((line, j) => {
                const stripped = stripQuotePrefix(line)
                return (
                  <p key={j} className="text-sm text-foreground/40 whitespace-pre-wrap break-words">
                    {stripped.trim() ? <TextWithLinks text={stripped} /> : '\u00a0'}
                  </p>
                )
              })}
            </blockquote>
          )
        }
        return (
          <pre key={i} className="whitespace-pre-wrap break-words font-sans text-sm/relaxed">
            <TextWithLinks text={block.content} />
          </pre>
        )
      })}
    </div>
  )
}