# Backlog

Living log of deferred work. Bugs go in `KNOWN-ISSUES.md`; future-roadmap
items go in user memory (`project_direction.md`). This file tracks
mid-grain follow-ups that aren't worth a fresh issue but shouldn't be
forgotten.

## Open URL

- **Streaming size guard.** The 5 MiB cap currently buffers the whole
  response before checking — an attacker-controlled server could ship
  the first 4.99 MiB then keep writing. Replace with a streaming reader
  that aborts as soon as bytes-read exceeds the cap. Defensive only;
  current cap is enough in practice.
  _packages/website/src/url-open.ts fetchMarkdown_
- **Default-branch lookup via api.github.com.** Bare-repo URLs currently
  try `main` then fall back to `master`. Correct in 99% of public repos,
  wrong for `develop` / `trunk` / project-specific defaults. Adds a CSP
  entry (`api.github.com`) and an extra round-trip; current heuristic
  is the right trade for a spike.
  _packages/website/src/url-open.ts resolveCandidates 'repo' case_

## Tauri hardening

- **`fs` plugin scope is currently `**` (entire filesystem).** Combined
  with `read-text-file` + `write-text-file` permissions, this means the
  webview has unrestricted file access via IPC — guarded today only by
  upstream rendering defences (DOMPurify allowlist + html_block elision +
  inline-tag allowlist). Defence-in-depth fix: switch to Tauri 2's
  runtime scope authorisation pattern — paths returned by the dialog
  plugin get added to the runtime fs scope, and `read-text-file` /
  `write-text-file` reject anything outside it. Requires a small Rust
  glue layer in `src-tauri/src/lib.rs`.
  _packages/website/src-tauri/capabilities/default.json fs:scope_
- **`style-src 'unsafe-inline'` in Tauri CSP.** Currently permitted
  because Tauri's overlay title-bar chrome and Tiptap's editor may
  inject inline styles. Audit each source and either move to
  bundled-class styling or use a CSP nonce, then drop `'unsafe-inline'`.
  _packages/website/src-tauri/tauri.conf.json security.csp_

## Distribution

- **Layer 2: signed + notarized macOS builds.** Requires Apple Developer
  Program enrollment ($99/year), a Developer ID Application certificate,
  and the `APPLE_*` env vars wired into the build. Tauri 2 reads them
  automatically and runs `notarytool` post-build. Drops the right-click-
  Open Gatekeeper warning that Layer 1 builds carry. Defer until the app
  has enough usage to make the warning real friction.
- **Auto-update via plugin-updater.** `@tauri-apps/plugin-updater` reads
  a signed update manifest from GitHub Releases. Adds ~200 lines + a
  key-pair generation step. Worth doing once a couple of versions have
  shipped and there are users to update.
- **Universal binary CI.** `pnpm release:tauri` builds locally on a Mac
  with both Rust targets installed. Moving this to GitHub Actions removes
  the local-machine dependency and lets non-Mac contributors cut releases.
  Needs `gh` token + (Layer 2) Apple secrets in repo settings.
- **Windows / Linux builds.** Mac-first today. Windows would need a
  code-signing cert (~$300-500/year) for a no-warning install; Linux
  AppImage / deb / rpm could ship unsigned. Defer until cross-platform
  user demand surfaces.

## Fonts

- **"More fonts" affordance.** Custom URL field or full Google Fonts
  catalogue search inside the font picker. Current 10/5 catalogue
  covers the common pairings; defer until dogfood signal says
  otherwise.
- **Bundled WOFF2s for desktop / mobile.** Tauri offline currently
  falls back to system fonts. Bundling the catalogue increases install
  size; revisit when Tauri/iOS distribution actually ships.
