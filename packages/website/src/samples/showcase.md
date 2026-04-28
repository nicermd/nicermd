# Nicer.md

A beautiful, zero-server markdown reader — and the page you're looking at is editable in place.

Every heading, list, quote, and table below is plain markdown. Click anywhere and start typing: it behaves like a rich-text editor, but the underlying document stays as markdown you can save, share, or paste anywhere else.

## Keyboard shortcuts

`Cmd` is shown for macOS — substitute `Ctrl` on Windows / Linux. The **Overrides** column flags shortcuts that replace a browser default.

### Modes

| Shortcut          | Action                  | Overrides                  |
|-------------------|-------------------------|----------------------------|
| `Cmd` + `1`       | Read                    | Chrome's "switch to tab 1" |
| `Cmd` + `2`       | Write                   | Chrome's "switch to tab 2" |
| `Cmd` + `3`       | Split                   | Chrome's "switch to tab 3" |
| `Cmd` + `4`       | Code                    | Chrome's "switch to tab 4" |
| `Cmd` + `Return`  | Toggle Read ↔ Write (jumps to Write from Split / Code) | — |
| `Cmd+Shift` + `M` | Cycle modes 1 → 2 → 3 → 4 → 1 | —                  |

### File

| Shortcut            | Action                                         | Overrides                |
|---------------------|------------------------------------------------|--------------------------|
| `Cmd` + `O`         | Open a `.md` file                              | Browser's "open file URL" |
| `Cmd` + `S`         | Save back to the file's source                 | Browser's "save page as" |
| `Cmd+Shift` + `S`   | Save As — always opens the save dialog         | —                        |
| `Cmd` + `N`         | New empty document (Tauri menu only — browsers reserve `Cmd+N` for new window) | — |

Drop a `.md` / `.markdown` / `.mdx` file onto the window to load it.

### View

| Shortcut            | Action                                                  | Overrides                |
|---------------------|---------------------------------------------------------|--------------------------|
| `Cmd+Shift` + `F`   | Fullscreen toggle (native macOS fullscreen in Tauri)    | —                        |
| `Cmd` + `R`         | Reload the window                                       | Restores browser's reload (Tauri doesn't bind it natively) |
| `Cmd` + `=` / `-` / `0` | Zoom in / out / reset (Tauri only — browsers handle natively) | Matches browser zoom in Tauri |

### Theme

| Shortcut             | Action                                              | Overrides |
|----------------------|-----------------------------------------------------|-----------|
| `Cmd+Alt` + `T`      | Open theme picker (arrows preview, Enter commits, Esc reverts) | — |
| `Cmd` + `\`          | Swap to previously-committed theme (bounce between the two most recent — handy for light ↔ dark) | — |

`Cmd+Alt+T` over `Cmd+Shift+T` because Chrome reserves the latter for "reopen closed tab" and `preventDefault` cannot override it.

### Editing — mode 2 (Write)

The format bar at the bottom-middle expands when you move the mouse near it. These are the keyboard equivalents:

| Shortcut             | Action            | Overrides |
|----------------------|-------------------|-----------|
| `Cmd` + `B`          | Bold              | Chrome's "show bookmarks bar" (only when editor focused) |
| `Cmd` + `I`          | Italic            | — |
| `Cmd` + `E`          | Inline code       | — |
| `Cmd+Alt` + `1`      | Heading 1         | — |
| `Cmd+Alt` + `2`      | Heading 2         | — |
| `Cmd+Shift` + `7`    | Numbered list     | — |
| `Cmd+Shift` + `8`    | Bullet list       | — |
| `Cmd+Shift` + `B`    | Blockquote        | — |

Standard `Cmd+Z` / `Cmd+Shift+Z` undo/redo, `Cmd+X/C/V` cut/copy/paste, and `Cmd+A` select-all all work as expected in the editing modes (2, 3, 4).

## What this is

- **No server.** Everything runs in your browser. No accounts, no uploads, no telemetry.
- **One file.** What you see is what's in the document. No hidden formatting, no proprietary state.
- **One pane.** Read and edit in the same place. No preview toggle, no split view.

> "The best markdown reader is the one you forget is there."

## Text formatting

Write **bold** with `**two asterisks**`. *Italic* with `*one*`. ~~Strikethrough~~ with `~~two tildes~~`. Inline code with `` `backticks` ``.

Combine them however you like — ***bold italic***, `code with **bold** inside`, or [a link that's also **strong**](https://nicermd.com).

### Headings go six levels deep

`# Heading` to `###### Heading`. The visual scale should feel harmonious, not a step ladder.

#### Fourth-level heading
##### Fifth-level heading
###### Sixth-level heading

## Lists

Unordered lists nest cleanly:

- A first thing
- A second thing
- A third thing, with some depth
  - A nested thought
  - Another nested thought
    - Even deeper
- Back at the top level

Ordered lists renumber themselves:

1. First step
2. Second step
3. Third step
   1. A detour
   2. Another detour
4. Fourth step

Task lists track progress:

- [x] Render markdown beautifully
- [x] Inline rich-text editing
- [ ] Theme switcher
- [ ] Save back to file
- [ ] URL-hash sharing
- [ ] Chrome extension

## Code

Inline: call `render(markdown)` to produce sanitized HTML.

Fenced block:

```typescript
import { render } from 'nicermd-core'

export function preview(source: string): string {
  return render(source)
}
```

Syntax highlighting via Shiki is on the roadmap — for now, code blocks are legible and visually distinct, just without colour.

## Tables

Tables support alignment:

| Shell | Audience | Where to get it |
|:------|:--------:|----------------:|
| Website | Anyone with a browser | nicermd.com |
| CLI | Developers, docs sites | `npm install -g nicermd` |
| Chrome extension | Everyday browsing | Chrome Web Store |
| VS Code extension | Developers | VS Code Marketplace |
| iOS app | Mobile reading | App Store |

Left-aligned, centred, right-aligned — set by `:---`, `:---:`, `---:` in the header separator.

## Blockquotes

Use them for quotes, callouts, or an aside:

> Markdown is the thinnest layer between writing and publishing.
> It outlives frameworks because it's barely there.

Nested quotes work too:

> A reply to the above —
>
> > which can itself contain another quote.

## Links and images

A regular link: [the Nicer.md site](https://nicermd.com).

An automatic URL: <https://nicermd.com>.

Images use the `![alt text](path)` syntax:

![Sample image](/sample-image.svg)

## Horizontal rules

Three or more dashes on their own line create a divider:

---

## What isn't here yet

Not every extension to markdown is supported in this first pane:

- **Footnotes** (`[^1]`) — planned
- **Math** (`$E = mc^2$` via KaTeX) — planned
- **Syntax highlighting** in code blocks — planned (Shiki)
- **Embedded diagrams** (Mermaid, PlantUML) — maybe later
- **Raw HTML** — deliberately blocked, for security

## Try it

Select everything (Cmd-A or Ctrl-A), delete it, and paste or write your own markdown. The page you're reading is just a starting document — the canvas is yours.
