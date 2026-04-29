import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { getTheme, getThemes } from './themes.js'

export { getTheme, getThemes }
export type { Theme, ThemeMode } from './themes.js'

export interface RenderOptions {
  theme?: string
  sanitize?: boolean
  // Resolves relative href / src in the rendered HTML against this URL.
  // Used for URL-loaded docs whose `images/foo.png` etc. would otherwise
  // 404 against the app origin instead of the source repo.
  baseUrl?: string
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  typographer: true,
})

// Block-level HTML is a markdown-reader anti-pattern: GitHub READMEs
// commonly nest `<div align="center">` scaffolding around logos, badges,
// and sponsor strips that don't translate outside GitHub's renderer.
// We replace each block with a thin centered ellipsis so the reader
// sees that something was elided without rendering the soup. Inline HTML
// drops silently except for a small allowlist of useful formatting tags
// (br/kbd/sub/sup/mark); DOMPurify still gates final output.
const ELIDED_PLACEHOLDER =
  '<div class="nicermd-html-elided" aria-hidden="true">⋯</div>\n'

md.renderer.rules.html_block = () => ELIDED_PLACEHOLDER

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

md.renderer.rules.heading_open = (tokens, idx, mdOptions, env, self) => {
  const inline = tokens[idx + 1]
  const text = inline?.content ?? ''
  const base = slugify(text)
  if (base) {
    const slugs: Map<string, number> = (env.headingSlugs ??= new Map())
    const seen = slugs.get(base)
    const slug = seen === undefined ? base : `${base}-${seen + 1}`
    slugs.set(base, (seen ?? 0) + 1)
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
    'hr', 'br',
    'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div',
    'sup', 'sub', 'kbd', 'mark',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'aria-hidden'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[#?]|data:image\/(?:png|jpe?g|gif|webp|svg\+xml))/i,
}

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

// Awesome-style docs put N consecutive HTML blocks back-to-back;
// collapse the run into a single placeholder so the reader doesn't see
// a wall of ellipses.
function collapseElidedPlaceholders(html: string): string {
  return html.replace(
    /(<div class="nicermd-html-elided"[^>]*>⋯<\/div>\s*){2,}/g,
    ELIDED_PLACEHOLDER,
  )
}

export function render(markdown: string, options: RenderOptions = {}): string {
  // Per-render env isolates heading-slug collision counters so two
  // simultaneous renders don't share state (the `md` instance is global).
  let html = md.render(markdown, { headingSlugs: new Map<string, number>() })
  html = collapseElidedPlaceholders(html)
  if (options.baseUrl) {
    html = rewriteRelativeUrls(html, options.baseUrl)
  }
  if (options.sanitize === false) return html
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as string
}
