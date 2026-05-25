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

- **LATER — Attribution for bundled Rust crates.** `pnpm licenses:gen`
  only walks the JS dep tree (97 packages). The Tauri DMG also bundles
  Rust crates (tauri, wry, muda, tauri-plugin-{fs,dialog,deep-link,
  window-state}, …). Their license attribution lives in their crate
  source but isn't surfaced anywhere in the repo. For a public release
  we should generate a complementary file via `cargo about generate`
  or similar. Permissive licenses across the tree so attribution
  isn't legally fraught, but completeness is the standard.

## In-doc search

- **LATER — Find polish.** v1 shipped 0.1.14 (DOM walker for Read,
  PM Decoration for Write, @codemirror/search for Code, CM editor
  pane for Split). Outstanding niceties when there's demand:
  - Cmd+G / Cmd+Shift+G to advance match without the bar focused
  - Case-sensitive + whole-word + regex toggles
  - Match count in document title / status strip
  - Split's preview pane participation (composite adapter)
  - Replace alongside find (would need a "Find & Replace" mode)

## Desktop features

- **LATER — Way back to the showcase / home doc.**
  Once a file is open in a desktop window, there's no in-app
  affordance for revisiting the original boot showcase
  (`showcase.md`). Today the options are: open a new window
  (`Cmd+N` — gives a blank doc, not the showcase) or open
  https://nicer.md/ in a browser. Possible shapes when this
  comes up:
  - A "Home" or "Show welcome" menu item / shortcut that loads
    the showcase as a fresh untitled doc, with the usual
    dirty-discard prompt if the current doc has unsaved edits.
  - A "Samples" submenu containing the showcase + the other
    built-in sample docs (`kitchen-sink.md`, `stress.md`).
  - Explicit "Visit nicer.md in browser" menu item as the
    non-desktop fallback for users who want the web demo.
  Decide once dogfooding surfaces which shape is wanted; users
  who already have the file they want open don't need this.

- **LATER — Multi-window polish leftovers.** Core multi-window
  landed 2026-05-19; dirty-aware Open-With routing + window state
  persistence + session restore + per-window mode/source + deep-link
  spawns new window — all shipped 2026-05-21 across 0.1.15–0.1.22.
  Remaining bits when they bite:
  - `File → New Document` (Cmd+Shift+N) reuses the current window
    and delegates to `newFile`, which prompts on dirty. Could route
    to a new window on dirty like Open-With does for consistency.
  - Bring All to Front: replaced with custom handler in 0.1.11 —
    keep an eye on edge cases with hidden / off-screen windows.
  _packages/website/src-tauri/src/lib.rs_

## Browser integration

- **PARKED — Full Chrome extension (auto-render flavour).**
  _Gated on the lightweight extension showing real usage signal._
  Bookmarklet shipped 2026-05-18; lightweight MV3 ext at v0.4.2
  (toolbar / right-click on link / right-click on page / right-click
  on selected text / Alt+Shift+N shortcut; `contextMenus` +
  `activeTab` + `scripting`, no host permissions). Remaining for
  the auto-render flavour: detect GitHub `.md` URLs /
  `text/markdown` content-type and replace inline in the same tab.
  Requires host permissions on the GitHub family of domains + a
  content script that replaces the DOM. Biggest lift; biggest reach.
- **NEXT — Chrome Web Store listing.** In progress (maintainer pursuing
  submission). Lightweight extension is feature-complete and dogfooded.
  Needs: $5 developer account, listing copy, screenshots (toolbar /
  context menu / render-selection / deep-link in action), privacy
  policy markdown. Listing artwork should highlight: GitHub URL
  one-click, render-selection (the big differentiator), no host
  permissions.
- **PARKED — Firefox Add-ons (AMO) listing.**
  _Gated on Chrome Web Store traction first._ MV3 supported on AMO
  but listing artwork + privacy disclosures duplicate work. Free to
  publish. Revisit once Chrome listing is live and dogfooded.
- **PARKED — Edge Add-ons listing.**
  _Gated similarly._ Microsoft store, free, MV3-compatible. Marginal
  reach beyond Chrome Web Store (Edge users can install from CWS).
- **PARKED — Safari extension.**
  _Gated on Apple Developer Program enrollment_ (also gates signed
  Mac builds, listed below). Different format (App Extension bundled
  in a Mac app). Real work, lower reach than the other browsers.

## Distribution

- **DONE 2026-05-25 — Homebrew custom tap.** `brew install --cask nicermd/tap/nicermd`
  via [`nicermd/homebrew-tap`](https://github.com/nicermd/homebrew-tap).
  Pulls the universal DMG from the latest `tauri-v*` GitHub release;
  livecheck scans the releases.atom for tauri-v* tags (so chrome-ext-v*
  tags don't trip version detection). Works with unsigned builds — users
  still hit the Gatekeeper right-click-Open prompt first run, same as
  the direct DMG. Official `homebrew-cask` PR is blocked on signed
  builds (parked below).
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
- **PARKED — Linux desktop builds + package channels.**
  _Gated on Linux user demand surfacing._ Mac-first today. Tauri
  produces `.deb`, `.appimage`, and `.rpm` artifacts natively; all
  can ship unsigned. Recommended channel order when this lights up:
  1. **AppImage** — zero packaging effort, portable across distros,
     publish on GitHub Releases alongside the DMG.
  2. **Flatpak (Flathub)** — modern cross-distro desktop format,
     sandboxed. Requires a manifest + Flathub review.
  3. **AUR** — easy ship-and-forget for Arch users; just a build
     script in a community AUR repo. `yay -S nicermd`.
  4. **Homebrew on Linux** (Linuxbrew) — same `brew install --cask`
     path as macOS; reuses the existing tap. Unusual for Linux
     desktop apps but works.
  5. **apt / dnf** — distro-specific `.deb` / `.rpm`. Host on GitHub
     Releases or a community PPA / Copr.
- **PARKED — Windows desktop builds + package channels.**
  _Gated on Windows user demand surfacing._ Tauri produces `.msi`
  and `.exe` installers. A code-signing cert (~$300-500/year)
  removes the SmartScreen warning at install. Recommended channels:
  1. **winget** — Microsoft's official package manager, free to
     publish. `winget install nicermd`. The canonical modern path.
  2. **Scoop** — dev-oriented, brew-like. Community buckets;
     publishing is a JSON manifest in a bucket repo.
  3. **Chocolatey** — pre-winget veteran with a large install base.
     `choco install nicermd`.

## Fonts

- **PARKED — "More fonts" affordance.**
  _Gated on dogfood signal that the current 10/5 catalogue feels
  limiting._ Custom URL field or full Google Fonts catalogue search
  inside the font picker.
- **PARKED — Bundled WOFF2s for desktop / mobile.**
  _Gated on Tauri/iOS distribution actually shipping with offline as
  a real concern._ Tauri offline currently falls back to system fonts;
  bundling the catalogue increases install size.

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
