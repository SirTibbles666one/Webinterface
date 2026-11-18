/**
 * Ending a session, rather than forgetting about one.
 *
 * The sign-out button used to clear local storage and navigate away, which leaves the token valid
 * on the server until it expires — the same JWT that was just "signed out" still opens the mailbox
 * for anyone holding it. The server has always been able to revoke (`router.rs` refuses a token
 * whose session was signed out); this is the call that was never made.
 */
export async function endSession({
  sessions,
  revoke,
  clear,
  onRevoked,
  onFailed,
} = {}) {
  let revoked = false
  try {
    const data = await sessions()
    const list = data?.sessions ?? data?.data?.sessions ?? []
    const current = list.find((s) => s.current)
    if (current?.id) {
      await revoke(current.id)
      revoked = true
      onRevoked?.(current.id)
    }
  } catch {
    // Offline, expired, or the server cannot be reached. Local state is cleared either way: a
    // person tapping sign out expects to be signed out here, even with no network.
    onFailed?.()
  }
  clear()
  return revoked
}
