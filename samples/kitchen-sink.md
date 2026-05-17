# Nicer.md Kitchen Sink

This file exercises every markdown feature the renderer should handle. Use it to test themes and verify rendering.

## Text formatting

This is a paragraph with **bold**, *italic*, ~~strikethrough~~, and `inline code`. Here's a [link](https://example.com) and an ![image alt text](https://placehold.co/600x200/e2e8f0/475569?text=Sample+Image).

This is a second paragraph to test spacing between paragraphs. It has **bold and *nested italic* inside it** and some `code with spaces` in it.

> This is a blockquote. It should have a visible left border and slightly muted text.
>
> It can span multiple paragraphs.
>
> > And blockquotes can be nested.

---

## Headings

### Third level heading

#### Fourth level heading

##### Fifth level heading

###### Sixth level heading

## Lists

### Unordered

- First item
- Second item with a longer description that might wrap to multiple lines depending on the viewport width and font size
- Third item
  - Nested item one
  - Nested item two
    - Deeply nested
- Back to top level

### Ordered

1. First step
2. Second step
3. Third step
   1. Sub-step A
   2. Sub-step B
4. Fourth step

### Task list

- [x] Set up markdown-it
- [x] Create theme system
- [ ] Build CLI
- [ ] Chrome extension
- [ ] VS Code extension

## Code

Inline: Use `render(markdown, theme)` to produce HTML.

Block with syntax highlighting:

```typescript
import { render, getThemes } from 'nicermd-core'

interface RenderOptions {
  theme?: string
  frontmatter?: boolean
}

export function renderFile(path: string, options: RenderOptions = {}): string {
  const markdown = fs.readFileSync(path, 'utf-8')
  const theme = options.theme ?? 'default'
  return render(markdown, theme)
}

// List available themes
const themes = getThemes()
themes.forEach(t => console.log(`${t.name} (${t.mode}): ${t.description}`))
```

```python
# Python example for variety
def fibonacci(n: int) -> list[int]:
    """Generate Fibonacci sequence up to n terms."""
    sequence = [0, 1]
    for _ in range(2, n):
        sequence.append(sequence[-1] + sequence[-2])
    return sequence[:n]

print(fibonacci(10))
```

```bash
# Shell commands
npx nicermd ./docs --theme terminal
curl -s https://example.com/readme.md | npx nicermd --stdin
```

A code block with no language specified:

```
This is plain text in a code block.
No syntax highlighting applied.
It should still look distinct from regular text.
```

## Tables

| Feature | Chrome Ext | VS Code | CLI | Website | iOS |
|---------|-----------|---------|-----|---------|-----|
| Render markdown | ✓ | ✓ | ✓ | ✓ | ✓ |
| Theme switching | ✓ | ✓ | ✓ | ✓ | ✓ |
| File browsing | ✗ | ✓ | ✓ | ✗ | ✓ |
| URL sharing | ✗ | ✗ | ✗ | ✓ | ✗ |
| Offline | ✓ | ✓ | ✓ | ✓ | ✓ |

## Math (KaTeX)

Inline math: The equation $E = mc^2$ changed physics.

Display math:

$$
\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

## Footnotes

This claim needs a source[^1]. And another one[^2].

[^1]: First footnote with explanatory text.
[^2]: Second footnote referencing a different source.

## Frontmatter

This file doesn't have frontmatter, but the renderer should handle files that start with:

```yaml
---
title: My Document
date: 2026-05-17
author: Someone
tags: [markdown, testing]
---
```

## Long content test

The following paragraphs test scrolling behaviour and reading experience with substantial content.

Markdown is the thinnest layer between writing and publishing. It started as a way to write HTML without writing HTML, and it has outlived most of the frameworks that grew up around it. The reason is structural: markdown is barely there. There is almost nothing to learn, almost nothing to misuse, and almost nothing for a future tool to break. Most documents you read on the web today began as a markdown file in someone's editor — README files, design docs, blog posts, technical specifications, meeting notes.

A good markdown reader makes that thinness visible. It does not insist on a chrome of toolbars or sidebars or panels. It does not ask you to log in or import or sync. It takes a file, reads it, and renders it — with typography that respects the words and spacing that respects the eye. Everything else is in the way.

This is what Nicer.md is trying to be: a place where the document is the interface. Read it. Edit it if you want. Save it back to where it came from. Close the tab. The document goes with you; nothing stayed behind.

## Edge cases

### Empty sections

A section heading with no body below it — renderers should still emit a valid heading without merging it into the next section.

### Consecutive headings

Headings can follow each other with no body in between.

#### Like this

##### And this

### Very long unbroken strings

Thisisaverylongstringwithnospacesthatshouldhorizontallyscrollorbreakdependingonthelayoutratherthanbreakingtheentirepagelayout.

### HTML in markdown

<details>
<summary>Click to expand</summary>

This is hidden content inside an HTML details/summary block. Some markdown renderers handle this, others don't.

</details>

### Images that don't load

![This image doesn't exist](https://example.com/nonexistent.png)

The alt text should display gracefully when the image fails.
