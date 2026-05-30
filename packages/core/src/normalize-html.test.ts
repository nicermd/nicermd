import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { containsHtml, normalizeHtml } from './normalize-html.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__tests__', 'fixtures')
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf-8')

// --- Per-transform unit tests --------------------------------------------

describe('img → markdown image', () => {
  it('converts a bare <img>', () => {
    expect(normalizeHtml('<img src="https://x.test/a.png" alt="a">\n'))
      .toBe('![a](https://x.test/a.png)\n')
  })

  it('converts a self-closing <img />', () => {
    expect(normalizeHtml('<img src="https://x.test/a.png" alt="a" />\n'))
      .toBe('![a](https://x.test/a.png)\n')
  })

  it('handles missing alt as empty', () => {
    expect(normalizeHtml('<img src="https://x.test/a.png">\n'))
      .toBe('![](https://x.test/a.png)\n')
  })

  it('preserves title when present', () => {
    expect(normalizeHtml('<img src="https://x.test/a.png" alt="a" title="t">\n'))
      .toBe('![a](https://x.test/a.png "t")\n')
  })

  it('escapes backslash and quote in the title', () => {
    // Markdown title delimiters use double-quotes with backslash-escape:
    // an unescaped `\` in the input would let a later `\"` close the
    // title delimiter prematurely. Both must be escaped so the resulting
    // markdown round-trips back to the same literal value.
    const input = `<img src="https://x.test/a.png" alt="a" title='a\\b"c'>\n`
    expect(normalizeHtml(input))
      .toBe(`![a](https://x.test/a.png "a\\\\b\\"c")\n`)
  })

  it('passes through as raw HTML when width/height/loading/srcset/sizes are present', () => {
    // Markdown image syntax can't express dimensions or responsive
    // attributes, so the normaliser leaves the tag as raw HTML and
    // lets DOMPurify carry it through the renderer. Without this the
    // attributes would be silently dropped.
    const input = '<img src="https://x.test/a.png" alt="a" width="200" height="100" loading="lazy">\n'
    expect(normalizeHtml(input)).toBe(input)
  })

  it('leaves <img> with no src untouched', () => {
    const input = '<img alt="a">\n'
    expect(normalizeHtml(input)).toBe(input)
  })
})

describe('linked image → markdown linked image', () => {
  it('leaves single-line <a><img></a> alone (markdown-it treats it as inline HTML)', () => {
    // CommonMark rule 7 only fires on lines that consist of *just* an open
    // or close tag plus whitespace. <a href=…><img …></a> on one line has
    // content after the opening tag, so markdown-it tokenises it as inline
    // HTML — out of scope for the v1 block normaliser.
    const input = '<a href="https://h.test/"><img src="https://x.test/a.png" alt="a"></a>\n'
    expect(normalizeHtml(input)).toBe(input)
  })

  it('converts <a><img></a> across multiple lines', () => {
    const input = `<a href="https://h.test/">
  <img src="https://x.test/a.png" alt="a">
</a>
`
    expect(normalizeHtml(input)).toBe('[![a](https://x.test/a.png)](https://h.test/)\n')
  })

  it('leaves <a> without an inner <img> alone', () => {
    const input = '<a href="https://h.test/">text</a>\n'
    expect(normalizeHtml(input)).toBe(input)
  })

  it('leaves <a> without href alone', () => {
    const input = '<a><img src="https://x.test/a.png"></a>\n'
    expect(normalizeHtml(input)).toBe(input)
  })
})

