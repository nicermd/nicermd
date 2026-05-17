# Architecture

Nicer.md is **one rendering core surrounded by thin shells**. The core (`nicermd-core`) is a pure function from markdown-string to sanitised-HTML, framework-free, with two runtime dependencies. Every shell — the website, the Tauri desktop app, future Chrome / VS Code / iOS shells — calls into it the same way. No shell renders markdown directly.

This shape exists for a few reasons:

- **One place where security lives.** Rendering untrusted markdown is the project's primary attack surface. Concentrating sanitisation in `nicermd-core` means every shell inherits the same defences without having to re-implement them. See [SECURITY.md](./SECURITY.md) for the threat model and the layered defence (inline-tag allowlist plus DOMPurify final pass with strict tag/attribute/URI allowlists).
- **No platform lock-in.** Markdown rendering is the product. The shells are distribution vehicles. If a platform's UI conventions or APIs change, only that shell adapts; the core is untouched.
- **Bundle size is honest.** The core is tiny (~6KB ESM + DOMPurify + markdown-it + plugins). Most of any shell's bundle is editor / UI code — none of which a pure reader needs.

## Repo layout

```
nicermd/
├── packages/
│   ├── core/       # nicermd-core — render(markdown, options) → string
│   └── website/    # the SPA at nicer.md, also wraps as Tauri 2 desktop
│       └── src-tauri/   # Rust + Tauri config for the macOS bundle
├── scripts/        # release helpers (bump-version, release-tauri)
└── samples/        # markdown test fixtures
```

pnpm workspaces. The website depends on `nicermd-core` via `workspace:*`. No npm-published packages today.

## The core

`packages/core/src/index.ts` exports a single function:

```ts
render(markdown: string, options?: RenderOptions): string
```

**Inside:**

1. `markdown-it` parses with `html: true`, `linkify: true`, `typographer: true`. The `html: true` is intentional — the lexer needs to recognise HTML constructs so we can intercept them at the renderer rather than letting them escape through as encoded text.
2. **Inline HTML is filtered** through a static allowlist (`br | kbd | sub | sup | mark`). Anything else is dropped silently.
3. **DOMPurify final pass** with an explicit tag allowlist, attribute allowlist, URI scheme allowlist (`https | http | mailto | # | ?` only — no `data:` anywhere; an `uponSanitizeAttribute` hook closes a DOMPurify v3 internal allow for data: URIs on `<img>`). Block-level HTML (`<div>`, `<details>`, etc.) flows through to this pass and is constrained to the allowed shapes.
4. **Heading anchors** generated GitHub-style (slugify with collision suffixes) so in-doc TOCs work.
5. **Relative URL rewriting** when a `baseUrl` is provided (URL-loaded docs resolve `images/logo.png` against the source URL).

Two runtime deps total: `markdown-it` + `dompurify`. Adding a third gets a code-review bar (see SECURITY.md "Supply chain posture").

The core has no DOM dependency. It returns a string. The shell decides what to do with it.

## The website shell

`packages/website/` is a Vite SPA in TypeScript. The same bundle is wrapped as a Tauri 2 desktop app via `src-tauri/`.

### Four modes, hot-swapped

A user-visible mode controls which editor surface is mounted. Modes 1–4 share a `Harness` interface (defined inline in `packages/website/src/main.ts`) that lets the active mode hand off the current markdown text to the next mode on switch:

| # | Name  | Editor                | Use                                       |
| - | ----- | --------------------- | ----------------------------------------- |
| 1 | Read  | none — rendered HTML  | Reading                                   |
| 2 | Write | Tiptap (lazy)         | WYSIWYG; markers vanish, markdown intact  |
| 3 | Split | CodeMirror + preview  | Source + live render side-by-side         |
| 4 | Code  | CodeMirror, raw       | Byte-preserving source view               |

Switching is a destroy-and-mount, not a state machine: each mode stores a `getMarkdown()` and a `destroy()`, the harness captures text via the former before calling the latter, then mounts the next mode with that text. This keeps each mode's lifecycle simple and the round-trip text-only.

Mode 2 (Tiptap) is in a separate lazy chunk (`wysiwyg-engine.ts`) — about 135 KB gzipped — so users who only read never download it.

### Rendering goes through the core

Modes 1 and 3 call `render()` from `nicermd-core` directly. Mode 2 (Tiptap) maintains its own document model but commits back to markdown via `tiptap-markdown` on every change; the markdown is then rendered through `nicermd-core` for the preview pane in mode 3 and for save-to-disk.

### File I/O

`packages/website/src/doc-source.ts` is the abstraction over "where did this text come from / where does Save write to". Three sources today:

