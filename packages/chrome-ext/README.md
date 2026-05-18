# Nicer.md Chrome extension

Send any GitHub markdown URL to [Nicer.md](https://nicer.md) without
leaving the page you're on. Three invocation paths, one tiny extension.

## Use

**Open in the web app** (`https://nicer.md`):

- **Toolbar icon** — click the Nicer.md icon; the current page
  opens in a new Nicer.md tab.
- **Right-click menu** — *Open in Nicer.md* appears on links
  (sends the link URL) and on empty page area (sends the current
  page URL).
- **Keyboard shortcut** — `Alt+Shift+N` (Option+Shift+N on macOS)
  fires the toolbar action from any tab. Rebind at
  `chrome://extensions/shortcuts` under *Open this page in
  Nicer.md* if you'd prefer a different chord.

These paths open a new tab at `https://nicer.md/?url=<encoded-url>`.
Nicer.md validates the URL (GitHub family only —
`github.com`, `raw.githubusercontent.com`, `gist.github.com`,
`gist.githubusercontent.com`), shows a one-time phishing-gate
confirmation, then renders the markdown.

**Open in the desktop app** (requires Nicer.md macOS app
installed):

- **Right-click menu** — *Open in Nicer.md desktop* on links and
  pages. Navigates the browser to a `nicermd://` URL; the OS
  routes that to the installed app, which loads the markdown in
  its own window. The browser shows a one-time "Open Nicer.md?"
  confirmation the first time per origin (standard custom-
  protocol behaviour); subsequent invocations on the same origin
  can be remembered ("always allow").

## Install (unpacked)

Until the Web Store version lands, the extension installs unpacked
from a downloaded `.zip` (no `git clone` needed):

1. Download
   [`nicermd-chrome-ext.zip`](https://github.com/nicermd/nicermd/releases/latest/download/nicermd-chrome-ext.zip)
   from the latest GitHub release.
2. Unzip it (Finder / Explorer / Files default unzip is fine).
3. Visit `chrome://extensions` in Chrome (also works in Chromium-
   based browsers: Edge, Brave, Arc, Vivaldi).
4. Turn on **Developer mode** (toggle in the top-right corner).
5. Click **Load unpacked** and select the unzipped folder.

## Permissions

Two narrow extension permissions, plus a one-way messaging channel
with `nicer.md`:

- **`contextMenus`** — required to register the right-click items.
- **`activeTab`** — granted *only* when you click the toolbar icon
  or fire the keyboard shortcut, and only for that single
  invocation. Lets the extension read the active tab's URL at the
  moment you ask for it.
- **`externally_connectable: https://nicer.md/*`** — the *only*
  origin that can talk to this extension. Used so the page can ask
  for the URL behind a one-time pickup token (see below); the
  extension responds with that URL and nothing else.

No host permissions. No content script. No page DOM access. No
storage. No telemetry.

## How the gate-skip works (web flow)

Without messaging, a click on the extension's toolbar / right-click
item would arrive at `nicer.md` looking identical to a share-link
arrival, so the page would show its phishing-gate modal — friction
on every click. To avoid that, the web flow uses a one-time pickup
token:

1. Click the toolbar / right-click item.
2. The extension generates a random UUID, stashes
   `token → <your URL>` in service-worker memory, opens
   `nicer.md/?ext-pickup=<token>`.
3. Nicer.md sees the token, sends a `runtime.sendMessage` to this
   extension's specific ID asking *"what URL do you have for this
   token?"*.
4. Extension consumes the token (one-time use) and replies with the
   URL.
5. Nicer.md loads that URL directly — no gate.

A forged or copy-pasted token matches nothing in the extension's
memory; nicer.md silently falls back to its default boot doc. Only
nicer.md can ask the extension this question (cross-origin pages
are blocked by `externally_connectable`). Tokens expire after 30
seconds even if unused.

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