describe('centring wrappers pass through (no unwrap)', () => {
  // The normaliser used to strip wrappers and hoist the inner image to
  // markdown. Now that DOMPurify's allowlist includes <center> and
  // the `align` attribute, wrappers carry the centring through to the
  // rendered output, so we leave them alone.

  it('leaves <div align="center"> with inner <img> intact', () => {
    const input = '<div align="center"><img src="https://x.test/a.png" alt="a"></div>\n'
    expect(normalizeHtml(input)).toBe(input)
  })

  it('leaves <p align="center"> intact', () => {
    const input = '<p align="center"><img src="https://x.test/a.png" alt="a"></p>\n'
    expect(normalizeHtml(input)).toBe(input)
  })

  it('leaves <center> intact', () => {
    const input = '<center><img src="https://x.test/a.png" alt="a"></center>\n'
    expect(normalizeHtml(input)).toBe(input)
  })

  it('leaves multi-line centred linked images intact', () => {
    const input = `<div align="center">
  <a href="https://h.test/">
    <img src="https://x.test/a.png" alt="a">
  </a>
</div>
`
    expect(normalizeHtml(input)).toBe(input)
  })

  it('leaves a non-align <div> alone', () => {
    const input = '<div>plain</div>\n'
    expect(normalizeHtml(input)).toBe(input)
  })
})

describe('<br>', () => {
  it('drops standalone block <br>', () => {
    const input = 'Para one.\n\n<br>\n\nPara two.\n'
    const out = normalizeHtml(input)
    expect(out).not.toContain('<br>')
    expect(out).toContain('Para one.')
    expect(out).toContain('Para two.')
  })
})

// --- Untouched zones -----------------------------------------------------

describe('does not touch HTML inside protected regions', () => {
  it('leaves HTML inside fenced code blocks alone', () => {
    const input = '```\n<img src="https://x.test/a.png">\n```\n'
    expect(normalizeHtml(input)).toBe(input)
  })

  it('leaves HTML inside indented code blocks alone', () => {
    const input = '    <img src="https://x.test/a.png">\n'
    expect(normalizeHtml(input)).toBe(input)
  })

  it('leaves inline-only HTML alone (only block tokens are transformed in v1)', () => {
    const input = 'Hello <img src="https://x.test/a.png" alt="a"> there.\n'
    expect(normalizeHtml(input)).toBe(input)
  })
})

// --- Fixture-driven tests ------------------------------------------------

describe('clean-prose.md fixture', () => {
  const src = fixture('clean-prose.md')

  it('passes through unchanged (identity)', () => {
    expect(normalizeHtml(src)).toBe(src)
  })

  it('containsHtml returns false', () => {
    expect(containsHtml(src)).toBe(false)
  })
})

describe('clean-mixed.md fixture', () => {
  const src = fixture('clean-mixed.md')

  it('passes through unchanged (identity)', () => {
    expect(normalizeHtml(src)).toBe(src)
  })

  it('containsHtml returns false', () => {
    expect(containsHtml(src)).toBe(false)
  })
})

describe('awesome-snippet.md fixture', () => {
  const src = fixture('awesome-snippet.md')
  const out = normalizeHtml(src)

  it('containsHtml returns true', () => {
    expect(containsHtml(src)).toBe(true)
  })

  it('keeps the top centred wrapper so the renderer can preserve centring', () => {
    expect(out).toContain('<div align="center">')
  })

  it('preserves the prose content unchanged', () => {
    expect(out).toContain('# Awesome')
    expect(out).toContain('## Contents')
    expect(out).toContain('## Platforms')
    expect(out).toContain('- [Node.js](https://example.com/sindresorhus/awesome-nodejs#readme)')
  })
})

describe('tauri-snippet.md fixture', () => {
  const src = fixture('tauri-snippet.md')
  const out = normalizeHtml(src)

  it('containsHtml returns true', () => {
    expect(containsHtml(src)).toBe(true)
  })

  it('keeps the centring wrappers intact', () => {
    // The wrappers carry the centred layout; we no longer hoist their
    // inner image to bare markdown. DOMPurify allows <div align>
    // through, so this renders centred in all three modes.
    expect(out).toContain('<div align="center">')
  })

  it('preserves the inner anchors and images as-is', () => {
    // No markdown-image rewrite — the original <a href>+<img> structure
    // survives so it renders identically in Read, Write (parked
    // preview), and Split modes.
    expect(out).toContain('https://example.com/tauri/logo.svg')
    expect(out).toContain('https://example.com/build-status.svg')
    expect(out).toContain('https://example.com/version.svg')
  })

  it('preserves the prose body unchanged', () => {
    expect(out).toContain('# Tauri')
    expect(out).toContain('## Get started')
    expect(out).toContain('## Contributing')
  })
})
