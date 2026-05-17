---
title: A short Nicer.md sample
date: 2026-05-15
---

# A short sample

Nicer.md is a zero-server markdown reader. Open a `.md` file — it renders beautifully in the same pane, with no backend involved.

## What renders

- **Bold** and *italic* text, ~~strikethrough~~, `inline code`, [hyperlinks](https://nicer.md).
- GFM tables, task lists, footnotes, fenced code blocks with syntax highlighting.
- Heading anchors, blockquotes, horizontal rules.

## Code

```ts
import { render } from 'nicermd-core'

const html = render(`# Hello, world!\n\nMarkdown in, sanitised HTML out.`)
```

## Tables

| Mode  | What it does                                  |
|-------|-----------------------------------------------|
| Read  | Rendered HTML, no editor visible              |
| Write | WYSIWYG editing in place via Tiptap           |
| Split | Source on the left, live preview on the right |
| Code  | Raw markdown with syntax-aware highlighting   |

## Quote

> The best markdown reader is the one you forget is there.

That's the goal.
