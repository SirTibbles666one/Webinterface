import { useCallback, useState } from 'react'
import { listSnoozed, snoozeEmail, unsnoozeEmail } from '@/api'
import { isMissingRoute } from '@/lib/deleteMessage'

/**
 * Messages put away until a time you chose.
 *
 * The server owns the sleep: it leaves a snoozed message out of every folder and
 * puts it back in the inbox when the clock passes. So this holds only the list of
 * "what is asleep, and until when" — the screen never filters the inbox itself.
 */
export function useSnoozed({ fetchPreviewsFor }) {
  const [items, setItems] = useState([])
  // A server without the route is not an empty folder; the banner says which it is.
  const [available, setAvailable] = useState(true)

  const fetchSnoozed = useCallback(async () => {
    try {
      const { items: list = [] } = await listSnoozed()
      const normalized = (list ?? [])
        .map((item) => ({ uid: String(item.uid), until: Number(item.until) }))
        .sort((a, b) => a.until - b.until)
      setItems(normalized)
      setAvailable(true)
      const uids = normalized.map((item) => item.uid)
      if (uids.length) await fetchPreviewsFor(uids).catch(() => {})
    } catch (error) {
      if (isMissingRoute(error)) setAvailable(false)
    }
  }, [fetchPreviewsFor])

  const snooze = useCallback(async (uids, until) => {
    const done = []
    await Promise.all(uids.map(async (uid) => {
      try {
        await snoozeEmail(uid, until)
        done.push(String(uid))
      } catch {}
    }))
    if (done.length) {
      setItems((prev) => {
        const known = new Set(prev.map((item) => item.uid))
        return [
          ...done.filter((uid) => !known.has(uid)).map((uid) => ({ uid, until: Number(until) })),
          ...prev,
        ].sort((a, b) => a.until - b.until)
      })
    }
    return done
  }, [])

  const wake = useCallback(async (uids) => {
    const done = []
    await Promise.all(uids.map(async (uid) => {
      try {
        await unsnoozeEmail(uid)
        done.push(String(uid))
      } catch {}
    }))
    if (done.length) {
      const gone = new Set(done)
      setItems((prev) => prev.filter((item) => !gone.has(item.uid)))
    }
    return done
  }, [])

  const untilFor = useCallback(
    (uid) => items.find((item) => item.uid === String(uid))?.until ?? null,
    [items],
  )

  return { items, available, count: items.length, fetchSnoozed, snooze, wake, untilFor }
}

/** Unix seconds, the unit the server stores. */
const seconds = (date) => Math.floor(date.getTime() / 1000)

/** The next time that weekday comes round, at nine in the morning, local. */
const nextWeekdayAtNine = (from, weekday) => {
  const date = new Date(from)
  const ahead = (weekday - from.getDay() + 7) % 7 || 7
  date.setDate(from.getDate() + ahead)
  date.setHours(9, 0, 0, 0)
  return date
}

/** The four times the menu offers, each worked out from the moment it is opened. */
export function snoozePresets(now = new Date()) {
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  return [
    { key: 'later', label: 'In 3 hours', until: seconds(now) + 10800 },
    { key: 'tomorrow', label: 'Tomorrow 09:00', until: seconds(tomorrow) },
    { key: 'weekend', label: 'Saturday 09:00', until: seconds(nextWeekdayAtNine(now, 6)) },
    { key: 'week', label: 'Next Monday 09:00', until: seconds(nextWeekdayAtNine(now, 1)) },
  ]
}

/** "back in 40 min", "back in 3 hours", or the day and minute it returns. */
export function snoozeLabel(until, now = Date.now()) {
  const at = new Date(until * 1000)
  const minutes = Math.round((at.getTime() - now) / 60000)
  if (minutes <= 0) return 'back in the inbox'
  if (minutes < 60) return `back in ${minutes} min`
  if (minutes < 1440) {
    const hours = Math.round(minutes / 60)
    return `back in ${hours} hour${hours === 1 ? '' : 's'}`
  }
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const day = at.toDateString() === new Date().toDateString()
    ? 'today'
    : at.toDateString() === new Date(now + 86400000).toDateString()
      ? 'tomorrow'
      : at.toDateString()
  return `back ${day} ${clock}`
}
