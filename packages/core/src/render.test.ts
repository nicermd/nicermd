// Regression tests for the render pipeline. The security-critical
// invariants live in SECURITY.md; this file pins the most important
// of them — sanitisation, URI scheme allowlist, HTML elision,
// heading-anchor stability — so that future refactors can't silently
// break them.

import { describe, expect, it } from 'vitest'
import { render } from './index.js'

// --- Helpers -------------------------------------------------------------

function renderToDoc(markdown: string): Document {
  const parser = new DOMParser()
  return parser.parseFromString(`<div id="root">${render(markdown)}</div>`, 'text/html')
}

// --- HTML elision (markdown-it html: true + custom rules) ----------------

describe('HTML elision', () => {
  it('elides block HTML to a single placeholder', () => {
    const out = render('<div align="center"><img src="https://example.com/logo.png"></div>\n')
    expect(out).toContain('nicermd-html-elided')
    expect(out).not.toContain('<img src="https://example.com/logo.png"')
    expect(out).not.toContain('align="center"')
  })

  it('collapses consecutive block-HTML placeholders into one', () => {
    const md = '<div>a</div>\n\n<div>b</div>\n\n<div>c</div>\n'
    const out = render(md)
    const matches = out.match(/nicermd-html-elided/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('drops inline HTML outside the allowlist', () => {
    const out = render('Hello <span class="evil">world</span>\n')
    // <span> is in the inline-HTML drop list (only br/kbd/sub/sup/mark
    // survive). The text "world" stays; the wrapping markup goes.
    expect(out).toContain('world')
    expect(out).not.toContain('<span class="evil">')
  })

  it('preserves the tiny inline allowlist (br/kbd/sub/sup/mark)', () => {
    const out = render('Press <kbd>Cmd</kbd>+<kbd>K</kbd>.\n')
    expect(out).toContain('<kbd>Cmd</kbd>')
    expect(out).toContain('<kbd>K</kbd>')
  })

  it('strips dangerous HTML entirely (script tags, iframes, objects)', () => {
    const md = '<script>alert(1)</script>\n\n<iframe src="x"></iframe>\n\n<object data="x"></object>\n'
    const out = render(md)
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<iframe')
    expect(out).not.toContain('<object')
    expect(out).not.toContain('alert(1)')
  })
})

// --- DOMPurify URL allowlist ---------------------------------------------

describe('URL allowlist', () => {
  it('strips javascript: hrefs', () => {
    // markdown-it's own URL validation refuses to make a link out of a
    // javascript: target, so the source survives as literal text — but
    // critically, no <a href="javascript:..."> is produced. The text
    // content "alert(1)" is harmless without a clickable href.
    const out = render('[click](javascript:alert(1))\n')
    expect(out).not.toMatch(/href="javascript:/i)
    expect(out).not.toMatch(/<a [^>]*href=[^>]*alert/i)
  })

  it('strips vbscript: hrefs', () => {
    const out = render('[click](vbscript:alert(1))\n')
    expect(out).not.toMatch(/href="vbscript:/i)
  })

  it('strips file: hrefs', () => {
    const out = render('[click](file:///etc/passwd)\n')
    expect(out).not.toMatch(/href="file:/i)
  })

  it('strips data: URIs from links', () => {
    const out = render('[click](data:image/svg+xml,<svg onload=alert(1)>)\n')
    expect(out).not.toMatch(/href="data:/i)
    expect(out).not.toContain('onload')
  })

  it('strips data: URIs from img src too (no inline images)', () => {
    const out = render('![alt](data:image/png;base64,iVBORw0KGgo=)\n')
    expect(out).not.toMatch(/src="data:/i)
  })

  it('preserves https:, http:, mailto:, fragment hrefs', () => {
    const out = render('[a](https://nicer.md) [b](http://x.test) [c](mailto:a@b.com) [d](#anchor)\n')
    expect(out).toContain('href="https://nicer.md"')
    expect(out).toContain('href="http://x.test"')
    expect(out).toContain('href="mailto:a@b.com"')
    expect(out).toContain('href="#anchor"')
  })

  it('preserves https: img src', () => {
    const out = render('![alt](https://example.com/i.png)\n')
    expect(out).toContain('src="https://example.com/i.png"')
  })
})

// --- DOMPurify tag + attribute allowlist ---------------------------------

describe('Tag and attribute allowlist', () => {
  it('strips event-handler attributes', () => {
    // Markdown can't directly produce these, but raw HTML round-trips
    // through markdown-it's html_inline path could. Regression-pin via
    // a markdown-allowed inline tag.
    const out = render('<kbd onclick="alert(1)">Cmd</kbd>\n')
    expect(out).not.toMatch(/onclick=/i)
    expect(out).not.toContain('alert(1)')
  })

  it('strips style attributes', () => {
    // <a style="..."> with display:none could hide phishing UI; <span
    // style="..."> could load fonts that fingerprint. Confirm style
    // attribute is not in the ALLOWED_ATTR list.
    const out = render('Hello <kbd style="background: red">x</kbd>\n')
    expect(out).not.toMatch(/style=/i)
  })

  it('drops form / input / button entirely', () => {
    const out = render('<form><input><button>x</button></form>\n')
    expect(out).not.toContain('<form')
    expect(out).not.toContain('<input')
    expect(out).not.toContain('<button')
  })
})

// --- Heading anchors -----------------------------------------------------

describe('Heading anchors', () => {
  it('generates GitHub-style slugs', () => {
    const out = render('# Hello World\n## Sub-Section!\n')
    expect(out).toContain('id="hello-world"')
    expect(out).toContain('id="sub-section"')
  })

  it('strips punctuation and lowercases', () => {
    const out = render('# What\'s "New"?\n')
    expect(out).toMatch(/id="whats-new"/)
  })

  it('suffixes collisions deterministically', () => {
    const out = render('# Foo\n# Foo\n# Foo\n')
    expect(out).toContain('id="foo"')
    expect(out).toContain('id="foo-1"')
    expect(out).toContain('id="foo-2"')
  })

  it('isolates collision counters per render', () => {
    // Two parallel renders must not share the slug counter — we'd
    // produce `foo-1` for the second `# Foo` of the second doc
    // otherwise. Regression-pins the per-render env approach.
    const a = render('# Foo\n')
    const b = render('# Foo\n')
    expect(a).toContain('id="foo"')
    expect(b).toContain('id="foo"')
    expect(a).not.toContain('id="foo-1"')
    expect(b).not.toContain('id="foo-1"')
  })
})

// --- Relative URL rewriting ----------------------------------------------

describe('Relative URL rewriting', () => {
  it('resolves relative img src against baseUrl', () => {
    const out = render('![alt](images/logo.png)\n', {
      baseUrl: 'https://raw.githubusercontent.com/u/r/main/',
    })
    expect(out).toContain('src="https://raw.githubusercontent.com/u/r/main/images/logo.png"')
  })

  it('leaves absolute URLs alone', () => {
    const out = render('![alt](https://other.test/x.png)\n', {
      baseUrl: 'https://raw.githubusercontent.com/u/r/main/',
    })
    expect(out).toContain('src="https://other.test/x.png"')
  })

  it('strips protocol-relative URLs (defence-in-depth)', () => {
    // The renderer's URI allowlist requires explicit https:/http:/
    // mailto:/#/?  — protocol-relative URLs (//host/path) don't match
    // and are stripped by DOMPurify. They're rare in real markdown
    // and provide a phishing-aid by hiding the resolved scheme; safe
    // default is to drop them.
    const out = render('[link](//example.com/path)\n', {
      baseUrl: 'https://x.test/',
    })
    expect(out).not.toContain('href="//example.com/path"')
    expect(out).not.toMatch(/href="\/\//)
  })

  it('leaves fragment links alone', () => {
    const out = render('[link](#section)\n', {
      baseUrl: 'https://x.test/',
    })
    expect(out).toContain('href="#section"')
  })

  it('leaves query-only links alone (in-app deep links)', () => {
    const out = render('[link](?url=https%3A%2F%2Fx)\n', {
      baseUrl: 'https://x.test/',
    })
    expect(out).toContain('href="?url=https%3A%2F%2Fx"')
  })
})

// --- Sanity checks for normal markdown -----------------------------------

describe('Standard markdown features still render', () => {
  it('renders headings, lists, code, tables', () => {
    const md = `# Heading

- item one
- item two

\`\`\`ts
const x = 1
\`\`\`

| A | B |
|---|---|
| 1 | 2 |
`
    const doc = renderToDoc(md)
    expect(doc.querySelector('#root h1')?.textContent).toBe('Heading')
    expect(doc.querySelector('#root ul')).toBeTruthy()
    expect(doc.querySelector('#root pre code')?.textContent).toContain('const x = 1')
    expect(doc.querySelector('#root table')).toBeTruthy()
  })

  it('renders emphasis and strong', () => {
    const out = render('**bold** and *italic*\n')
    expect(out).toMatch(/<strong>bold<\/strong>/)
    expect(out).toMatch(/<em>italic<\/em>/)
  })

  it('renders fenced code blocks', () => {
    const out = render('```\nplain text\n```\n')
    expect(out).toMatch(/<pre><code>plain text/)
  })
})
