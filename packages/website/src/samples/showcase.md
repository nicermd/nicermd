# Nicer.md

A nicer, zero-server markdown reader. The page you're looking at is plain markdown. Switch to Write mode Cmd+2 and edit it in place.

## Try these first

- `Cmd+1` to `Cmd+4` to Read / Write / Split / Code. Mode icons are top-right.
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

## What this is

- **No server.** Everything runs in your browser. No accounts, no uploads, no telemetry.
- **One file.** What you see is what's in the document. No hidden state.
- **One pane.** Read and edit in the same place. No preview toggle.

> "The best markdown reader is the one you forget is there."

## Formatting at a glance

Write **bold** with `**asterisks**`, *italic* with `*one*`, ~~strikethrough~~ with `~~tildes~~`, and inline code with `` `backticks` ``. Combine them however you like — ***bold italic***, or [a link that's also **strong**](https://nicermd.com).

Headings go six levels deep. Lists nest cleanly:

1. First step
2. Second step
   - A nested thought
   - Another
3. Third step

- [x] Render markdown beautifully
- [x] Inline rich-text editing
- [ ] Save back to file
- [ ] Chrome extension

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
