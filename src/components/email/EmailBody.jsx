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
    return (
      <div
        className="email-html-body"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: fitToColumn(sanitizeHtml(resolvedHtml)) }}
      />
    )
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
