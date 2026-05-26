# Nicer.md

> **Alpha release** — early days, expect rough edges. Your data stays on your device; there's no server. [Report a bug on GitHub](https://github.com/nicermd/nicermd/issues).

A nicer, zero-server markdown reader. The page you're looking at is plain markdown. Switch to Write mode (`Ctrl/Cmd+2`) and edit it in place.

![Nicer.md cycling Read, Write, Split and Code modes, then switching from a light to a dark theme](https://nicer.md/media/screencap.gif)

## Try these first

- `Ctrl/Cmd+1`–`4` for Read / Write / Split / Code — or just click the mode icons, top-right.
- `Ctrl/Cmd+2` to enter Write mode, then click anywhere and type.
- `Ctrl/Cmd+S` saves local files back to where the file came from.
- `Ctrl/Cmd+O` to **O**pen a local file, or drop a `.md` / `.markdown` / `.mdx` file onto the window.
- `Ctrl/Cmd+Alt+O` to **O**pen a URL — raw GitHub, gists, or `github.com/user/repo` for the README.
- `Ctrl/Cmd+Alt+T` to switch theme. `Ctrl/Cmd+Alt+F` for fonts.
- `Ctrl/Cmd+K` for the command palette — the fastest way to find everything else.

In a browser tab, your browser may grab the number shortcuts for switching tabs — the mode icons and the command palette always work. The desktop app has every shortcut to itself.

## Take it with you

- **macOS** — `brew install --cask nicermd/tap/nicermd`, or grab the [universal DMG](https://github.com/nicermd/nicermd/releases/latest).
- **Any browser** — install the [Chrome extension](https://github.com/nicermd/nicermd/tree/main/packages/chrome-ext#install-unpacked) (Chrome, Edge, Brave, Vivaldi, Arc), or add this page as a PWA from your browser's address-bar menu.
- **Windows / Linux** — native desktop builds aren't ready yet; [open an issue](https://github.com/nicermd/nicermd/issues) if you'd like one.

## Try it on a real document

- [Markdown Cheatsheet](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fwiki%2Fadam-p%2Fmarkdown-here%2FMarkdown-Cheatsheet.md) — adam-p/markdown-here
- [Awesome](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsindresorhus%2Fawesome%2Fmain%2Freadme.md) — sindresorhus/awesome
- [Tauri README](?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftauri-apps%2Ftauri%2Fdev%2FREADME.md) — tauri-apps/tauri
- [Nx README](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fnrwl%2Fnx%2Fmaster%2FREADME.md) — nrwl/nx (showcases dark-mode-aware `<picture>` images)

Or read the docs of the libraries that power Nicer.md itself:

- [markdown-it](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmarkdown-it%2Fmarkdown-it%2Fmaster%2FREADME.md) — the parser behind every mode
- [DOMPurify](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcure53%2FDOMPurify%2Fmain%2FREADME.md) — the HTML sanitiser
- [Tiptap](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fueberdosis%2Ftiptap%2Fmain%2FREADME.md) — the rich-text editor in Write mode
- [CodeMirror](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcodemirror%2Fdev%2Fmain%2FREADME.md) — the editor in Code and Split modes
- [Vitest](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fvitest-dev%2Fvitest%2Fmain%2FREADME.md) — the test runner behind every release
- [Vite](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fvitejs%2Fvite%2Fmain%2FREADME.md) — the build tool that ships this page

## Project docs

The project's own docs, all rendered in this very app:

- [README](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fnicermd%2Fnicermd%2Fmain%2FREADME.md) — what this is and how to run it
- [Shortcuts](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fnicermd%2Fnicermd%2Fmain%2FSHORTCUTS.md) — the full keyboard reference
- [Architecture](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fnicermd%2Fnicermd%2Fmain%2FARCHITECTURE.md) — module boundaries and rationale
- [Security](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fnicermd%2Fnicermd%2Fmain%2FSECURITY.md) — threat model and disclosure process
- [Known issues](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fnicermd%2Fnicermd%2Fmain%2FKNOWN-ISSUES.md) — open bugs and recent fixes
- [Backlog](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fnicermd%2Fnicermd%2Fmain%2FBACKLOG.md) — deferred work, candidates for future commits
- [Changelog](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fnicermd%2Fnicermd%2Fmain%2FCHANGELOG.md) — version history
- [Contributing](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fnicermd%2Fnicermd%2Fmain%2FCONTRIBUTING.md) — how to file bugs and feature requests
- [Testing](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fnicermd%2Fnicermd%2Fmain%2FTESTING.md) — platform variants and other test scenarios
- [Privacy](/privacy) — what the extension and site access (spoiler: nothing leaves your device)
- [License](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fnicermd%2Fnicermd%2Fmain%2FLICENSE) — MIT
- [Third-party licenses](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fnicermd%2Fnicermd%2Fmain%2FTHIRD-PARTY-LICENSES.md) — every bundled dependency and its license

## What this is

- **No server.** Everything runs in your browser. No accounts, no uploads, no telemetry.
- **One file.** What you see is what's in the document. No hidden state.
- **One pane.** Read and edit in the same place. No preview toggle.

> The best markdown reader is the one you forget is there.

## Formatting at a glance

Write **bold** with `**asterisks**`, *italic* with `*one*`, ~~strikethrough~~ with `~~tildes~~`, and inline code with `` `backticks` ``. Combine them however you like — ***bold italic***, or [a link that's also **strong**](https://nicer.md).

Headings go six levels deep. Lists nest cleanly:

1. First step
2. Second step
   - A nested thought
   - Another
3. Third step

- [x] Render markdown nicely
- [x] Inline rich-text editing
- [x] Save back to file

Tables align:

| Shell    | Audience              |
|:---------|:---------------------:|
| Website  | Anyone with a browser |
| Desktop  | macOS users (Tauri)   |

Fenced code blocks:

```typescript
import { render } from 'nicermd-core'

export function preview(source: string): string {
  return render(source)
}
```

Blockquotes for asides:

> Markdown is the thinnest layer between writing and publishing. It outlives frameworks because it's barely there.

A horizontal rule —

---

## Make it yours

Select all (`Cmd+A`), delete, and paste or write your own markdown. The canvas is yours.
