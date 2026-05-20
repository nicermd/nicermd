# Known Issues

Living log. Open items at top, recently closed below. Drop closed items
once they've been quiet for a release or two.

## Open

- **App crashes when spawning a 3rd window.** Reported during 0.1.6
  dogfood testing: two existing windows die when the third window is
  opened. No repro steps captured yet. Suspected root causes to
  investigate: WebKit shared-process GPU limit, multiple webviews
  competing for an OS resource, or some lifecycle race in Tauri 2's
  WebviewWindowBuilder when several windows boot in quick succession.
  Reproducer needed.
- **Window → Bring All to Front does nothing.** Predefined menu item
  in `lib.rs:build_menu`. Restoring an individual minimised window
  from the windowsMenu list works fine, so this is specific to the
  multi-window-arrange action — likely a muda-on-macOS quirk that
  needs deeper investigation, or possibly the `TitleBarStyle::Overlay`
  excluding our windows from the standard NSApp.arrangeInFront window
  set.
- **Dialog keyboard nav.** `ask()`-based discard dialogs
  (Cmd+R reload, Cmd+Q quit, file-new discard) accept Enter for the
  default button but Escape doesn't reliably cancel and Left/Right
  arrows don't move the highlighted button on macOS. May be a
  limitation of `tauri-plugin-dialog`'s native NSAlert wrapping vs
  the underlying NSAlert behaviour. Low priority — fallback is to
  click the No button.

## Recently fixed

- **Tauri shell was single-window only.** `Cmd+N` opened a new empty
  doc in the same window; `WindowEvent::CloseRequested` always called
  `app.exit(0)`. No way to read two files side by side. Now: Cmd+N
  opens a new window with its own JS realm, menu events
  (Save / mode-switch / Open) route only to the focused window via
  `app.emit_to(label, …)`, autosave's localStorage slot is per-window-
  label so two windows don't clobber each other, and the app only
  exits when the last window closes. Capability `windows` field
  widened from `["main"]` to `["*"]` so new windows inherit all
  permissions (without this, drag/save/dialog all silently fail in
  any window other than the original).
  _packages/website/src-tauri/src/lib.rs +
  packages/website/src-tauri/capabilities/default.json +
  packages/website/src/{autosave,tauri-bridge}.ts_

- **Tauri `fs` scope was wide-open (`**`).** With `read-text-file` +
  `write-text-file` permissions, the webview could read or write any
  file the user could — including `/etc/passwd`, ssh keys, other
  users' home directories. Defence relied entirely on rendering-side
  hardening (DOMPurify + tag allowlist). Tightened to `$HOME/**` +
  `$TEMP/**`, blocking system files and cross-user reads while
  preserving all reasonable file-picker / autosave flows. Proper
  per-dialog runtime scope authorisation still pending — tracked in
  BACKLOG under Tauri hardening.
  _packages/website/src-tauri/capabilities/default.json fs:scope_

- **URL fetch buffered the entire response before checking the 5 MiB
  cap.** An attacker-controlled server could ship up to ~5 MiB of body
  before we'd reject — wasteful at best, a memory-pressure vector at
  worst. Fix: stream the body via `resp.body.getReader()`, accumulate
  bytes per chunk, and `reader.cancel()` as soon as the cumulative
  total exceeds the cap. TextDecoder stream-mode handles multi-byte
  UTF-8 sequences split across chunks. Falls back to the old buffer-
  then-check path only when `resp.body` is null. Defensive only;
  current cap is still adequate in practice but the failure mode is
  now bounded.
  _packages/website/src/url-open.ts readBodyWithCap_

