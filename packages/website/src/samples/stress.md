---
title: "Stress test"
date: 2026-04-26
tags: [markdown, round-trip, hybrid-spike]
---

# Markdown stress test

This document exists to surface round-trip differences between the four modes in the spike. Switch through Cmd+1..4 (or Cmd+Shift+M to cycle). Open a `?freeze=1` tab next to a live tab to compare before/after.

## Headings

# Level one
## Level two
### Level three
#### Level four
##### Level five
###### Level six

## Paragraphs and line breaks

A normal paragraph with one line.

A paragraph that wraps onto a second line via a soft break — which most renderers collapse to a space.

A line ending with two trailing spaces forces a hard break:  
the next line continues here.

## Inline formatting

Plain text. **Bold** with double asterisks. __Bold__ with double underscores. *Italic* with single asterisks. _Italic_ with single underscores. ***Bold italic***. ~~Strikethrough~~. `inline code` with backticks. Code containing `` ` `` a backtick. A combination: ***bold italic with `code` inside a [link](https://example.com) and a ~~strike~~***.

Escape sequences: \*literal asterisks\*, \_literal underscores\_, \\backslash, \`backtick\`.

## Links

Inline: [Anthropic](https://anthropic.com).
With title: [Anthropic](https://anthropic.com "AI safety lab").
Autolink: <https://anthropic.com>.
Reference-style: [Anthropic][anth].
Bare URL via linkify: https://anthropic.com.
Email: <hello@example.com>.

[anth]: https://anthropic.com "Reference link"

## Images

Inline image: ![alt text](https://placehold.co/24x24 "tiny placeholder")

Block image (alone on its own line):

![Larger placeholder](https://placehold.co/400x200 "block image")

## Lists

Unordered with three different markers:

- dash item
* star item
+ plus item

Nested unordered:

- top
  - second
    - third
- top again

Ordered:

1. first
2. second
3. third

Ordered starting from a non-1 value:

5. fifth
6. sixth

Mixed nesting:

1. ordered top
   - unordered second
     1. ordered third
- unordered top after ordered

Task list (GFM):

- [ ] open task
- [x] done task
- [ ] task with **bold** and `code`
  - [ ] nested open task

Loose list (blank line between items):

- one

- two

- three

## Blockquotes

> A single-line blockquote.

> A blockquote
> spanning two lines.

> Outer blockquote
> > Nested blockquote
> > > Triple-nested

> Blockquote with **inline formatting**, a [link](https://example.com), and a `code span`.

## Code blocks

Indented (four spaces):

    function indented() {
      return "code"
    }

Fenced with no language:

```
function plain() {
  return "code"
}
```

Fenced with TypeScript:

```typescript
interface Doc {
  text: string
  cursor: number
}

const main = (d: Doc): void => {
  console.log(d.text)
}
```

Fenced containing tildes (close with backticks):

```
echo "this has ~~~ inside"
```

Fenced via tildes:

~~~bash
echo "fence with tildes"
~~~

## Horizontal rules

Three dashes:

---

Three asterisks:

***

Three underscores:

___

## Tables

Simple GFM table:

| Name      | Engine       | Strength             |
|-----------|--------------|----------------------|
| Mode 1    | nicermd-core | render speed         |
| Mode 2    | Tiptap       | block WYSIWYG        |
| Mode 3    | CodeMirror   | source + live render |
| Mode 4    | CodeMirror   | pure source view     |

With column alignment:

| Left    | Centred  |    Right |
|:--------|:--------:|---------:|
| a       | b        |        c |
| longer  | longer   |   longer |

Cells with formatting:

| Feature   | Inline                          | Notes                          |
|-----------|---------------------------------|--------------------------------|
| **Bold**  | `code`                          | *italics OK*                   |
| Link      | [Anthropic](https://anthropic.com) | autolink: <https://example.com> |
| ~~Strike~~ | superscript via HTML: <sup>2</sup> | tasks below |

## HTML inline and block

Inline HTML: press <kbd>Cmd</kbd> + <kbd>2</kbd>. A footnote marker<sup>1</sup> like this. A `<span style="color:red">styled span</span>` (style attr likely stripped).

Block HTML:

<details>
  <summary>Click to expand</summary>

  Inner paragraph inside a details block.
</details>

A raw div:

<div class="note">
  Block-level HTML.
</div>

## Footnotes

A claim with a footnote.[^one] And another claim.[^longer-id]

[^one]: First footnote body.
[^longer-id]: Second footnote with **inline formatting** and a [link](https://example.com).

## Math

Inline math: $E = mc^2$ and $\sum_{i=1}^{n} x_i$.

Display math:

$$
\int_{0}^{\infty} e^{-x^2} \, dx = \frac{\sqrt{\pi}}{2}
$$

## Special characters and entities

Unicode: café, résumé, naïve, 你好, مرحبا, привет, 🎉.

HTML entities: &copy; &amp; &lt; &gt; &mdash; &hellip;

Smart quotes (typographer): "double quotes" and 'single quotes'. An em dash --- and ellipsis...

## Definition list (extension)

Term 1
:   Definition one.

Term 2
:   Definition two with **bold** and `code`.

## Closing

End of stress test. If a feature above survived all four modes, it round-trips cleanly. If not, that's data for the spike decision.
