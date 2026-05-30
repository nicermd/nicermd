#!/usr/bin/env node
// Build the macOS Tauri app as a universal DMG and publish a GitHub
// Release with it attached. Layer 1 distribution: unsigned binary,
// users see a Gatekeeper warning on first launch and right-click →
// Open to bypass it.
//
// Prerequisites:
//   - Both Rust targets installed:
//       rustup target add aarch64-apple-darwin x86_64-apple-darwin
//   - GitHub CLI authenticated for the target repo:
//       gh auth status
//
// Usage: pnpm release:tauri              (uses tauri.conf.json version)
//        pnpm release:tauri --dry-run    (build only, skip release)

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const dryRun = process.argv.includes('--dry-run')

const tauriConf = JSON.parse(readFileSync(resolve(root, 'packages/website/src-tauri/tauri.conf.json'), 'utf-8'))
const version = tauriConf.version
const productName = tauriConf.productName
const tag = `tauri-v${version}`

console.log(`Releasing ${productName} v${version} (tag: ${tag})${dryRun ? ' [dry run]' : ''}`)
console.log()

console.log('Building universal DMG…')
execSync('pnpm --filter nicermd-website tauri:build:universal', { stdio: 'inherit', cwd: root })

const dmgPath = resolve(
  root,
  'packages/website/src-tauri/target/universal-apple-darwin/release/bundle/dmg',
  `${productName}_${version}_universal.dmg`,
)
if (!existsSync(dmgPath)) {
  console.error(`DMG not found at ${dmgPath}`)
  console.error('The build may have produced a different filename — check the bundle/dmg directory.')
  process.exit(1)
}
console.log(`✓ DMG built: ${dmgPath}`)

if (dryRun) {
  console.log('Dry run — skipping GitHub Release publish.')
  process.exit(0)
}

const notes = [
  `Unsigned macOS build for ${productName} v${version}.`,
  '',
  '**First launch on macOS:** the system shows a Gatekeeper warning ("unidentified developer").',
  'Right-click the app → Open → Open in the dialog to bypass it. After the first launch, regular',
  'double-click works.',
  '',
  'Universal binary — runs natively on Apple Silicon (M-series) and Intel Macs.',
].join('\n')

console.log(`Publishing GitHub release ${tag}…`)
// --latest=false: the README's Chrome extension install URL uses
// `/releases/latest/download/nicermd-chrome-ext.zip`, which 404s if
// GitHub's "Latest" pointer flips to a Tauri release that doesn't
// carry that asset. Keep the Chrome ext release as the latest pointer
// so the install link stays evergreen; Tauri releases are discovered
// via the `?q=tauri` filtered list linked from the README.
// execFileSync (no shell) instead of execSync with template-string +
// JSON.stringify quoting: JSON quoting isn't shell-safe (doesn't escape
// backticks / `$`), and the values here come from package.json / build
// output rather than user input but the safe pattern is essentially
// free, so don't carry the unsafe one. Each arg passes through as-is.
execFileSync(
  'gh',
  [
    'release', 'create', tag, dmgPath,
    '--title', `${productName} v${version}`,
    '--notes', notes,
    '--latest=false',
  ],
  { stdio: 'inherit', cwd: root },
)
console.log('✓ Released.')
