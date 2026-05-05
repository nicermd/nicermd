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

  const wrapped = matchWrapper(trimmed)
  if (wrapped !== null) {
    // The inner of a wrapper is HTML, not markdown — markdown-it would
    // fold consecutive HTML lines into one block and our patterns only
    // match single elements. Walk the inner directly as HTML, applying
    // transformBlock to each top-level element we find.
    return normalizeInnerHtml(wrapped).trim()
  }

  return null
}

// Walks an HTML fragment, applying transformBlock to each top-level
// element. Whitespace between elements is preserved verbatim. Used for
// wrapper inners; not for top-level markdown processing (that's the job
// of the markdown-it tokeniser pass at entry).
function normalizeInnerHtml(inner: string): string {
  const out: string[] = []
  let pos = 0
  while (pos < inner.length) {
    const ws = /^\s+/.exec(inner.slice(pos))
    if (ws) {
      out.push(ws[0])
      pos += ws[0].length
      continue
    }
    if (inner[pos] !== '<') {
      // Plain text run between elements — keep verbatim.
      const nextLt = inner.indexOf('<', pos)
      if (nextLt === -1) {
        out.push(inner.slice(pos))
        break
      }
      out.push(inner.slice(pos, nextLt))
      pos = nextLt
      continue
    }
    const elem = readElement(inner, pos)
    if (!elem) {
      // Malformed or unrecognised HTML — pass remainder through.
      out.push(inner.slice(pos))
      break
    }
    const transformed = transformBlock(elem.text)
    out.push(transformed !== null ? transformed : elem.text)
    pos = elem.end
  }
  return out.join('')
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr',
  'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
])

interface ReadElement {
  text: string
  end: number
}

function readElement(s: string, from: number): ReadElement | null {
  const startMatch = /^<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)(\/?)>/s.exec(s.slice(from))
  if (!startMatch) return null
  const tag = startMatch[1]!.toLowerCase()
  const isSelfClosing = startMatch[3] === '/' || VOID_ELEMENTS.has(tag)
  const openEnd = from + startMatch[0].length
  if (isSelfClosing) return { text: s.slice(from, openEnd), end: openEnd }
  const closeIdx = findMatchingClose(s, tag, openEnd)
  if (closeIdx === -1) return null
  const closeEnd = s.indexOf('>', closeIdx) + 1
  return { text: s.slice(from, closeEnd), end: closeEnd }
}

// --- Pattern matchers ----------------------------------------------------

const IMG_ATTR_RE = /^<img\b([^>]*?)\/?>$/is

function matchImg(html: string): string | null {
  const m = IMG_ATTR_RE.exec(html)
  if (!m) return null
  const attrs = parseAttrs(m[1] ?? '')
  const src = attrs.src
  if (!src) return null
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

// --- Wrapper unwrap (depth-counting find of matching close) --------------

const WRAPPER_OPEN_RE = /^<(div|p)\b([^>]*\balign\s*=\s*("center"|'center'|center)[^>]*)>/is
const CENTER_OPEN_RE = /^<center\b([^>]*)>/is

function matchWrapper(html: string): string | null {
  let tag: 'div' | 'p' | 'center'
  let openLen: number
  const divP = WRAPPER_OPEN_RE.exec(html)
  const center = CENTER_OPEN_RE.exec(html)
  if (divP) {
    tag = divP[1]!.toLowerCase() as 'div' | 'p'
    openLen = divP[0].length
  } else if (center) {
    tag = 'center'
    openLen = center[0].length
  } else {
    return null
  }

  const closeIdx = findMatchingClose(html, tag, openLen)
  if (closeIdx === -1) return null

  // The matched wrapper must be the entire block — otherwise we'd be
  // unwrapping something embedded in a larger HTML soup, which the
  // elision should keep covering as a unit.
  const closeTagEnd = html.indexOf('>', closeIdx) + 1
  const trailing = html.slice(closeTagEnd).trim()
  if (trailing !== '') return null

  return html.slice(openLen, closeIdx).trim()
}

function findMatchingClose(html: string, tag: string, from: number): number {
  // Walks the string counting opens/closes of `tag`. Returns the index
  // of the `<` of the matching close, or -1 if not balanced. Case-
  // insensitive on the tag name; ignores whitespace inside close tag.
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi')
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi')
  let depth = 1
  let pos = from
  // eslint-disable-next-line no-constant-condition
  while (true) {
    openRe.lastIndex = pos
    closeRe.lastIndex = pos
    const nextOpen = openRe.exec(html)
    const nextClose = closeRe.exec(html)
    if (!nextClose) return -1
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++
      pos = nextOpen.index + nextOpen[0].length
    } else {
      depth--
      if (depth === 0) return nextClose.index
      pos = nextClose.index + nextClose[0].length
    }
  }
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
