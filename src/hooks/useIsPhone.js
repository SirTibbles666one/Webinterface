import { useEffect, useState } from 'react'

// 640px is Tailwind's `sm` breakpoint. Below it the compose window behaves like a
// phone sheet (full screen) instead of a floating desktop window, and rows inside
// it stack.
// One phone breakpoint for the whole app. It used to be 639 here and 767 in the layout,
// so between those widths the reader and drawer ran in phone mode while the composer
// rendered as a floating desktop window and the 44px target floor did not apply.
export const PHONE_QUERY = '(max-width: 767px)'

export function useIsPhone() {
  const [isPhone, setIsPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY)
    const onChange = () => setIsPhone(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return isPhone
}
