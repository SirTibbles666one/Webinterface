/**
 * A preview line is text. A draft body is HTML, so slicing it showed `<p>the vault code is …</p>`
 * in the Drafts list — markup in a place where a sentence belongs.
 */
export function htmlToText(html) {
  if (!html) return ''
  const withBreaks = String(html)
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr)\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
  return withBreaks
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
