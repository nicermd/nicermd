# Nicer.md Chrome extension

Send any GitHub markdown URL to [Nicer.md](https://nicer.md) without
leaving the page you're on. Three invocation paths, one tiny extension.

## Use

- **Toolbar icon** — click the Nicer.md icon in the toolbar; the
  current page opens in a new Nicer.md tab.
- **Right-click menu** — *Open in Nicer.md* appears on links (sends
  the link URL) and on empty page area (sends the current page URL).
- **Keyboard shortcut** — unassigned by default; bind one at
  `chrome://extensions/shortcuts` (entry: *Open this page in
  Nicer.md*) if you want a keystroke alternative.

All three paths open a new tab at `https://nicer.md/?url=<encoded-url>`.
Nicer.md validates the URL (GitHub family only —
`github.com`, `raw.githubusercontent.com`, `gist.github.com`,
`gist.githubusercontent.com`), shows a one-time phishing-gate
confirmation, then renders the markdown.

## Install (unpacked)

Until the Web Store version lands, the extension can be loaded
unpacked from a local clone of the repo:

1. `git clone https://github.com/nicermd/nicermd.git`
2. Visit `chrome://extensions` in Chrome (also works in Chromium-
   based browsers: Edge, Brave, Arc, Vivaldi).
3. Turn on **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select `packages/chrome-ext/` from
   your clone.

## Permissions

Only two, both narrow:

- **`contextMenus`** — required to register the right-click items.
- **`activeTab`** — granted *only* when you click the toolbar icon
  or fire the keyboard shortcut, and only for that single
  invocation. Lets the extension read the active tab's URL at the
  moment you ask for it.

No host permissions. No content script. No page DOM access. No
storage. No telemetry.

## Bookmarklet alternative

If you're on a non-Chromium browser (Safari, Firefox), the same
flow works as a bookmarklet — see the [main README](../../README.md)
for the one-liner.

## Roadmap

A fuller extension that **auto-detects** GitHub markdown URLs and
renders them in-tab (replacing GitHub's own rendering, no nicer.md
round-trip) is in [`BACKLOG.md`](../../BACKLOG.md) under "Browser
integration". The current extension is the minimum viable lane:
three explicit invocation paths, zero JavaScript injected into
pages.
