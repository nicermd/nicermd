# Testing

Quick links for exercising content paths without typing query strings
into the address bar. Links here use relative `?param=…` form so they
work against whatever host loaded this doc — production at nicer.md,
preview deploys, or local dev.

## Platform detection

The homepage is **static plain markdown** — it no longer changes
content by platform. Shortcuts are labelled `Ctrl/Cmd+…` (the mode
handler accepts either modifier), and the install section lists every
platform. So there's nothing platform-specific to preview on the
showcase itself.

`?platform=mac|win|linux` still overrides detection for the in-app
shortcut chips (command palette, format bar), which render `⌘` vs
`Ctrl` glyphs:

- [Mac](?platform=mac) — `⌘` glyphs in palette / format-bar chips
- [Windows](?platform=win) — `Ctrl` glyphs
- [Linux](?platform=linux) — `Ctrl` glyphs
- [Auto-detect](/) — clears the override

Detection source: `userAgentData.platform` → `navigator.platform` →
`linux` fallback (see `packages/website/src/platform.ts`).

## Browser tab-switch caveat

In a browser, number+modifier shortcuts collide with tab switching:
Mac browsers reserve `Cmd+1..8`, Windows/Linux browsers reserve
`Ctrl+1..8`. So the `Ctrl/Cmd+1..4` mode shortcuts are reliable only
in the **desktop app**; in the web shell the mode icons (top-right)
and command palette (`Ctrl/Cmd+K`) are the always-works paths.

## Adding more test scenarios

Drop another `## Section` here for any other content paths worth
clicking through — error states, edge-case markdown, themes, etc.
This file lives at `TESTING.md` in the nicermd repo root and loads
via `?url=…` from the homepage's Project docs list.
