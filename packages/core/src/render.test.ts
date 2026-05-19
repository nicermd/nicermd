// Regression tests for the render pipeline. The security-critical
// invariants live in SECURITY.md; this file pins the most important
// of them — sanitisation, URI scheme allowlist, HTML elision,
// heading-anchor stability — so that future refactors can't silently
// break them.

import { describe, expect, it } from 'vitest'
import { render, renderPlain, renderSource } from './index.js'

// --- Helpers -------------------------------------------------------------

function renderToDoc(markdown: string): Document {
  const parser = new DOMParser()
  return parser.parseFromString(`<div id="root">${render(markdown)}</div>`, 'text/html')
}

// --- HTML handling: pass through to DOMPurify ---------------------------

describe('HTML rendering', () => {
  it('renders normalisable HTML idioms via the normaliser path', () => {
    // The pre-render normaliser converts these specific patterns to
    // markdown image syntax. See normalize-html.test.ts for the full
    // transform set.
    const out = render('<div align="center"><img src="https://example.com/logo.png" alt="logo"></div>\n')
    expect(out).toContain('src="https://example.com/logo.png"')
    expect(out).toContain('alt="logo"')
  })

  it('passes other block HTML through to DOMPurify (no elision)', () => {
    // Block HTML the normaliser doesn't recognise is no longer replaced
    // with an ellipsis placeholder — it renders inline and DOMPurify's
    // tag/attr/URI allowlist remains the load-bearing safety layer.
    const out = render('<details><summary>Open me</summary>\n\nHidden body.\n\n</details>\n')
    expect(out).not.toContain('nicermd-html-elided')
    // <details> and <summary> aren't in ALLOWED_TAGS today, so they
    // unwrap (children kept) — we assert the inner text survives.
    expect(out).toContain('Open me')
    expect(out).toContain('Hidden body')
  })

  it('keeps allowed HTML tags like <div> intact', () => {
    const out = render('<div>plain</div>\n')
    // <div> is in ALLOWED_TAGS; passes through.
    expect(out).toContain('<div>plain</div>')
  })

  it('drops inline HTML outside the allowlist', () => {
    const out = render('Hello <span class="evil">world</span>\n')
    // <span> is in the inline-HTML drop list at the markdown-it
    // renderer layer (only br/kbd/sub/sup/mark survive there).
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

// --- Allowlist hardening (regression pins for the expanded tag/attr set) -

describe('Allowlist hardening', () => {
  // The expanded allowlist (center, details, summary, figure, dl, …,
  // align, width, height, …) adds surface area. These tests pin the
  // *negative* invariants: a newly-permitted tag does not bring along
  // event-handler attrs or nested scripts.

  it('strips event handlers on permitted block tags', () => {
    const out = render('<details onclick="alert(1)"><summary onmouseover="alert(2)">Open</summary>Body</details>\n')
    expect(out).toContain('<details')
    expect(out).not.toMatch(/onclick=/i)
    expect(out).not.toMatch(/onmouseover=/i)
    expect(out).not.toContain('alert(')
  })

  it('preserves <details open> and the rest of allowed attrs', () => {
    const out = render('<details open><summary>S</summary><p>B</p></details>\n')
    expect(out).toContain('<details open=""')
    expect(out).toContain('<summary>S</summary>')
  })

  it('keeps <center> but drops a nested <script>', () => {
    const out = render('<center>Hi<script>alert(1)</script></center>\n')
    expect(out).toContain('<center>Hi</center>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert(')
  })

  it('keeps the align attribute as presentational only', () => {
    const out = render('<div align="center">x</div>\n')
    expect(out).toContain('align="center"')
  })

  it('does not honour align as a URL surface (no scheme bypass via align)', () => {
    // align="javascript:…" is a deprecated-attribute-value gag — `align`
    // is not URI-bearing so DOMPurify keeps the literal string, but the
    // browser does not navigate or execute anything from it. We still
    // pin the rendered output so the value can't accidentally migrate
    // into a script-running context via a future renderer change.
    const out = render('<div align="javascript:alert(1)">x</div>\n')
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toContain('alert(1)')
  })

  it('strips style attributes even on newly-permitted tags', () => {
    const out = render('<figure style="background: red"><figcaption style="color: blue">x</figcaption></figure>\n')
    expect(out).not.toMatch(/style=/i)
  })

  it('keeps width/height as static layout hints', () => {
    const out = render('<img src="https://x.test/i.png" alt="i" width="120" height="60">\n')
    expect(out).toContain('width="120"')
    expect(out).toContain('height="60"')
  })

  it('strips form/input/button/iframe/object even with the wider list', () => {
    const md = '<form><input><button>x</button></form>\n\n<iframe src="x"></iframe>\n\n<object data="x"></object>\n'
    const out = render(md)
    expect(out).not.toContain('<form')
    expect(out).not.toContain('<input')
    expect(out).not.toContain('<button')
    expect(out).not.toContain('<iframe')
    expect(out).not.toContain('<object')
  })

  it('drops disallowed media tags (picture/source/video/audio) but keeps the fallback img', () => {
    // Wrap in a <div> so markdown-it treats this as block HTML (rule 6).
    // A bare <picture>…</picture> on a single line tokenises as inline HTML
    // and is dropped wholesale by the inline allowlist before DOMPurify sees
    // anything — that's a separate, less interesting code path.
    const out = render('<div><picture><source srcset="https://x.test/dark.png" media="(prefers-color-scheme: dark)"><img src="https://x.test/light.png" alt="i"></picture></div>\n')
    expect(out).not.toContain('<picture')
    expect(out).not.toContain('<source')
    expect(out).toContain('src="https://x.test/light.png"')
  })
})

describe('External link hardening', () => {
  it('adds rel="noopener noreferrer" to absolute http(s) links', () => {
    const out = render('[example](https://example.com)\n')
    expect(out).toMatch(/<a[^>]*\brel="noopener noreferrer"/i)
    expect(out).toContain('href="https://example.com"')
  })

  it('adds rel to mailto: links', () => {
    const out = render('[mail](mailto:a@b.com)\n')
    expect(out).toMatch(/<a[^>]*\brel="noopener noreferrer"/i)
  })

  it('does NOT add rel to fragment-only links (same-page anchors)', () => {
    const out = render('[here](#section)\n')
    expect(out).toContain('href="#section"')
    expect(out).not.toMatch(/\brel=/i)
  })

  it('does NOT add rel to query-only links (in-app deep links)', () => {
    const out = render('[doc](?url=https%3A%2F%2Fx)\n')
    expect(out).toContain('href="?url=https%3A%2F%2Fx"')
    expect(out).not.toMatch(/\brel=/i)
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

  it('preserves absolute-path src when no baseUrl is set', () => {
    // Documents authored without a source URL (boot doc, paste, drop)
    // commonly reference same-origin assets like `/favicon.png` or
    // `assets/cover.png`. The URI hook must not strip these — the
    // previous strict allowlist did, silently breaking welcome-state
    // logos and any local-image markdown.
    const out = render('![](/favicon-256.png)\n')
    expect(out).toContain('src="/favicon-256.png"')
  })

  it('preserves relative-path src when no baseUrl is set', () => {
    const out = render('![](assets/cover.png)\n')
    expect(out).toContain('src="assets/cover.png"')
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
    // Fenced blocks now carry the .hljs hook class so theme-aware
    // token CSS can target them, whether or not a language was
    // specified. Body content (text) is preserved verbatim.
    const out = render('```\nplain text\n```\n')
    expect(out).toMatch(/<pre><code class="hljs">plain text/)
  })

  it('highlights fenced code with a recognised language', () => {
    // highlight.js wraps tokens in spans with .hljs-* classes; we
    // assert the keyword span survives the DOMPurify pass and the
    // language class is preserved for tooling.
    const out = render('```ts\nconst x = 1\n```\n')
    expect(out).toContain('class="hljs language-ts"')
    expect(out).toMatch(/<span class="hljs-keyword">const<\/span>/)
  })

  it('falls back to plain code for unrecognised languages', () => {
    // No grammar registered for `wat` — highlight returns the plain
    // wrapper and the body is just html-escaped text.
    const out = render('```wat\nfn foo()\n```\n')
    expect(out).toContain('<pre><code class="hljs">fn foo()')
  })
})

// --- Plain-text rendering ---------------------------------------------------

describe('renderPlain', () => {
  it('wraps content in <pre class="nicermd-plain">', () => {
    const out = renderPlain('MIT License\n\nCopyright (c) 2026 …')
    expect(out).toMatch(/^<pre class="nicermd-plain">/)
    expect(out).toMatch(/<\/pre>$/)
  })

  it('escapes HTML characters literally — no markdown parsing', () => {
    // ** stays as **, # stays as #, < becomes &lt;, etc. The whole
    // point is "what the file says, verbatim".
    const out = renderPlain('Use **bold** and # H1 and <script>alert(1)</script>')
    expect(out).toContain('**bold**')
    expect(out).toContain('# H1')
    expect(out).toContain('&lt;script&gt;')
    expect(out).not.toContain('<strong>')
    expect(out).not.toContain('<h1')
    expect(out).not.toContain('<script>')
  })

  it('preserves whitespace and indentation', () => {
    const out = renderPlain('  one\n    two\n  three')
    expect(out).toContain('  one\n    two\n  three')
  })

  it('escapes adversarial input rather than removing it', () => {
    // Plain text preserves every character literally — the word
    // "onerror" survives as text, but the surrounding < and >
    // are escaped so the browser never parses an <img> tag.
    const out = renderPlain('<img src=x onerror=alert(1)>')
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(out).not.toContain('<img')
  })
})

// --- Source-file rendering -------------------------------------------------

describe('renderSource', () => {
  it('highlights TypeScript with the right hljs spans', () => {
    const out = renderSource('const x = 1', 'typescript')
    expect(out).toContain('class="hljs language-typescript"')
    expect(out).toMatch(/<span class="hljs-keyword">const<\/span>/)
  })

  it('highlights Python', () => {
    const out = renderSource("def hello():\n    return 'hi'", 'python')
    expect(out).toContain('class="hljs language-python"')
    expect(out).toMatch(/hljs-keyword/)
  })

  it('falls back to plain monospace for unregistered languages', () => {
    const out = renderSource('fn main() {}', 'rust')
    expect(out).toContain('<pre><code class="hljs">')
    expect(out).toContain('fn main()')
  })

  it('escapes embedded HTML in the source — no live tags', () => {
    // hljs wraps string literals in its own <span class="hljs-string">,
    // so the surrounding quotes don't get HTML-escaped. The inner
    // <b> does — that's what matters for safety. The literal <b> tag
    // must never reach the DOM.
    const out = renderSource('const a = "<b>" + 1', 'typescript')
    expect(out).toContain('&lt;b&gt;')
    // No raw <b> outside the hljs span structure.
    expect(out).not.toMatch(/<b>(?!\w)/)
  })
})
