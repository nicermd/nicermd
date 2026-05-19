# Changelog

This file follows [Keep a Changelog](https://keepachangelog.com)
format and [Semantic Versioning](https://semver.org). The public
alpha shipped at 0.1.3 on 2026-05-17; for development history up
to that point, see `git log`. Versioned entries start from the
next release.

## Unreleased

- See `git log` for the running list of changes on `main`.

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
