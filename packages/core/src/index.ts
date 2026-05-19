import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import bashLang from 'highlight.js/lib/languages/bash'
import cssLang from 'highlight.js/lib/languages/css'
import jsonLang from 'highlight.js/lib/languages/json'
import jsLang from 'highlight.js/lib/languages/javascript'
import markdownLang from 'highlight.js/lib/languages/markdown'
import pythonLang from 'highlight.js/lib/languages/python'
import tsLang from 'highlight.js/lib/languages/typescript'
import xmlLang from 'highlight.js/lib/languages/xml'
import { getTheme, getThemes } from './themes.js'
import { containsHtml, normalizeHtml } from './normalize-html.js'
import { parkHtml, unparkHtml } from './park-html.js'

export { getTheme, getThemes, containsHtml, normalizeHtml, parkHtml, unparkHtml }
export type { Theme, ThemeMode } from './themes.js'

export interface RenderOptions {
  theme?: string
  sanitize?: boolean
  // Resolves relative href / src in the rendered HTML against this URL.
  // Used for URL-loaded docs whose `images/foo.png` etc. would otherwise
  // 404 against the app origin instead of the source repo.
  baseUrl?: string
}

// Curated language set for fenced code blocks. ~8 grammars covers
// >90% of real-world README code (TypeScript / JavaScript / Python /
// Bash / JSON / HTML / CSS / Markdown). Each is registered against
// its canonical name plus common aliases (ts/js/py/sh/shell) so
// `​```ts` and `​```typescript` both highlight.
//
// Languages outside this set render as plain monospace (no
// highlighting), same as today — so adding the highlighter is a
// no-regression upgrade for unrecognised grammars.
hljs.registerLanguage('typescript', tsLang)
hljs.registerLanguage('ts', tsLang)
hljs.registerLanguage('tsx', tsLang)
hljs.registerLanguage('javascript', jsLang)
hljs.registerLanguage('js', jsLang)
hljs.registerLanguage('jsx', jsLang)
hljs.registerLanguage('python', pythonLang)
hljs.registerLanguage('py', pythonLang)
hljs.registerLanguage('bash', bashLang)
hljs.registerLanguage('sh', bashLang)
hljs.registerLanguage('shell', bashLang)
hljs.registerLanguage('json', jsonLang)
hljs.registerLanguage('html', xmlLang)
hljs.registerLanguage('xml', xmlLang)
hljs.registerLanguage('svg', xmlLang)
hljs.registerLanguage('css', cssLang)
hljs.registerLanguage('markdown', markdownLang)
hljs.registerLanguage('md', markdownLang)

// Local escape — defined at module scope (rather than via md.utils
// inside the highlight callback below) so the callback doesn't form a
// type-inference cycle with the `md` it's part of. tsup's DTS build
// otherwise breaks on the implicit `any` chain.
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  typographer: true,
  // highlight.js integration. Returns the full <pre><code>…</code></pre>
  // so markdown-it's default fence wrapper is replaced. .hljs class on
  // <code> is the hook for our token-color CSS; .language-* preserved
  // for tooling that inspects the original info string.
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const out = hljs.highlight(str, { language: lang, ignoreIllegals: true })
        return `<pre><code class="hljs language-${lang}">${out.value}</code></pre>`
      } catch {
        // fall through to plain
      }
    }
    return `<pre><code class="hljs">${escapeHtml(str)}</code></pre>`
  },
})

// Block-level HTML passes through to DOMPurify rather than being elided.
// Earlier versions replaced each html_block with a centred ellipsis on the
// theory that block HTML in READMEs is GitHub-renderer-specific soup; in
// practice that elided real content users want to read (centred logos,
// badge strips, callout boxes). DOMPurify with our strict tag/attr/URI
// allowlist is the load-bearing defence — and parking + sanitisation in
// Write mode have demonstrated it's sufficient. Inline HTML still uses
// a narrow allowlist for the formatting tags we trust verbatim.
md.renderer.rules.html_block = (tokens, idx) => tokens[idx]!.content

const INLINE_HTML_ALLOW = /^<\/?(?:br|kbd|sub|sup|mark)\b[^>]*\/?>$/i
md.renderer.rules.html_inline = (tokens, idx) => {
  const content = tokens[idx]!.content
  return INLINE_HTML_ALLOW.test(content) ? content : ''
}

