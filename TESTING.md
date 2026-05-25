# Testing

Quick links for exercising platform variants and other content paths
without typing query strings into the address bar. Links here use
relative `?param=…` form so they work against whatever host loaded
this doc — production at nicer.md, preview deploys, or local dev.

## Homepage platform variants

The homepage (`/`) auto-detects platform from `navigator.userAgent`
(or `userAgentData.platform`). The `?platform=` query param overrides
that detection for testing.

- [Mac](?platform=mac) — `Cmd` shortcuts, `brew install --cask` + DMG CTA
- [Windows](?platform=win) — `Ctrl` shortcuts, Chrome extension + PWA CTA
- [Linux](?platform=linux) — `Ctrl` shortcuts, Chrome extension + PWA CTA
- [Auto-detect](/) — clears the override; takes you back to the
  clean homepage with default detection

## How platform-conditional blocks work

The boot doc (`packages/website/src/samples/showcase.md`) uses
HTML-comment fences:

```md
<!-- :platform mac -->
Mac-only content.
<!-- :end -->

<!-- :platform win linux -->
Non-Mac content.
<!-- :end -->
```

`stripPlatformBlocks` in
[`packages/website/src/platform-blocks.ts`](https://github.com/nicermd/nicermd/blob/main/packages/website/src/platform-blocks.ts)
removes non-matching blocks before the markdown reaches the
renderer. Tests live alongside in `platform-blocks.test.ts`.

The boot pipeline (in `main.ts`) is:

1. `stripPlatformBlocks(showcase, PLATFORM)` — drop other-platform sections.
2. On non-Mac, rewrite `Cmd+` → `Ctrl+` inside inline code spans.

Only the built-in landing doc is touched; user-loaded markdown
(via `?url=…`, drag-drop, file-open) renders as-authored.

## Adding more test scenarios

Drop another `## Section` here for any other content paths worth
clicking through — error states, edge-case markdown, themes, etc.
This file lives at `TESTING.md` in the nicermd repo root and loads
via `?url=…` from the homepage's Project docs list.
