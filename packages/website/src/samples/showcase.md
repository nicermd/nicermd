# Nicer.md

> **Alpha release** — early days, expect rough edges. Your data stays on your device; there's no server. [Report a bug on GitHub](https://github.com/isherlock/nicermd/issues).

A nicer, zero-server markdown reader. The page you're looking at is plain markdown. Switch to Write mode Cmd+2 and edit it in place.

## Try these first

- `Cmd+1` to `Cmd+4` to Read / Write / Split / Code (Safari: hold `Ctrl` instead). Mode icons are top-right.
- `Cmd+2` to enter Write mode, then click anywhere and type.
- `Cmd+S` saves local files back to where the file came from.
- `Cmd+O` to **O**pen a local file, or drop a `.md` / `.markdown` / `.mdx` file onto the window.
- `Cmd+Alt+O` to **O**pen a URL, raw GitHub, gists, or `github.com/user/repo` for README.
- `Cmd+Alt+T` to switch theme. `Cmd+Alt+F` for fonts.
- `Cmd+K` for command palette. The fastest way to find everything else.

## Try it on a real document

- [Markdown Cheatsheet](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fwiki%2Fadam-p%2Fmarkdown-here%2FMarkdown-Cheatsheet.md) — adam-p/markdown-here
- [Awesome](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsindresorhus%2Fawesome%2Fmain%2Freadme.md) — sindresorhus/awesome
- [Tauri README](?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftauri-apps%2Ftauri%2Fdev%2FREADME.md) — tauri-apps/tauri

Or read the docs of the libraries that power Nicer.md itself:

- [markdown-it](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmarkdown-it%2Fmarkdown-it%2Fmaster%2FREADME.md) — the parser behind every mode
- [DOMPurify](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcure53%2FDOMPurify%2Fmain%2FREADME.md) — the HTML sanitiser
- [Tiptap](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fueberdosis%2Ftiptap%2Fmain%2FREADME.md) — the rich-text editor in Write mode
- [CodeMirror](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcodemirror%2Fdev%2Fmain%2FREADME.md) — the editor in Code and Split modes
- [Vitest](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fvitest-dev%2Fvitest%2Fmain%2FREADME.md) — the test runner behind every release
- [Vite](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fvitejs%2Fvite%2Fmain%2FREADME.md) — the build tool that ships this page

## Project docs

The project's own docs, all rendered in this very app:

- [README](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fisherlock%2Fnicermd%2Fmain%2FREADME.md) — what this is and how to run it
- [Shortcuts](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fisherlock%2Fnicermd%2Fmain%2FSHORTCUTS.md) — the full keyboard reference
- [Architecture](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fisherlock%2Fnicermd%2Fmain%2FARCHITECTURE.md) — module boundaries and rationale
- [Security](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fisherlock%2Fnicermd%2Fmain%2FSECURITY.md) — threat model and disclosure process
- [Known issues](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fisherlock%2Fnicermd%2Fmain%2FKNOWN-ISSUES.md) — open bugs and recent fixes
- [Backlog](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fisherlock%2Fnicermd%2Fmain%2FBACKLOG.md) — deferred work, candidates for future commits
- [Changelog](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fisherlock%2Fnicermd%2Fmain%2FCHANGELOG.md) — version history
- [Contributing](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fisherlock%2Fnicermd%2Fmain%2FCONTRIBUTING.md) — how to file bugs and feature requests
- [License](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fisherlock%2Fnicermd%2Fmain%2FLICENSE) — MIT
- [Third-party licenses](?url=https%3A%2F%2Fraw.githubusercontent.com%2Fisherlock%2Fnicermd%2Fmain%2FTHIRD-PARTY-LICENSES.md) — every bundled dependency and its license

## What this is

- **No server.** Everything runs in your browser. No accounts, no uploads, no telemetry.
- **One file.** What you see is what's in the document. No hidden state.
- **One pane.** Read and edit in the same place. No preview toggle.

> "The best markdown reader is the one you forget is there."

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

| Shell             | Audience              |
|:------------------|:---------------------:|
| Website           | Anyone with a browser |
| Chrome extension  | Everyday browsing     |
| VS Code extension | Developers            |
| iOS app           | Mobile reading        |

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