// GitHub-flavoured slug for heading anchors. Real-world TOCs use
// `[Headers](#headers)` patterns where the link target is the slugged
// heading text. We mirror GitHub's algorithm: lowercase, strip
// punctuation outside word chars / dashes / spaces, collapse whitespace
// to dashes, trim. Collisions get suffixed `-1`, `-2`, … via a per-render
// counter passed through `env`.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// External links (anything with an absolute http/https/mailto scheme)
// get `rel="noopener noreferrer"`. Two defences for the price of one
// short rule: noopener prevents the destination accessing `window.opener`
// if the user middle-clicks / Cmd-clicks to a new tab; noreferrer
// suppresses the Referer header. Same-page (`#`) and same-origin
// query-only (`?…`) links are left alone — they're navigating the app.
md.renderer.rules.link_open = (tokens, idx, mdOptions, _env, self) => {
  const tok = tokens[idx]!
  const href = tok.attrGet('href') ?? ''
  if (/^(?:https?|mailto):/i.test(href)) {
    tok.attrSet('rel', 'noopener noreferrer')
  }
  return self.renderToken(tokens, idx, mdOptions)
}

md.renderer.rules.heading_open = (tokens, idx, mdOptions, env, self) => {
  const inline = tokens[idx + 1]
  const text = inline?.content ?? ''
  const base = slugify(text)
  if (base) {
    const slugs: Map<string, number> = (env.headingSlugs ??= new Map())
    const seen = slugs.get(base) ?? 0
    // GitHub's algorithm: first occurrence is unsuffixed, subsequent
    // occurrences suffix `-1`, `-2`, … . `seen` is the count of prior
    // occurrences, so it doubles as the suffix index when non-zero.
    const slug = seen === 0 ? base : `${base}-${seen}`
    slugs.set(base, seen + 1)
    tokens[idx]!.attrSet('id', slug)
  }
  return self.renderToken(tokens, idx, mdOptions)
}

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'a', 'ul', 'ol', 'li',
    'code', 'pre',
    'blockquote', 'em', 'strong', 'del', 's',
    'hr', 'br', 'wbr',
    'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div',
    'center',
    'sup', 'sub', 'kbd', 'mark',
    'details', 'summary',
    'figure', 'figcaption',
    'dl', 'dt', 'dd',
    'u', 'i', 'b', 'small', 'q', 'cite', 'abbr', 'time',
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'class', 'id',
    // `align` (deprecated but widely used in READMEs for <div align>
    // and <p align> centring) is presentational-only — no scripting
    // surface. `width`/`height` likewise affect layout, no behaviour.
    'align', 'width', 'height',
    // Table cell spans and <details open> default state.
    'colspan', 'rowspan', 'open',
    // <time datetime="…"> for human-readable timestamps.
    'datetime',
    // Accessibility — read-only, no scripting risk.
    'aria-hidden', 'aria-label', 'aria-labelledby', 'aria-describedby',
    // External-link hardening — see the link_open renderer rule above.
    'rel',
  ],
  // URI scheme validation lives in the hook below rather than in
  // ALLOWED_URI_REGEXP, because DOMPurify v3 applies the regex to every
  // attribute value (not just URL-bearing ones) — that strips `align`,
  // `width`, etc. whose values don't look like URLs. The hook scopes
  // the check to attributes that actually carry URIs.
}

// URI-bearing attributes we want to validate against an explicit scheme
// allowlist. Anything else is left to DOMPurify's tag/attr defaults.
const URI_ATTRS = new Set(['href', 'src', 'xlink:href'])

// Schemes considered safe when explicitly present. URIs with no scheme
// (relative paths, absolute paths, fragment, query) pass through to
// DOMPurify's own checks — that lets a markdown doc reference local
// assets like `/favicon.png` or `assets/cover.png` without being
// stripped, which the previous strict allowlist was doing.
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto'])
const URI_SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i

DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  const raw = data.attrValue?.trim() ?? ''
  const lower = raw.toLowerCase()

  // Belt-and-braces data: block — DOMPurify v3 has an internal allow
  // list that permits data: URIs on img/audio/video/source/track. The
  // hook drops them unconditionally. <img src="data:"> doesn't execute
  // scripts, but <a href="data:image/svg+xml,…<script>"> followed by a
  // click does, and the internal allow list would have permitted it.
  // If inline image embedding lands later, narrow this to permit
  // `data:image/<type>` only on <img src>.
  if (lower.startsWith('data:')) {
    data.keepAttr = false
    return
  }

  if (!URI_ATTRS.has(data.attrName)) return

  // Protocol-relative URLs (//host/path) hide their resolved scheme
  // and are a phishing aid — drop. Rare in real markdown.
  if (raw.startsWith('//')) {
    data.keepAttr = false
    return
  }

  // If a scheme is present, it must be in the safe list. URIs without
  // a scheme — relative or absolute paths, #fragment, ?query — are
  // left to DOMPurify's own handling.
  const m = lower.match(URI_SCHEME_RE)
  if (m && !SAFE_SCHEMES.has(m[1]!)) {
    data.keepAttr = false
  }
})

// Same-origin / same-document hrefs we never rewrite even when a baseUrl
// is set: protocol URIs, protocol-relative URIs, fragment-only (#anchor),
// and query-only (?url=…) — that last form is how in-app deep links work.
const ABSOLUTE_OR_SAME_DOC_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|[#?])/i

function rewriteRelativeUrls(html: string, baseUrl: string): string {
  return html.replace(
    /(\b(?:href|src)=)"([^"]+)"/gi,
    (match, prefix: string, url: string) => {
      if (ABSOLUTE_OR_SAME_DOC_RE.test(url)) return match
      try {
        return `${prefix}"${new URL(url, baseUrl).href}"`
      } catch {
        return match
      }
    },
  )
}

// Direct HTML → safe-HTML pass, for callers that already have HTML (no
// markdown-it round-trip needed). Used by the Tiptap node view that
// previews parked-HTML blocks in Write mode. Accepts a baseUrl so
// relative href / src (e.g. README scaffolding pointing at
// `.github/splash.png`) resolve against the source repo URL — same
// behaviour render() applies for URL-loaded docs.
export interface SanitizeHtmlOptions {
  baseUrl?: string
}

export function sanitizeHtml(html: string, options: SanitizeHtmlOptions = {}): string {
  let out = html
  if (options.baseUrl) {
    out = rewriteRelativeUrls(out, options.baseUrl)
  }
  return DOMPurify.sanitize(out, PURIFY_CONFIG) as string
}

export function render(markdown: string, options: RenderOptions = {}): string {
  // Step 0: convert a small set of common HTML idioms back to markdown
  // so the renderer doesn't elide things it could render natively.
  // See normalize-html.ts for the supported patterns.
  const normalised = normalizeHtml(markdown)
  // Per-render env isolates heading-slug collision counters so two
  // simultaneous renders don't share state (the `md` instance is global).
  let html = md.render(normalised, { headingSlugs: new Map<string, number>() })
  if (options.baseUrl) {
    html = rewriteRelativeUrls(html, options.baseUrl)
  }
  if (options.sanitize === false) return html
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as string
}

// Render plain-text content (LICENSE, CHANGELOG, .txt, …). No markdown
// parsing — the literal characters are preserved so `**` doesn't
// surprise-bold a LICENSE clause. The `.nicermd-plain` class hook lets
// themes override the default <pre> monospace styling so the content
// reads as flowing prose in the theme's reading font; consumers that
// want monospace plain text can ignore the class.
export function renderPlain(text: string): string {
  return DOMPurify.sanitize(`<pre class="nicermd-plain">${escapeHtml(text)}</pre>`, PURIFY_CONFIG) as string
}

// Render a source file with syntax highlighting via the same hljs
// integration as fenced code blocks. Languages outside the registered
// set fall back to escaped monospace (no highlighting). The `.hljs`
// class is the hook for the existing token-color CSS.
export function renderSource(text: string, language: string): string {
  let inner: string
  if (hljs.getLanguage(language)) {
    try {
      const out = hljs.highlight(text, { language, ignoreIllegals: true })
      inner = `<pre><code class="hljs language-${language}">${out.value}</code></pre>`
    } catch {
      inner = `<pre><code class="hljs">${escapeHtml(text)}</code></pre>`
    }
  } else {
    inner = `<pre><code class="hljs">${escapeHtml(text)}</code></pre>`
  }
  return DOMPurify.sanitize(inner, PURIFY_CONFIG) as string
}
