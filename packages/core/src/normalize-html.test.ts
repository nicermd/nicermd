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

  it('drops irrelevant attributes (width/height/loading)', () => {
    expect(normalizeHtml('<img src="https://x.test/a.png" alt="a" width="200" height="100" loading="lazy">\n'))
      .toBe('![a](https://x.test/a.png)\n')
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

describe('wrapper unwrap (<div align>, <p align>, <center>)', () => {
  it('unwraps <div align="center">', () => {
    expect(normalizeHtml('<div align="center"><img src="https://x.test/a.png" alt="a"></div>\n'))
      .toBe('![a](https://x.test/a.png)\n')
  })

  it('unwraps <p align="center">', () => {
    expect(normalizeHtml('<p align="center"><img src="https://x.test/a.png" alt="a"></p>\n'))
      .toBe('![a](https://x.test/a.png)\n')
  })

  it('unwraps <center>', () => {
    expect(normalizeHtml('<center><img src="https://x.test/a.png" alt="a"></center>\n'))
      .toBe('![a](https://x.test/a.png)\n')
  })

  it('recurses on inner content', () => {
    const input = `<div align="center">
  <a href="https://h.test/">
    <img src="https://x.test/a.png" alt="a">
  </a>
</div>
`
    expect(normalizeHtml(input)).toBe('[![a](https://x.test/a.png)](https://h.test/)\n')
  })

  it('handles nested same-tag wrappers via depth counting', () => {
    const input = '<div align="center"><div>nested</div><img src="https://x.test/a.png" alt="a"></div>\n'
    // Outer wrapper unwraps. The HTML walker for inner content then
    // processes each top-level element: <div>nested</div> isn't a
    // recognised pattern (passes through), <img> matches and converts.
    const out = normalizeHtml(input)
    expect(out).toContain('<div>nested</div>')
    expect(out).toContain('![a](https://x.test/a.png)')
    expect(out).not.toMatch(/^<div align/i)
  })

  it('leaves a non-align <div> alone (still elided downstream)', () => {
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

  it('unwraps the top centred logo block', () => {
    expect(out).toContain('![](https://example.com/awesome-media/logo.svg)')
    expect(out).not.toMatch(/<div align/)
  })

  it('does not introduce new HTML scaffolding', () => {
    expect(out).not.toContain('<center>')
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

  it('converts the linked logo to markdown linked-image syntax', () => {
    expect(out).toContain('[![Tauri logo](https://example.com/tauri/logo.svg)](https://example.com/tauri)')
  })

  it('converts each badge image to markdown linked-image syntax', () => {
    expect(out).toContain('[![build status](https://example.com/build-status.svg)](https://example.com/build)')
    expect(out).toContain('[![version](https://example.com/version.svg)](https://example.com/version)')
  })

  it('leaves the navigation block (which contains <h3> + <span>) elided downstream', () => {
    // The middle div has structural HTML our v1 normaliser does not handle
    // (h3, span). It should pass through to the renderer's elision step.
    // We assert the fact that normalizeHtml left it as a recognisable HTML
    // chunk, not a converted markdown image.
    expect(out).toMatch(/<h3>|<a href="https:\/\/example\.com\/start/)
  })

  it('preserves the prose body unchanged', () => {
    expect(out).toContain('# Tauri')
    expect(out).toContain('## Get started')
    expect(out).toContain('## Contributing')
  })
})
