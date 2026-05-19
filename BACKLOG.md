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
## Plain text in the reader

- **Render non-markdown text in Nicer.md theme typography.** A
  visitor reading a README via the URL loader often wants to click
  through to `LICENSE`, `CHANGELOG` (without `.md`), `.txt` notes,
  or even source files in the same repo — and right now those
  links navigate away to raw GitHub. Rendering them inside Nicer.md
  with the active theme's typography keeps the reading experience
  consistent. Surfaced 2026-05-18.
  Design questions before building:
  - **Scope.** Just LICENSE-shaped files (no extension, plain text
    obvious from path)? `.txt` too? `.markdown`, `.mdx`, `.rst`?
    Source files (`.py`, `.ts`, `.go`) with syntax highlighting via
    the existing highlight.js integration? Each step widens what
    counts as "a Nicer.md document".
  - **Rendering path.** Wrap in `<pre>` so whitespace is preserved
    and characters are literal (no accidental bold from `**` in a
    LICENSE), or run markdown-it anyway because most plain-text
    files happen to parse harmlessly? Pre-with-theme is safer.
  - **Loader filter.** `parseGithubUrl` currently rejects non-
    markdown paths via `MD_EXT_RE`. Relax to an allowlist of safe
    extensions (`.md`, `.markdown`, `.mdx`, `.txt`, no extension)?
    Or content-type sniff after fetch?
  - **Link-chain eligibility.** Once the loader accepts more shapes,
    chain-clicks automatically pick them up (chaining is gated by
    `parseGithubUrl`). Bonus: makes "click through README → LICENSE"
    work as a single fluid read.
  - **Interaction with edit modes.** Plain-text files probably
    shouldn't get Write-mode (Tiptap WYSIWYG would mangle them);
    consider gating Mode 2 off when the doc-source is non-markdown.

## Rendering / HTML

- **Tag-scoped `data:` image hook.** The DOMPurify URI hook currently
  drops `data:` URIs on every attribute as a blanket measure. If inline
  image embedding (base64 `<img src="data:image/png;base64,…">`) ever
  becomes a feature, narrow the block to permit `data:image/<type>` on
  `<img src>` only — keeping everything else (especially `<a href>`)
  blocked. Speculative; only do if the feature lands.
  _packages/core/src/index.ts uponSanitizeAttribute hook_

## Tauri hardening

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

## Desktop features

- **Multiple windows.** Today the Tauri shell is single-window: one
  document, one editor surface, and `WindowEvent::CloseRequested`
  calls `app_handle.exit(0)` so the red traffic light fully quits.
  Multi-window would let the user read or edit several files
  side-by-side. Implementation touches several layers:
  - Drop the "exit on last-window close" behaviour and restore
    macOS's normal "app keeps running with no windows" convention —
    or keep "quit when the last window closes" but stop exiting on
    every close. Decision shapes how the menu/dock feels.
  - `File → New Window` menu item; `Cmd+N` either opens a new empty
    window or stays as "new doc in current window" (decide).
  - Each window owns its own doc-source state. The current
    `doc-source.ts` abstraction is per-shell; need to scope it
    per-window (likely a window-id keyed map on the Rust side, or
    have each window manage its own state in JS with no shared
    store).
  - OS-level file open (`RunEvent::Opened`, Open With) should open
    in a new window if any window already has an unsaved doc, else
    reuse the focused window. Worth deciding the rule before coding.
  - Autosave `localStorage` slot is currently single-slot; needs to
    become per-window or use a different storage scheme.
  - Drag-drop, fullscreen, zoom — all need to be window-scoped.
  Real architectural shift; not a flip-of-a-switch. Worth scoping a
  spike first to see how invasive the per-window state-isolation is.
  _packages/website/src-tauri/src/lib.rs WindowEvent + RunEvent;
  packages/website/src/doc-source.ts; packages/website/src/main.ts_

## Browser integration

- **Full Chrome extension** (the auto-render flavour). Bookmarklet
  shipped in the README on 2026-05-18 (single-line JS). Tiny MV3
  extension shipped at `packages/chrome-ext/` on 2026-05-18 with
  three invocation paths (toolbar icon, right-click menu, optional
  user-assigned keyboard shortcut); `contextMenus` + `activeTab`
  permissions only. Remaining: the originally-roadmapped Chrome
  extension that **auto-detects** GitHub `.md` URLs / `text/markdown`
  content-type and renders them inline in the same tab (no nicer.md
  round-trip). Requires host permissions on the GitHub family of
  domains plus a content script that replaces the DOM. Biggest
  lift; biggest reach. Worth doing once the lightweight extension
  has real usage signal.

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

- **README screencap of mode switching.** Two static screenshots
  already in the README. A 5–10s screencap showing Read → Write →
  Split → Code on a single doc would carry the mode-switching
  ergonomic better than prose. Stretch goal, not blocking.
- **CHANGELOG.md entries.** File is currently a stub. Populate from
  `git log` summary points so there's a real history page.

## Distribution / hosting

- **Cloudflare cost mitigation for viral spikes.** Today every byte
  served to nicer.md comes off Cloudflare Pages free tier (which has
  generous-but-finite request and bandwidth quotas). If a launch /
  HN post / Twitter share hits hard we want headroom without paying.
  Explore: (a) Loading large vendored libs from public CDNs
  (markdown-it, hljs, KaTeX) with SRI hashes so they're cached
  globally and don't count against our requests; (b) Aggressive
  immutable cache-control on hashed assets so most return visits
  are 304s; (c) jsDelivr/unpkg as a fallback origin for static
  releases tagged on GitHub. Trade-off vs the current bundle-it-all
  approach: bundle-it-all is faster first-paint (no extra DNS), CDN-
  loaded is cheaper at scale. Worth scoping when site usage warrants
  it. Surfaced 2026-05-19.
