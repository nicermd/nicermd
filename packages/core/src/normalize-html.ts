import MarkdownIt from 'markdown-it'

// Pre-render pass that converts a small set of common HTML idioms back
// into their markdown equivalents. Runs before the main render pipeline
// (and before the Tiptap mount in shells that have one) so block HTML
// that was previously elided now renders as real markdown — and so the
// Tiptap round-trip is identity-stable when the user toggles in and out
// of Write mode without editing.
//
// The set of transforms is intentionally narrow:
//
//   <img src="X" alt="Y" …>            → ![Y](X)
//   <a href="H"><img …></a>            → [![alt](src)](H)
//   <div|p align="…">…</div|p>         → unwrap; recurse on inner
//   <center>…</center>                 → unwrap; recurse on inner
//   <br>, <br/>, <br />                → blank line
//
// Anything else is returned unchanged — the existing block-HTML elision
// in the renderer still catches it. This is deliberate: arbitrary HTML
// is the project's primary attack surface, and we'd rather elide than
// hand-parse a long tail of constructs.
//
// Why use markdown-it for tokenisation rather than scanning the source
// directly: HTML inside fenced code blocks, indented code, or inline
// code spans must not be touched. markdown-it already knows how to find
// `html_block` tokens (with line ranges) — we just borrow that.

const tokenizer = new MarkdownIt({ html: true })

interface Replacement {
  startLine: number
  endLine: number
  text: string
}

export function normalizeHtml(markdown: string): string {
  // Quick exit — most prose has no `<` to find. Saves the tokenisation
  // cost on the common case.
  if (!markdown.includes('<')) return markdown

  const replacements = collectReplacements(markdown)
  if (replacements.length === 0) return markdown

  // Apply bottom-up so earlier line indices stay valid as we splice.
  replacements.sort((a, b) => b.startLine - a.startLine)

  const lines = markdown.split('\n')
  for (const { startLine, endLine, text } of replacements) {
    const replacementLines = text === '' ? [] : text.split('\n')
    lines.splice(startLine, endLine - startLine, ...replacementLines)
  }
  return lines.join('\n')
}

function collectReplacements(markdown: string): Replacement[] {
  const tokens = tokenizer.parse(markdown, {})
  const out: Replacement[] = []
  for (const tok of tokens) {
    if (tok.type !== 'html_block' || !tok.map) continue
    const replacement = transformBlock(tok.content)
    if (replacement === null) continue
    out.push({ startLine: tok.map[0], endLine: tok.map[1], text: replacement })
  }
  return out
}

// --- Block transforms ----------------------------------------------------

function transformBlock(html: string): string | null {
  const trimmed = html.trim()
  if (trimmed === '') return null

  // Order matters: linked-image must be tried before bare image
  // (otherwise the inner <img> would match first), and wrapper
  // matching is last so it can recurse on still-HTML content.

  const linkedImg = matchLinkedImg(trimmed)
  if (linkedImg !== null) return linkedImg

  const img = matchImg(trimmed)
  if (img !== null) return img

  if (matchBr(trimmed)) return ''

  // Wrappers like <div align="center">, <p align="center">, <center>
  // used to be unwrapped here so the inner image could be hoisted into
  // a real markdown image. That stripped the centring along with the
  // wrapper, which made Tauri- and Awesome-style READMEs look noticeably
  // off versus how they read on GitHub. Now that DOMPurify's allowlist
  // includes <center> and the `align` attribute, wrappers render in
  // place — with their centring intact. We keep them as raw HTML and
  // let the renderer's html_block path (and DOMPurify) carry them
  // through unchanged.
  return null
}

// --- Pattern matchers ----------------------------------------------------

const IMG_ATTR_RE = /^<img\b([^>]*?)\/?>$/is

function matchImg(html: string): string | null {
  const m = IMG_ATTR_RE.exec(html)
  if (!m) return null
  const attrs = parseAttrs(m[1] ?? '')
  const src = attrs.src
  if (!src) return null
  // If the img carries attributes that markdown image syntax can't
  // express, return null so the raw HTML passes through to render()
  // unchanged — DOMPurify then preserves width/height/loading/srcset
  // on the rendered <img>. Without this, normalising would silently
  // drop those attrs.
  if (attrs.width || attrs.height || attrs.loading || attrs.srcset || attrs.sizes) return null
  const alt = attrs.alt ?? ''
  const title = attrs.title
  return title ? `![${alt}](${src} "${escapeMdTitle(title)}")` : `![${alt}](${src})`
}

const LINKED_IMG_RE = /^<a\b([^>]*)>\s*(<img\b[^>]*?\/?>)\s*<\/a>$/is

function matchLinkedImg(html: string): string | null {
  const m = LINKED_IMG_RE.exec(html)
  if (!m) return null
  const aAttrs = parseAttrs(m[1] ?? '')
  const href = aAttrs.href
  if (!href) return null
  const innerImg = matchImg(m[2] ?? '')
  if (innerImg === null) return null
  return `[${innerImg}](${href})`
}

const BR_RE = /^<br\s*\/?>$/i

function matchBr(html: string): boolean {
  return BR_RE.test(html)
}

// --- Attribute parsing ---------------------------------------------------

const ATTR_RE = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  let m: RegExpExecArray | null
  ATTR_RE.lastIndex = 0
  while ((m = ATTR_RE.exec(s)) !== null) {
    out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}

function escapeMdTitle(s: string): string {
  return s.replace(/"/g, '\\"')
}

// --- Predicate exposed for the banner UI --------------------------------

// Cheap "does this document have HTML the round-trip might mangle?"
// check. Used by the website shell to decide whether to surface the
// "switching to Write may convert HTML" banner. We say yes only when
// the source actually contains a block-HTML token that the existing
// elision would have handled — running normalizeHtml and comparing is
// the most accurate test, since it captures exactly the set of inputs
// where Write-mode round-trip behaviour changes.
export function containsHtml(markdown: string): boolean {
  if (!markdown.includes('<')) return false
  const tokens = tokenizer.parse(markdown, {})
  return tokens.some((t) => t.type === 'html_block' || t.type === 'html_inline')
}
