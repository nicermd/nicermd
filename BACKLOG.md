# Backlog

Living log of deferred work. Bugs go in `KNOWN-ISSUES.md`. Each entry
is prefixed with a status tag so its disposition is scannable:

- **NEXT** — actively next-up; ungated; pick when capacity opens.
- **LATER** — not now / not worth doing yet; no specific trigger, just
  outranked by other work. Revisit when relevant.
- **PARKED** — explicitly gated on a trigger logged in memory. The
  inline italic line names the trigger.

## Rendering / HTML

- **LATER — Tag-scoped `data:` image hook.** The DOMPurify URI hook
  currently drops `data:` URIs on every attribute as a blanket measure.
  If inline image embedding (base64 `<img src="data:image/png;base64,…">`)
  ever becomes a feature, narrow the block to permit `data:image/<type>`
  on `<img src>` only — keeping everything else (especially `<a href>`)
  blocked. Speculative; only do if the feature lands.
  _packages/core/src/index.ts uponSanitizeAttribute hook_

## Tauri hardening

- **NEXT — Runtime `fs` scope per dialog-opened path.** Static scope
  was narrowed from `**` to `$HOME/**` + `$TEMP/**` (commit, 2026-05-19),
  blocking the worst-case attack on system files (`/etc/*`, other
  users' homes). Proper defence-in-depth fix still pending: switch to
  Tauri 2's runtime scope authorisation pattern — paths returned by
  the dialog plugin get added to the runtime fs scope, and
  `read-text-file` / `write-text-file` reject anything outside the
  user-consented set. Requires a small Rust glue layer in
  `src-tauri/src/lib.rs` that calls `tauri_plugin_fs::FsExt::scope()`
  on dialog responses.
  _packages/website/src-tauri/capabilities/default.json fs:scope_
- **LATER — `style-src 'unsafe-inline'` hygiene.** Audited 2026-05-19.
  Threat model: this only matters *if* an attacker can inject HTML
  into the rendered page. DOMPurify already strips `<style>` elements
  (not in `ALLOWED_TAGS`) and `style=""` attributes (not in
  `ALLOWED_ATTR`), so attacker-controlled markdown can't carry inline
  styles regardless of CSP. CSP is the second layer. Dropping
  `'unsafe-inline'` is real work spanning both runtimes:
  - **Tauri:** Tauri 2 auto-injects nonces for static `<style>` blocks
    via the `__TAURI_STYLE_NONCE__` token replacement. CodeMirror's
    runtime `<style>` injection (via `style-mod`) is the holdout —
    needs `EditorView.cspNonce` facet wired to a JS-readable nonce.
    Tauri's per-occurrence nonce generation means we'd need a shim
    `<script>` in index.html carrying its own nonce token, then read
    it from `window.*` at boot. Tiptap nonce status unverified.
  - **Web (CF Pages):** per-request nonces require a Pages Function
    (server-side), not just a static `_headers` file. Meaningful
    infra add.
  Hygiene only, not a priority vs feature work.
  _packages/website/src-tauri/tauri.conf.json + packages/website/public/_headers_

## Desktop features

- **NEXT — Multi-window polish.** Core multi-window landed 2026-05-19:
  Cmd+N opens a new window, each window's JS realm is isolated, menu
  events route to the focused window via `app.emit_to(label, …)`,
  autosave is per-window-label, last-window close quits the app.
  Remaining polish:
  - OS-level "Open With" / double-click currently routes to whichever
    window is focused. Smarter rule: open in a new window if the
    focused window's doc is dirty, else replace in-place. Needs the
    Rust side to query the focused window's dirty state — likely via
    a window-tagged JS event back to Rust.
  - Window state (size, position) isn't restored across launches.
    Tauri's `window-state` plugin handles this with a `<state-flags>`
    config; small add when it matters.
  - The `File → New Document` (Cmd+Shift+N) item reuses the current
    window. Worth deciding the discard-confirmation behaviour when
    that doc is dirty — currently delegates to `newFile` which prompts.
  _packages/website/src-tauri/src/lib.rs_

## Browser integration

- **PARKED — Full Chrome extension (auto-render flavour).**
  _Gated on the lightweight extension showing real usage signal._
  Bookmarklet shipped in the README on 2026-05-18 (single-line JS).
  Tiny MV3 extension shipped at `packages/chrome-ext/` on 2026-05-18
  with three invocation paths (toolbar icon, right-click menu,
  optional user-assigned keyboard shortcut); `contextMenus` +
  `activeTab` permissions only. Remaining: the originally-roadmapped
  Chrome extension that **auto-detects** GitHub `.md` URLs /
  `text/markdown` content-type and renders them inline in the same
  tab (no nicer.md round-trip). Requires host permissions on the
  GitHub family of domains plus a content script that replaces the
  DOM. Biggest lift; biggest reach.

## Distribution

- **PARKED — Layer 2: signed + notarized macOS builds.**
  _Gated on demand or personal-workflow need; see [parked decisions]
  memory entry._ Requires Apple Developer Program enrollment ($99/year),
  a Developer ID Application certificate, and the `APPLE_*` env vars
  wired into the build. Tauri 2 reads them automatically and runs
  `notarytool` post-build. Drops the right-click-Open Gatekeeper
  warning that Layer 1 builds carry.
- **PARKED — Auto-update via plugin-updater.**
  _Gated on signed builds (parked above) plus a real version cadence
  with users to update._ `@tauri-apps/plugin-updater` reads a signed
  update manifest from GitHub Releases. Adds ~200 lines + a key-pair
  generation step.
- **PARKED — Windows / Linux builds.**
  _Gated on cross-platform user demand surfacing._ Mac-first today.
  Windows would need a code-signing cert (~$300-500/year) for a
  no-warning install; Linux AppImage / deb / rpm could ship unsigned.

## Fonts

- **PARKED — "More fonts" affordance.**
  _Gated on dogfood signal that the current 10/5 catalogue feels
  limiting._ Custom URL field or full Google Fonts catalogue search
  inside the font picker.
- **PARKED — Bundled WOFF2s for desktop / mobile.**
  _Gated on Tauri/iOS distribution actually shipping with offline as
  a real concern._ Tauri offline currently falls back to system fonts;
  bundling the catalogue increases install size.

## Documentation polish

- **LATER — README screencap of mode switching.** Two static
  screenshots already in the README. A 5–10s screencap showing
  Read → Write → Split → Code on a single doc would carry the
  mode-switching ergonomic better than prose. Stretch goal, not
  blocking.

## Distribution / hosting

- **LATER — Cloudflare cost mitigation, remaining options.**
  Immutable cache-control on `/assets/*` shipped 2026-05-20 (one-year
  `Cache-Control: public, max-age=31536000, immutable` in
  `public/_headers`), so revisitors hit disk cache rather than
  round-tripping to Cloudflare. That's the biggest single egress
  saving for a viral spike, and it cost essentially nothing.
  Remaining options are bigger lifts, parked on launch demand:
  (a) Load large vendored libs (markdown-it, hljs, KaTeX) from
  public CDNs with SRI hashes so they cache globally and don't count
  against our requests; (c) jsDelivr/unpkg as a fallback origin for
  static releases tagged on GitHub. Trade-off vs the current
  bundle-it-all approach: bundle-it-all is faster first-paint (no
  extra DNS), CDN-loaded is cheaper at scale.
