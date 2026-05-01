#!/usr/bin/env node
// Bump the user-facing version across the places that ship it. The
// Tauri bundle's version is the canonical 'release version' since it
// becomes the macOS .app's CFBundleShortVersionString. APP_VERSION in
// version.ts is the user-visible label (shown in the corner badge
// popover), kept in 'v<major>.<minor> alpha' form during alpha. We
// keep the alpha suffix on bump until the user explicitly drops it.
//
// Usage: pnpm version:bump <semver>   (e.g., pnpm version:bump 0.2.0)

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const semver = process.argv[2]
if (!semver || !/^\d+\.\d+\.\d+$/.test(semver)) {
  console.error('usage: bump-version.mjs <semver>   (e.g., 0.2.0)')
  process.exit(1)
}

// Tauri version (the one users see in 'About this Mac' / Get Info on the .app)
const tauriConfPath = resolve(root, 'packages/website/src-tauri/tauri.conf.json')
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf-8'))
const oldTauri = tauriConf.version
tauriConf.version = semver
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n')

// APP_VERSION label — keep the alpha suffix if it's there, drop trailing
// patch (badge looks cleaner as 'v0.2 alpha' than 'v0.2.0 alpha').
const versionTsPath = resolve(root, 'packages/website/src/version.ts')
const versionTs = readFileSync(versionTsPath, 'utf-8')
const labelBase = `v${semver.split('.').slice(0, 2).join('.')}`
const oldMatch = versionTs.match(/APP_VERSION = '([^']*)'/)
const oldLabel = oldMatch ? oldMatch[1] : ''
const isAlpha = oldLabel.toLowerCase().includes('alpha')
const newLabel = `${labelBase}${isAlpha ? ' alpha' : ''}`
const updated = versionTs.replace(/APP_VERSION = '[^']*'/, `APP_VERSION = '${newLabel}'`)
writeFileSync(versionTsPath, updated)

console.log(`tauri.conf.json: ${oldTauri} → ${semver}`)
console.log(`APP_VERSION:     ${oldLabel} → ${newLabel}`)
console.log()
console.log("Don't forget to bump CACHE_VERSION in packages/website/public/sw.js")
console.log("if this release contains UI / CSS / SW changes.")
