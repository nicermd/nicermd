# Changelog

This file follows [Keep a Changelog](https://keepachangelog.com)
format and [Semantic Versioning](https://semver.org). The public
alpha shipped at 0.1.3 on 2026-05-17; for development history up
to that point, see `git log`. Versioned entries start from the
next release.

## Unreleased

- See `git log` for the running list of changes on `main`.

## 0.1.9 — 2026-05-20

### Added
- **Ayu Dark + Ayu Mirage themes.** Companion to the existing Ayu
  Light. Inspired by Ivan Konstantinov's
  [Ayu palette](https://github.com/dempfi/ayu); attributed in
  [PALETTES.md](./PALETTES.md).

### Removed
- **Newsprint theme.** Was a Nicer.md original and felt redundant
  alongside the other warm-light themes (Solarized Light,
  Catppuccin Latte, Rosé Pine Dawn). Anyone with it active will fall
  back to One Light on next launch.

## 0.1.8 — 2026-05-20

### Changed
- **Inline code (`backticked`) picks up the theme's monospace tint.**
  Per-theme `--cm-monospace` colour — already used in CodeMirror's
  source view for inline-monospace tokens — now applies to inline
  `<code>` in Read, Write, and Split-preview modes too. A backticked
  `Cmd+S` reads as distinctly coloured against prose instead of just
  a subtly-tinted background block. Fenced code blocks (`pre code`)
  stay neutral so hljs / Shiki tokens carry the palette inside.

### Fixed
- **Window menu now shows the filename of each open window.** Every
  window's NSWindow title was the literal "Nicer.md" from
  `WebviewWindowBuilder::title`, so the macOS Window menu listed
  every open document with the same name — impossible to disambiguate.
  `refreshTitle` now also calls `getCurrentWindow().setTitle()` in
  Tauri so the NSWindow title follows the loaded doc (and dirty
  marker). The Dock-icon hover and Mission Control also benefit.

## 0.1.7 — 2026-05-20

Quick-turn fixes from dogfood testing of 0.1.6.

### Added
- **File → Open URL…** menu item with `Cmd+Alt+O` accelerator. The
  desktop app now has a discoverable menu path for opening URL-loaded
  markdown (raw GitHub, gists, etc.); the JS-side keyboard shortcut
  wasn't reliably reaching the webview in the bundled build.

### Changed
- **OS "Open With" now opens in a new window** when the app is already
  running. Previously the picked file replaced whatever was in the
  focused window — surprising and prone to clobbering unsaved work.
  Cold-start Open-With still loads into the main window (same as
  before).
- **Read-mode prose now picks up the theme.** Previously `.mode-read`
  styled only paragraphs, links, code, and pre — headings, blockquotes,
  tables, and HRs inherited body `--fg`/defaults, so every theme
  rendered most of the document in plain body colour. Mode 1 now
  carries the same per-element theming Modes 2 (Write) and 3 (Split
  preview) already had: heading colour via `var(--cm-heading)`,
  blockquote border + `--muted` text, HR `--border` rule, table
  cell borders + header row in `--surface`. Mode 2's heading colour
  also added (was missing) for consistency across modes.
- **Theme-picker "selected" indicator is more visible.** The
  hardcoded `#2563eb` outline blended into themes whose page
  background sat in a similar blue. Now uses `var(--accent)` at 3px
  with a `--fg` hairline so the ring reads against any theme.

### Fixed
- **Minimised window couldn't be recovered from the Window menu.**
  `set_as_windows_menu_for_nsapp` was called inside `build_menu`
  before the menu was installed on the app, so muda's
  `resolve_ns_menu_for_nsapp` silently no-op'd (no main menu →
  returns `None`). Moved the call after `app.set_menu(menu)`. Cmd+\`
  cycling was working via a different code path; the windowsMenu
  designation specifically governs auto-appending open windows and
  minimised-state arrows in that menu.

## 0.1.6 — 2026-05-20

### Added
- **Multi-window support.** `Cmd+N` opens a new window with its own
  JS realm; per-window autosave (localStorage suffixed with window
  label); menu events route to the focused window only; last-window
  close quits the app. macOS `Window` menu wired as `windowsMenu` so
  ``Cmd+` `` cycles between open windows and a minimised window can
  be brought back from the menu.
- **`<picture>` element support.** Dark-mode-aware READMEs (which
  swap a cover image by `prefers-color-scheme`) now render correctly
  on both the website and the desktop app. `<picture>` + `<source>`
  added to the DOMPurify allowlist; `srcset` URLs are rewritten
  against `baseUrl` for URL-loaded docs.

### Changed
- **Streaming cap on URL fetches.** Bodies stream through a 5 MiB
  ceiling with early abort, replacing the buffer-then-check path.
- **`fs` scope on desktop is now runtime-only.** Static
  `$HOME/**` + `$TEMP/**` allow block dropped; `readTextFile` /
  `writeTextFile` only succeed for paths the user has explicitly
  picked via the system dialog (auto-registered by the dialog
  plugin) or arrived via OS-level "Open With" / double-click
  (registered in the `RunEvent::Opened` handler). Closes the
  worst-case attack surface where attacker-controlled JS could have
  read arbitrary `$HOME` files.

### Fixed
- **Cold-start "Open With" silently dropped the file.** Double-
  clicking a `.md` in Finder while Nicer.md wasn't running raced the
  JS bundle's listener registration; the `RunEvent::Opened` emit
  fired into no listener and the file was lost. Added a Rust-side
  `PendingOpened` cache (mirrors deep-link plugin's `getCurrent()`
  pattern): paths arriving pre-bundle are queued; JS drains the
  queue and flips a `drained` flag once the listener is registered.
  Subsequent Opened events emit live as before.
- **`Cmd+R` reload had no dirty guard.** A misfire wiped any work
  not yet flushed by the 1.5s autosave debounce AND dropped the
  source path so the next Cmd+S became Save As. Now prompts before
  reloading if there are unsaved changes.
- **`Cmd+Q` bypassed each window's dirty guard.** Native macOS
  quit terminates `NSApp` directly, so per-window
  `WindowEvent::CloseRequested` listeners never fired. Multi-window
  users could silently lose unsaved work in every window. Replaced
  the predefined Quit menu item with a custom Quit that closes each
  window via `close()`, which DOES emit CloseRequested — so each
  realm gets its prompt. The existing last-window-quit cascade then
  exits the app once all windows are gone.
- **Pre-multi-window autosave snapshots never recovered after
  upgrade.** Pre-0.1.6 builds wrote to a bare `nicermd:autosave`
  key; the multi-window build moved to `nicermd:autosave:<label>`.
  Users mid-edit at upgrade time would see no recovery banner. The
  main window now migrates the bare snapshot into the labelled slot
  on first boot if present.

## 0.1.5 — 2026-05-19

### Added
- Per-language syntax highlighting in Code mode for `.py`, `.ts`,
  `.tsx`, `.js`, `.jsx`, `.json`, `.css`, `.html`, `.xml`, `.svg`.
  Each language pack lazy-loads so the bundle only grows with files
  the user actually opens. Token colours come from the same `--cm-*`
  CSS variables themes already drive.
- Source files in Read mode and all kinds in Code mode now use a
  centred ~900px container so long code lines breathe without
  sprawling flush-left on wide monitors. Markdown + plain text stay
  at the prose reading-width.

### Changed
- Mode 2 (Write) and Mode 3 (Split) are markdown-only. Hidden in the
  mode strip for non-markdown docs; the ⌘2 / ⌘3 shortcuts surface a
  discreet notice pointing at modes 1 + 4.
- Save / Open dialogs are content-kind aware. A `.py` opened by URL
  and edited in Mode 4 saves back as `.py` (not `.py.md`). Open
  dialog accepts every renderable source extension.

### Fixed
- Refresh on a URL-loaded doc no longer loses the content. The boot-
  URL gate now restores `?url=…` to the address bar after acceptance
  so refresh routes through the trusted-nav path.
- Source files in Code / Split modes had no syntax highlighting at
  all (uniform grey text). Resolved by the per-language packs above.

## 0.1.4 — 2026-05-19

### Added
- `nicermd://` deep-link URL scheme. The desktop app registers as the
  handler for `nicermd://` URLs, so the Chrome extension's *Open in
  Nicer.md desktop* path now routes from the browser into the app.
- Markdown-to-markdown link chaining in the reader. Clicking a `.md`
  link inside a rendered doc loads the new file in place (history-
  aware, back-button works); modifier-click opens in a new tab.

### Fixed
- README resolution now uses GitHub's `/repos/<u>/<r>/readme`
  endpoint, so repos with lowercase `readme.md` (or any other case
  variant) resolve correctly. Previously these surfaced as 404s.
