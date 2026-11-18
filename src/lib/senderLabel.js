/**
 * What to call the sender of a row.
 *
 * This is small enough to have been written inline twice, and both times it was wrong: once as a
 * ternary that swallowed the name, once with the message id inside the fallback chain so the
 * friendly label below it could never be reached.
 */
export function senderLabelFor(preview, uid) {
  const named = [preview?.from?.name, preview?.from?.email]
    .map((v) => (v == null ? '' : String(v).trim()))
    .find((v) => v && v !== 'null' && v !== 'undefined')
  if (named) return named
  // A draft with no recipient has no address to name, and its id is not a name.
  if (String(uid || '').startsWith('draft_')) return 'Draft'
  return String(uid || 'Unknown')
}
