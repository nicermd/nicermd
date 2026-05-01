# Nicer.md

A nicer, zero-server markdown reader. Read, write, and save markdown — beautifully, in the same pane, with no server.

**Status:** v0.1 alpha. Live at [nicer.md](https://nicer.md).

## Download

- **Web** — [nicer.md](https://nicer.md). Installable as a PWA (click the install icon in your browser's address bar).
- **macOS** — [latest release on GitHub](https://github.com/isherlock/nicermd/releases?q=tauri). Universal binary (Apple Silicon + Intel). The build is currently unsigned — on first launch macOS will show a Gatekeeper warning; right-click the app → **Open** → **Open** in the dialog to bypass it. Subsequent launches work normally.
- **Windows / Linux** — not yet built. Open an issue if you want one.

## What it does

One rendering core, multiple thin shells. Everything runs on the user's device — no backend, no database, no telemetry.

- **Read** — GFM tables, task lists, fenced code, strikethrough, GitHub-style heading anchors. Strict sanitization (DOMPurify allow-list, no inline HTML).
- **Write** — click anywhere, type. WYSIWYG editing in the same pane via Tiptap; markers vanish but the underlying markdown stays intact.
- **Split / Code** — source + live preview, or raw markdown with byte-level fidelity.
- **Save** — File System Access API in browsers, native dialogs in the desktop shell, drag-drop in both.
- **Open URL** — load markdown from raw GitHub, gists, or `github.com/user/repo` for the README, with a phishing-gate confirmation.

## Packages

- **`packages/core`** — `nicermd-core`. The rendering engine. Markdown string in, sanitized HTML out. No framework dependency, no DOM assumption, no network calls.
- **`packages/website`** — Vite + TypeScript + CodeMirror 6 + Tiptap. Also wraps as a Tauri 2 desktop app via `packages/website/src-tauri`.

## Development

Requires Node.js 20+ and [pnpm](https://pnpm.io) (`corepack enable` if Node 20+ is already installed).

```bash
pnpm install
pnpm dev           # build core + run website dev server (http://localhost:3333)
pnpm build         # production build for all packages
pnpm typecheck     # type-check all packages
```

For active work on the core alongside the website, use two terminals:

```bash
pnpm dev:core      # tsup watch-mode on the core
pnpm dev:website   # vite dev server on the website
```

The desktop shell:

```bash
pnpm --filter nicermd-website tauri:dev               # dev window
pnpm --filter nicermd-website tauri:build             # production .app + .dmg (current arch)
pnpm --filter nicermd-website tauri:build:universal   # universal binary (Apple Silicon + Intel)
```

The universal build needs both Rust targets installed:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

## Releasing

Macros for the Tauri release flow:

```bash
pnpm version:bump 0.2.0       # bumps tauri.conf.json + APP_VERSION label
pnpm release:tauri --dry-run  # builds universal DMG, skips publish
pnpm release:tauri            # builds + uploads to GitHub Releases (needs `gh auth`)
```

Builds are unsigned (Layer 1 distribution). For signed + notarized builds you'll need an Apple Developer account; see [BACKLOG.md](./BACKLOG.md) for the deferred Layer 2 work.

When the release contains UI / CSS / SW changes, also bump `CACHE_VERSION` in `packages/website/public/sw.js` so the new SW activates and drops the old cache.

## Project docs

- [SHORTCUTS.md](./SHORTCUTS.md) — full keyboard reference
- [ARCHITECTURE.md](./ARCHITECTURE.md) — module boundaries and rationale (placeholder)
- [SECURITY.md](./SECURITY.md) — threat model, sanitization defaults, coordinated disclosure
- [BACKLOG.md](./BACKLOG.md) — deferred work and candidates
- [KNOWN-ISSUES.md](./KNOWN-ISSUES.md) — open bugs and recent fixes
- [CHANGELOG.md](./CHANGELOG.md) — version history (placeholder)
- [CONTRIBUTING.md](./CONTRIBUTING.md) — how to file bugs and feature requests
- [LICENSE.md](./LICENSE.md) — MIT
- [THIRD-PARTY-LICENSES.md](./THIRD-PARTY-LICENSES.md) — bundled dependency attributions

## License

[MIT](./LICENSE.md). For bundled third-party libraries, see [THIRD-PARTY-LICENSES.md](./THIRD-PARTY-LICENSES.md).
