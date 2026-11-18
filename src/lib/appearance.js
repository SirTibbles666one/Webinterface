/**
 * Two preferences, applied to the document instead of being threaded through
 * every component: every colour in the app is a token, so a theme is one
 * attribute on <html>.
 */
const THEME_KEY = 'sloth-theme'   // 'dark' | 'light' | 'system'
const DENSITY_KEY = 'sloth-density' // 'comfortable' | 'compact'
const CLOCK_KEY = 'sloth-clock'   // '24' | '12'

const media = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: light)')
  : null

export function readTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark' } catch { return 'dark' }
}
export function readDensity() {
  try { return localStorage.getItem(DENSITY_KEY) || 'comfortable' } catch { return 'comfortable' }
}

export function readClock() {
  try { return localStorage.getItem(CLOCK_KEY) === '12' ? '12' : '24' } catch { return '24' }
}

/**
 * One clock for the whole app.
 *
 * The list printed 24-hour and a conversation card printed "09:51 PM" on the same screen, which
 * is two conventions where there should be one. Every time the app shows goes through here, and
 * which one it is belongs to the reader, not to the browser's locale.
 */
export function formatClock(date, { seconds = false } = {}) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hour12: readClock() === '12',
  })
}

export function resolvedTheme(pref = readTheme()) {
  if (pref === 'system') return media?.matches ? 'light' : 'dark'
  return pref === 'light' ? 'light' : 'dark'
}

function apply() {
  const root = document.documentElement
  root.dataset.theme = resolvedTheme()
  root.dataset.density = readDensity()
  // Keep the browser chrome (address bar, status area) in step with the app.
  const light = root.dataset.theme === 'light'
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.setAttribute('content', light ? '#f6f6f0' : '#10150f')
  }
}

export function setTheme(pref) {
  try { localStorage.setItem(THEME_KEY, pref) } catch { /* private mode: the session still looks right */ }
  apply()
  window.dispatchEvent(new CustomEvent('sloth:appearance'))
}

export function setClock(value) {
  try { localStorage.setItem(CLOCK_KEY, value === '12' ? '12' : '24') } catch { /* same */ }
  apply()
  window.dispatchEvent(new CustomEvent('sloth:appearance'))
}

export function setDensity(value) {
  try { localStorage.setItem(DENSITY_KEY, value) } catch { /* same */ }
  apply()
  window.dispatchEvent(new CustomEvent('sloth:appearance'))
}

/** Call once, before the first paint, so nothing flashes the wrong ground. */
export function initAppearance() {
  apply()
  if (media) {
    const onChange = () => { if (readTheme() === 'system') apply() }
    media.addEventListener?.('change', onChange)
  }
}
