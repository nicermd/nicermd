// Platform-conditional content blocks in markdown.
//
// Syntax:
//   <!-- :platform mac -->
//   Content only shown on macOS.
//   <!-- :end -->
//
//   <!-- :platform win linux -->
//   Content shown on Windows or Linux.
//   <!-- :end -->
//
// HTML comments survive markdown-it's lexer (`html: true`) but render
// as DOM Comment nodes that aren't visible — and DOMPurify strips
// them entirely. So if we DIDN'T strip blocks at the source level,
// the comment-fence syntax would still leak through: the markers
// vanish but the bodies between them would render unconditionally.
//
// Stripping happens at boot, on the raw showcase.md text, before
// the markdown ever hits the renderer.

import type { PlatformKind } from './platform'

// Matches a single fenced block. Captures the platform list and the body.
// - `[\w\s]+?` (lazy) matches one or more whitespace-separated tokens.
// - `\n?` after each marker consumes the trailing newline so a stripped
//   block doesn't leave a stray blank line behind.
// - `[\s\S]*?` (lazy) lets the body span lines without crossing into the
//   next `<!-- :end -->`.
const BLOCK_RE = /<!--\s*:platform\s+([\w\s]+?)\s*-->\n?([\s\S]*?)<!--\s*:end\s*-->\n?/g

export function stripPlatformBlocks(markdown: string, platform: PlatformKind): string {
  return markdown.replace(BLOCK_RE, (_match, platforms: string, body: string) => {
    const allowed = platforms.trim().split(/\s+/)
    return allowed.includes(platform) ? body : ''
  })
}
