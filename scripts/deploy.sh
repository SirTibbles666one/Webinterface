#!/usr/bin/env bash
# Deploy the web client. Fails loudly rather than shipping whatever is already in dist.
#
# This exists because a failed build once shipped the previous bundle: `npm run build
# | tail -2 && tar czf - -C dist . | ssh ...` takes its exit status from `tail`, so a
# broken build read as success and the old dist went to the server. The symptom looked
# exactly like a client caching problem, and cost a round of "nothing is changing".
set -euo pipefail

cd "$(dirname "$0")/.."

KEY=${MAIL_SSH_KEY:-$HOME/.ssh/mail_ed25519}
HOST=root@46.62.155.175
STATIC=/opt/on/data/static

if [ -n "$(git status --porcelain)" ] && [ "${1:-}" != "--allow-dirty" ]; then
  echo "FAIL  working tree is dirty; the bundle would be stamped with a commit it does not match" >&2
  echo "      commit first, or pass --allow-dirty for a throwaway build" >&2
  exit 1
fi

# A bundle with an undefined identifier builds fine and crashes on the click that
# reaches it. The codebase is not lint-clean, so this gate is narrow on purpose: it
# fails only on `no-undef`, which is always a real bug.
echo "== lint (undefined identifiers)"
undef=$(npx eslint src --rule '{"no-undef":"error"}' --quiet 2>&1 | grep -c "no-undef" || true)
if [ "${undef:-0}" -gt 0 ]; then
  echo "FAIL  $undef undefined identifier(s):" >&2
  npx eslint src --rule '{"no-undef":"error"}' --quiet 2>&1 | grep "no-undef" >&2
  exit 1
fi

echo "== build"
npm run build

# A build that did not produce an entry point is not a build.
entry=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html | head -1 || true)
if [ -z "$entry" ] || [ ! -f "dist/$entry" ]; then
  echo "FAIL  dist/index.html does not reference a built asset" >&2
  exit 1
fi

stamp=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
if ! grep -q "$stamp" "dist/$entry"; then
  echo "FAIL  build stamp $stamp is not in $entry — this bundle is not this commit" >&2
  exit 1
fi

echo "== parity with production"
# A green build that dropped a shipped feature looks exactly like a good one.
if ! node scripts/check-live-parity.mjs dist; then
  echo "FAIL  this build is missing features production already serves — see docs/production-parity.json" >&2
  exit 1
fi

echo "== upload $entry ($stamp)"
# Files are written in beside the ones already served, assets first and index.html last. Emptying
# the directory first (the old `rm -rf` then extract) serves 404 for the length of the extraction:
# measured at 10 failures in 517 polls, which is the half-rendered page a reader sees if they
# reload or fetch a chunk during a deploy.
tar czf - -C dist . | ssh -i "$KEY" -o BatchMode=yes "$HOST" "bash /opt/on/deploy/static-swap.sh"

echo "== verify what the server actually serves"
served=$(curl -sS https://mail.slothlee.xyz/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
if [ "$served" != "$entry" ]; then
  echo "FAIL  server references $served, expected $entry" >&2
  exit 1
fi
local_sha=$(sha256sum "dist/$entry" | cut -d' ' -f1)
served_sha=$(curl -sS "https://mail.slothlee.xyz/$entry" | sha256sum | cut -d' ' -f1)
if [ "$local_sha" != "$served_sha" ]; then
  echo "FAIL  served bytes differ from the build (local $local_sha, served $served_sha)" >&2
  exit 1
fi

echo "OK    production serves $entry, byte-identical, stamped $stamp"
