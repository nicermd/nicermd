# Changelog

This file follows [Keep a Changelog](https://keepachangelog.com)
format and [Semantic Versioning](https://semver.org). The public
alpha shipped at 0.1.3 on 2026-05-17; for development history up
to that point, see `git log`. Versioned entries start from the
next release.

## Unreleased

- See `git log` for the running list of changes on `main`.

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
