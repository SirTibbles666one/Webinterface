#!/usr/bin/env node
// Refuse a build that drops a feature production already ships.
//
// Why this exists: the deployed client got three weeks ahead of this repo, and every
// build from the repo looked perfect while quietly removing snooze, the mailbox
// manager and the admin suspend control. Nothing failed — the bundle compiled, the
// page loaded, and the features were simply gone. A green build is not evidence of
// parity, so parity is checked here, by name, before anything can be shipped.
//
//   node scripts/check-live-parity.mjs [dist-dir]
//
// Exits 1 and names every missing feature. docs/production-parity.json is the list.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dist = process.argv[2] || 'dist'
const manifest = JSON.parse(readFileSync('docs/production-parity.json', 'utf8'))

function collect(dir) {
  let out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out = out.concat(collect(path))
    else out.push(path)
  }
  return out
}

let files
try {
  files = collect(dist).filter((f) => /\.(js|css|html)$/.test(f))
} catch {
  console.error(`FAIL  no build at ${dist} — run the build before checking parity`)
  process.exit(1)
}

if (files.length === 0) {
  console.error(`FAIL  ${dist} holds no js/css/html — nothing to check`)
  process.exit(1)
}

// Minified chunks split a feature across files, so the check reads the whole bundle
// as one haystack rather than trying to attribute a string to a chunk.
const haystack = files.map((f) => readFileSync(f, 'utf8')).join('\n')

const missing = []
for (const feature of manifest.features) {
  const gone = feature.must.filter((s) => !haystack.includes(s))
  if (gone.length > 0) missing.push({ feature, gone })
}

if (missing.length > 0) {
  console.error(`FAIL  ${missing.length} feature(s) in production are not in this build:`)
  for (const { feature, gone } of missing) {
    console.error(`  - ${feature.id}: ${feature.why}`)
    for (const s of gone) console.error(`      missing text: ${JSON.stringify(s)}`)
  }
  console.error('')
  console.error('This build would be a downgrade. Recover the feature or update')
  console.error('docs/production-parity.json with a reason, never by deleting the entry quietly.')
  process.exit(1)
}

console.log(`OK    ${manifest.features.length} production feature(s) present across ${files.length} file(s)`)