- **`<picture>` + `<source>` dark-mode-aware images dropped.** READMEs
  that swap a cover image by `prefers-color-scheme` (using `<picture>`
  with multiple `<source>` candidates) rendered as an empty paragraph
  on the website. Two root causes: (a) `<picture>` not in markdown-it's
  block-HTML allowlist, so it tokenised as inline HTML and the renderer
  emitted `<p></p>`; (b) `<picture>` and `<source>` not in DOMPurify's
  allowlist, so even when surrounded by `<div>` they'd be stripped.
  Plus `srcset` URLs weren't rewritten against `baseUrl` for URL-loaded
  docs. Fix: normalize-html wraps standalone `<picture>` blocks in
  `<div>` to land on markdown-it's block path; DOMPurify allowlist
  extended with `picture` / `source` + `srcset` / `media` / `sizes` /
  `type` attrs; `rewriteRelativeUrls` parses the comma-separated
  `srcset` candidate list and rewrites each URL.
  _packages/core/src/{index,normalize-html}.ts_

- **Source files showed uniform grey in CodeMirror modes.** With the
  markdown language extension removed for non-markdown content (so
  `#` lines stop being parsed as H1 headings), source files had no
  syntax highlighting at all in Code / Split modes — every keyword,
  string, comment was the same `--cm-fg` colour. Fix: per-language
  CodeMirror extensions (python, javascript / typescript / jsx / tsx,
  json, css, html, xml / svg) lazy-loaded via `Compartment`, with a
  shared `sourceHighlight` palette mapping tag types to existing
  `--cm-*` CSS variables so themes drive the colours. _commit 8155afc_

- **URL stripped from address bar after boot-URL gate acceptance.**
  Path 3 (external arrival) cleared `?url=…` from the address bar
  on arrival to avoid a re-prompt loop on refresh, then never
  restored it after the user clicked Open. Result: refresh lost the
  loaded doc, and the URL wasn't a copyable share link any more.
  Fix: after the gate is accepted, mirror the ext-pickup path —
  rewrite the address bar to `?url=<original>` with a `chainKind:
  'chain'` history state so refresh hits Path 2 (trusted nav,
  gate-free reload). _commit 8155afc_

- **Save-As forced `.md` for non-markdown docs.** The FSA / Tauri /
  download save paths hardcoded markdown-only file-type filters and
  a `text/markdown` MIME, so a python file edited in Mode 4 saved
  as `__init__.py.md` or got rejected by the picker. Fix: filters
  + MIME + default name now derive from the current `ContentKind`;
  open dialog widened symmetrically to accept every renderable
  source extension. _commit 8155afc_

- **Filename missing in Tauri after fullscreen toggle.** `data-fullscreen`
  on `<html>` got stuck at `'1'` if the user entered or exited
  fullscreen via macOS native controls (green button, swipe gestures)
  rather than our Cmd+Shift+F toggle. CSS hid `.window-title` based on
  that attribute, so the filename disappeared and never came back.
  Fix: boot-time sync of `data-fullscreen` from `win.isFullscreen()`
  plus a `win.onResized` listener that re-syncs on fullscreen
  transitions. _packages/website/src/main.ts boot()_

- **Title + icons shift between modes.** Modes 1/2/4 scroll at the
  document level (vertical scrollbar present); mode 3 scrolls inside
  its panes (no document scrollbar). With classic-style scrollbars,
  this caused fixed-position elements pinned to `right: 0` to shift
  horizontally when switching modes. Fix: `scrollbar-gutter: stable`
  on `html` reserves the gutter unconditionally. No-op on overlay
  scrollbars; stabilises layout on classic ones.
  _packages/website/src/main.css_

- **Title strip cycle caused disappearing icons.** A dev-only A/B cycle
  for title-strip position persisted `'none'` to localStorage on first
  boot, leaving fresh users with nothing visible. Fix: deleted the
  variant module and locked the strip in (filename top, icons
  top-right) for both shells. _commit 545f4fb_

- **Scroll-hide stuck off-screen.** Once the strip hid on a fast
  downward scroll, gentle reading-pace scroll-up (1-2 px/frame)
  couldn't bring it back because the show-direction also required a
  threshold delta. Fix: asymmetric thresholds — hide needs sustained
  velocity, show fires on any upward delta.
  _packages/website/src/scroll-strip.ts_
