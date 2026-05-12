import MarkdownIt from 'markdown-it'

// "Parking" is a Tiptap-round-trip-safety transform: every block of HTML
// in the source is wrapped in a fenced code block with a sentinel info
// string. Tiptap treats fenced code blocks as opaque source text — it
// preserves them byte-for-byte across parse → edit → serialise, which
// raw HTML emphatically is not. On the way out we unwrap by stripping
// the fences and the sentinel.
//
// What this gets us: editing in Write mode no longer mutates HTML
// scaffolding the user didn't touch. The dirty round-trip is now
// equivalent to identity for the HTML regions; only the parts the user
// actually edited see Tiptap's serialiser.
//
// Why a code block rather than a custom Tiptap node:
// - No Tiptap schema work; the code-block primitive already exists.
// - Markdown-it tokenises the parked form back into a fence on the way
//   out, which is what we want for the unpark step.
// - Visible to the user in Write mode as "this is HTML I am preserving
//   verbatim" — honest, predictable.
//
// The sentinel info string is intentionally ugly so it doesn't collide
// with any real language tag a user might type by hand.

const tokenizer = new MarkdownIt({ html: true })

const PARK_INFO = '__nicermd_html__'

interface Replacement {
  startLine: number
  endLine: number
  text: string
}

export function parkHtml(markdown: string): string {
  if (!markdown.includes('<')) return markdown
  const tokens = tokenizer.parse(markdown, {})
  const replacements: Replacement[] = []
  for (const tok of tokens) {
    if (tok.type !== 'html_block' || !tok.map) continue
    replacements.push({
      startLine: tok.map[0],
      endLine: tok.map[1],
      text: wrapInFence(tok.content),
    })
  }
  if (replacements.length === 0) return markdown
  replacements.sort((a, b) => b.startLine - a.startLine)
  const lines = markdown.split('\n')
  for (const { startLine, endLine, text } of replacements) {
    const replacementLines = text.split('\n')
    lines.splice(startLine, endLine - startLine, ...replacementLines)
  }
  return lines.join('\n')
}

function wrapInFence(html: string): string {
  // Strip the trailing newline markdown-it includes in html_block.content
  // — the surrounding line splice already accounts for line boundaries.
  const body = html.replace(/\n+$/, '')
  // Choose a fence length longer than any backtick run inside the HTML
  // so the body can't accidentally close the fence early. Real-world
  // HTML almost never contains backticks; this is a paranoid case.
  const maxRun = longestBacktickRun(body)
  const fence = '`'.repeat(Math.max(3, maxRun + 1))
  return `${fence}${PARK_INFO}\n${body}\n${fence}`
}

function longestBacktickRun(s: string): number {
  let max = 0
  let cur = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '`') {
      cur++
      if (cur > max) max = cur
    } else {
      cur = 0
    }
  }
  return max
}

// Inverse of parkHtml — finds every fenced code block whose info string
// is our sentinel and replaces it (including the fences) with the
// original HTML body. Anything else (real user-written code blocks)
// is left untouched.
//
// Implementation walks lines rather than regex: a backreference for
// fence length across multiline content is awkward, and we already
// have to scan for matching opens/closes anyway.
export function unparkHtml(markdown: string): string {
  if (!markdown.includes(PARK_INFO)) return markdown
  const lines = markdown.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const open = matchParkOpen(line)
    if (!open) {
      out.push(line)
      i++
      continue
    }
    // Find the matching close — same fence character, length >= open.
    const closeIdx = findFenceClose(lines, i + 1, open.fence)
    if (closeIdx === -1) {
      // Unterminated — leave verbatim. Shouldn't happen from our own
      // parker but a paranoid bail keeps the function total.
      out.push(line)
      i++
      continue
    }
    // Emit the body lines, drop the fences.
    for (let j = i + 1; j < closeIdx; j++) out.push(lines[j]!)
    i = closeIdx + 1
  }
  return out.join('\n')
}

function matchParkOpen(line: string): { fence: string } | null {
  // Fences may have leading whitespace but our parker emits them at
  // column 0, so only match at column 0 to avoid eating user code.
  const m = /^(`{3,})__nicermd_html__\s*$/.exec(line)
  if (!m) return null
  return { fence: m[1]! }
}

function findFenceClose(lines: string[], from: number, openFence: string): number {
  const minLen = openFence.length
  for (let i = from; i < lines.length; i++) {
    const m = /^(`{3,})\s*$/.exec(lines[i]!)
    if (m && m[1]!.length >= minLen) return i
  }
  return -1
}
