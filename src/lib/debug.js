/**
 * Diagnostics, off unless asked for.
 *
 * These used to print unconditionally: key-session state on every call, the account name, and
 * the salt the key is derived from. A browser console is shared with every extension and anything
 * that can run in the page, so diagnostics that name the user or the KDF salt are a leak, not a
 * convenience. Enable with localStorage['sloth-debug'] = '1'.
 */
export function debugEnabled() {
  try {
    return localStorage.getItem('sloth-debug') === '1'
  } catch {
    return false
  }
}

export function debugLog(...args) {
  if (debugEnabled()) console.log(...args)
}