- `tauri-path` — local file via Tauri's `plugin-fs`. Used for native open / save / save-as and for OS-level "Open With" / file double-click (which Rust forwards via `RunEvent::Opened`).
- `fsa` — File System Access API, for browsers that support it.
- `null` — anonymous (a scratch buffer or URL-loaded doc with no writable target). Save falls through to Save As.

URL-loaded docs (`?url=…`) are read-only; the source URL is recorded but Save behaves as if `null`.

### URL loader

`packages/website/src/url-open.ts` is the single entry point for fetching markdown from a URL. The parser is the SSRF gate — it accepts only `github.com`, `www.github.com`, `gist.github.com`, `raw.githubusercontent.com`, `gist.githubusercontent.com`. Bare-repo / tree URLs synthesise `README.md`. Redirects are blocked (`fetch(url, { redirect: 'error' })`). Body capped at 5 MiB. Display names are sanitised (control chars, zero-width, bidi-override stripped, length capped at 80) — phishing-aid hardening, not XSS.

Boot-time `?url=…` fires a phishing gate (default action: Cancel) before any fetch.

### Theming

Themes are CSS custom properties in `main.css` under `[data-theme="…"]` blocks. Switching is one attribute flip on `<html>`. CodeMirror's editor theme references the same `--cm-*` vars, so the swap reaches both prose and code surfaces with no Compartment dispatch.

`packages/website/src/themes.ts` holds the registry: slug + display name + light/dark mode + optional `inspiredBy` attribution + optional default font pairings. `applyTheme(slug, persist)` flips the attribute and updates localStorage; `?option=N` and the theme picker call it without persisting for live preview. (As of `ee935bb`, the picker no longer live-previews on selection — that was a strobe across 14+ themes; click or Enter commits.)

### Build provenance

Vite's `define` block injects the git SHA + ISO timestamp at build time (`packages/website/vite.config.ts`). `version.ts` re-exports them; the corner-badge popover renders `v<semver> alpha · <sha> · <date>` in a muted meta line, with the SHA linking to the GitHub commit. Useful for "is this deploy the latest?" without DevTools.

### Service worker

`packages/website/public/sw.js`. Registered web-only (skipped in Tauri and in dev). Two strategies:

- **Navigation requests (HTML):** network-first, cache as offline fallback. Stale HTML would reference hashed bundle names the new deploy no longer serves; network-first keeps users on the latest.
- **Everything else same-origin:** stale-while-revalidate. Hashed bundles are immutable; cache-first is correct.

Cross-origin requests pass through untouched — never cached, never mediated. Keeps the cache surface narrow and matches the strict-CSP posture.

`CACHE_VERSION` (in `sw.js`) is bumped on each release; activate drops any `nicermd-*` cache that doesn't match.

### CSP

Both shells run a strict CSP. Highlights:

- No `'unsafe-eval'` anywhere; no `'unsafe-inline'` on `script-src`.
- `style-src 'unsafe-inline'` is permitted — CodeMirror's gutter relies on inline styles. Tightening this is on [BACKLOG.md](./BACKLOG.md).
- `connect-src` enumerates exactly the URL-loader hosts; any new external host requires a CSP update.
- The web shell's CSP is in `packages/website/public/_headers` (Cloudflare Workers reads it). The Tauri CSP is in `packages/website/src-tauri/tauri.conf.json` `app.security.csp` and shares the same posture, with one extra clause for IPC.

## The Tauri shell

`packages/website/src-tauri/` adds a thin Rust wrapper:

- A native macOS menu (File / Edit / View / Window) emits events the web frontend listens for via `@tauri-apps/api/event`. Rust holds no document state.
- `tauri-plugin-fs` + `tauri-plugin-dialog` for native file I/O.
- `RunEvent::Opened` handler forwards OS-level file-open events (Open With, double-click, Dock drag-drop) as `menu:file-open-path` events with the file path.
- `WindowEvent::CloseRequested` calls `app_handle.exit(0)` — the red traffic light fully quits, since this is a single-window app and macOS's "keep running with no windows" convention surprises users here.

`fs:scope` is currently `**` (entire filesystem) — defended in depth by upstream rendering sanitisation. Tightening to runtime scope authorisation tied to dialog-returned paths is in [BACKLOG.md](./BACKLOG.md) under Tauri hardening.

The bundle uses `titleBarStyle: "Overlay"` + `hiddenTitle: true` so our `.window-title` strip becomes the title bar. `dragDropEnabled: false` disables OS-level drag-drop in favour of the web-shell HTML5 drag-drop, so dropped files go through the same `doc-source` path as native open.

## What we're not building (yet)

Listed in [README.md](./README.md) under the original four-shell plan — Chrome extension, VS Code extension, iOS app, CLI. None are roadmap promises; they're slots in the architecture. The repo will pick one up when there's user pull, not before.
