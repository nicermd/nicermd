# A clean prose document

This file contains only plain markdown — no HTML, no embedded
images, no horizontal rules, no fenced code. The normaliser must
return it byte-for-byte unchanged.

## Why this case matters

The vast majority of markdown files most users will open are
ordinary prose: a README from a small library, a personal note, a
specification draft. We must not pay any cost — visible or
invisible — on these.

## Standard inline formatting

Plain text with **bold**, *italic*, ***both***, and ~~struck~~
phrasing. Inline `code` is fine. A [link to the project][nicer]
and an [inline link](https://example.com).

[nicer]: https://nicer.md

## Lists

- One
- Two
  - Two-a
  - Two-b
- Three

1. First
2. Second
3. Third

## A blockquote

> A short quote. Multiple lines wrap naturally; the renderer treats
> them as one paragraph inside the quote.
>
> A second paragraph in the same quote, separated by a blank line.

## Headings keep going

### Three

#### Four

##### Five

###### Six

End.
