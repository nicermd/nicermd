# Third-party licenses

Nicer.md ships with code from the following open-source projects. This file
is a hand-maintained placeholder — the build pipeline will eventually
auto-generate the full attribution list with verbatim license texts via
`license-checker` or equivalent before the first public release.

The list below names every dependency whose code is bundled into the shipped
artifacts (browser bundle, Tauri app, npm packages). Build-only tooling
(`vite`, `tsup`, `typescript`, `@tauri-apps/cli`) is not redistributed and
is omitted.

## Core renderer (`nicermd-core`)

| Package | License |
|---------|---------|
| [markdown-it](https://github.com/markdown-it/markdown-it) | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) | Apache-2.0 OR MPL-2.0 |

## Website / desktop shell

| Package | License |
|---------|---------|
| [CodeMirror 6](https://codemirror.net) (`@codemirror/*`, `codemirror`) | MIT |
| [Lezer](https://lezer.codemirror.net) (`@lezer/*`) | MIT |
| [Tiptap](https://tiptap.dev) (`@tiptap/core`, `@tiptap/starter-kit`, table extensions, `@tiptap/pm`) | MIT |
| [tiptap-markdown](https://github.com/aguingand/tiptap-markdown) | MIT |
| [Tauri](https://tauri.app) (`@tauri-apps/api`, `plugin-dialog`, `plugin-fs`) | MIT OR Apache-2.0 |

## Pending

- Full verbatim license texts will be appended (or shipped as `licenses.txt`
  alongside the bundle) before any public binary distribution.
- `dompurify`'s dual-license obligation is satisfied by including the
  Apache-2.0 license text; the MPL-2.0 alternative is documented for
  redistributors who prefer it.
- Fonts loaded at runtime (Outfit, Fraunces, JetBrains Mono, etc. — see
  the font picker for the full list) are served from Google Fonts and
  carry their own SIL Open Font License terms; if/when fonts get bundled
  for offline use, their license texts join this file.
