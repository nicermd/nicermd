# Clean mixed-content document

Headings, paragraphs, code, tables, images — everything below uses
markdown syntax exclusively. No HTML appears anywhere. The
normaliser must be a no-op.

## Markdown images and links

A markdown image:

![The project logo](https://example.com/logo.png)

A linked image (markdown form):

[![The project logo](https://example.com/logo.png)](https://example.com/)

## Code

Inline `printf("hi")` and a fenced block:

```ts
function greet(name: string): string {
  return `Hello, ${name}!`
}
```

A fenced block with no language:

```
plain text
```

## Tables

| Column A | Column B   |
| -------- | ---------- |
| Cell 1   | Cell two   |
| Cell 3   | Cell four  |

## Task lists

- [x] Done
- [ ] Pending
- [ ] Also pending

## Horizontal rule

---

After the rule, content continues with another paragraph and
a final closing line.
