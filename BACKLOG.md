# Backlog

Living log of deferred work. Bugs go in `KNOWN-ISSUES.md`. This file
tracks mid-grain follow-ups that aren't worth a fresh issue but
shouldn't be forgotten.

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
  is the right trade for now.
  _packages/website/src/url-open.ts resolveCandidates 'repo' case_

## Rendering / HTML

- **`<picture>` support for dark-mode-aware images.** Many modern READMEs
  use `<picture>` with `<source media="(prefers-color-scheme: …)">` to
  swap the cover image per theme. Currently both the block-HTML path
  (rule 6 doesn't list `picture` so the tag is tokenised as inline HTML
  and stripped by the inline allowlist) and the would-be allowed path
  (`<source srcset="…">` is relative-path soup not currently rewritten)
  break. Two pieces, ship together:
  - Rewrite `srcset` candidate URLs against `baseUrl` in
    `rewriteRelativeUrls` (parse comma-separated `<url> <descriptor>`
    pairs; resolve each URL; preserve descriptors).
  - Add `picture` / `source` to the DOMPurify allowlist + handle inline
    position (either widen the inline allowlist or pre-process to a
    block in `normalize-html.ts`).
  No driver today, but real-world README rendering hits this often
  enough that it's worth doing once `<picture>` shows up in a doc the
  user actually wants to read.
  _packages/core/src/index.ts rewriteRelativeUrls + PURIFY_CONFIG_

- **Tag-scoped `data:` image hook.** The DOMPurify URI hook currently
  drops `data:` URIs on every attribute as a blanket measure. If inline
  image embedding (base64 `<img src="data:image/png;base64,…">`) ever
  becomes a feature, narrow the block to permit `data:image/<type>` on
  `<img src>` only — keeping everything else (especially `<a href>`)
  blocked. Speculative; only do if the feature lands.
  _packages/core/src/index.ts uponSanitizeAttribute hook_

## Tauri hardening

- **Install `cargo-audit` and wire into CI.** The Node side has
  `pnpm audit --prod` in the CI workflow; the Rust side has no
  parallel check yet. Two Linux-only transitive advisories are
  currently tolerable on the macOS-only build target (rand 0.7.3
  in a build-time `phf` chain, glib 0.18.5 in webkit2gtk) — both
  will need attention when Linux distribution lands. A
  `cargo-audit` step in CI would surface new ones automatically.
- **`fs` plugin scope is currently `**` (entire filesystem).** Combined
  with `read-text-file` + `write-text-file` permissions, this means the
  webview has unrestricted file access via IPC — guarded today only by
  upstream rendering defences (DOMPurify allowlist + inline-tag
  allowlist). Defence-in-depth fix: switch to Tauri 2's
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

## Documentation polish

- **README screenshot or short screencap.** A "what does this look
  like" image at the top of the README would carry visual weight.
  One screenshot of the showcase doc in a clean theme is enough; a
  5–10s screencap of mode switching is a stretch goal.
- **CHANGELOG.md entries.** File is currently a stub. Populate from
  `git log` summary points so there's a real history page.
