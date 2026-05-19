// Open a markdown file by URL. Scope: GitHub-hosted files only.
// Anything outside the GitHub family of hosts is rejected up front, so
// the prod CSP `connect-src` allowlist stays narrow.
//
// Accepted URL shapes (with what we fetch):
//
//   - github.com/<u>/<r>/blob/<branch>/<path…>.md          → raw equivalent
//   - github.com/<u>/<r>/raw/<branch>/<path…>.md           → raw equivalent
//   - raw.githubusercontent.com/<u>/<r>/<branch>/<…>.md    → passthrough
//   - github.com/<u>/<r>/tree/<branch>[/<dir>]             → README.md there
//   - github.com/<u>/<r>                                   → README.md on
//                                                             main, falling
//                                                             back to master
//   - gist.github.com/<u>/<id>                             → first file via
//                                                             /raw redirect
//   - gist.githubusercontent.com/<u>/<id>/raw/<sha>/<file> → passthrough
//
// Safety posture:
//
//   - Host allowlist at fetch time (raw.githubusercontent.com,
//     gist.githubusercontent.com).
//   - Path-extension filter: explicit blob/raw URLs must end in .md,
//     .markdown, or .mdx (case-insensitive). bare-repo / tree URLs
//     synthesise README.md, so the filter doesn't apply there. Gist
//     /raw endpoints return whatever GitHub serves (gists are typed
//     by content, not extension); we accept the response as long as
//     it's text and within the size cap.
//   - Redirects blocked everywhere (`redirect: 'error'`). Even though
//     gist.github.com/<id>/raw 301s to gist.githubusercontent.com, we
//     never call the gist.github.com endpoint — we go straight to the
//     gist.githubusercontent.com /raw endpoint, which serves content
//     in a single hop with access-control-allow-origin:*. (The
//     gist.github.com redirect response has no CORS headers, so a
//     browser fetch through it would fail before reaching the
//     destination — only curl-style clients see this work.)
//   - 5 MiB ceiling on response bodies — markdown is small, anything
//     larger is almost certainly the wrong file.
//   - Core renderer runs markdown-it with html:false + DOMPurify
//     allowlist, so untrusted content can't smuggle <script>. The
//     allowlist still permits <a href> and <img src> — links go to
//     wherever the file points, and images load from the document's
//     img-src CSP (https:), not connect-src.
//   - Loaded URL is recorded as a 'url' DocSource — Save falls through
//     to Save-As, since we can't write back to GitHub.
//
// Deliberately not in scope:
//
//   - Multi-file gist picker — gist /raw returns the first file (by
//     filename). Users who want a specific file from a multi-file gist
//     can paste the direct gist.githubusercontent.com /raw/<sha>/<file>
//     URL.
//   - Private repos / auth tokens.
//   - URL share param on boot (`?url=…`) — would unlock sharing but
//     wants more thought on phishing risk first.

import type { Harness } from './main'
import { setDocState } from './doc-source'

const RAW_HOST = 'raw.githubusercontent.com'
const GIST_PAGE_HOST = 'gist.github.com'
const GIST_RAW_HOST = 'gist.githubusercontent.com'
const API_HOST = 'api.github.com'
const MAX_BYTES = 5 * 1024 * 1024 // 5 MiB; even big READMEs are nowhere near this.
const MD_EXT_RE = /\.(md|markdown|mdx)$/i

// What kind of document the loaded file is — drives the renderer and
// the mode-toggle visibility. `source` carries an hljs language id
// matching one of the 9 languages registered in nicermd-core.
export type ContentKind =
  | { kind: 'markdown' }
  | { kind: 'plain' }
  | { kind: 'source'; language: string }

// hljs languages registered in nicermd-core/src/index.ts. File
// extensions outside this table fall back to plain text (still
// rendered, just without syntax highlighting).
export const SOURCE_EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  json: 'json',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'svg',
  css: 'css',
}

// Extensionless basenames that conventionally hold plain-text docs.
const PLAIN_TEXT_BASENAMES = /^(LICENSE|LICENCE|COPYING|AUTHORS|CONTRIBUTORS|NOTICE|CHANGELOG|README|INSTALL|NEWS|TODO)$/

// Classify a URL path by its filename. Returns null for unsupported
// shapes (e.g. `.exe`, `.zip`) — those get rejected at parse time so
// the user sees an explicit error rather than a broken render later.
// Exported so doc-source can classify locally-opened files by the
// same rules, and derive save/open filter extensions from the same
// table (single source of truth).
export function classifyPath(path: string): ContentKind | null {
  const clean = path.split('?')[0]!.split('#')[0]!
  const basename = clean.split('/').pop() ?? ''
  if (!basename) return null

  if (MD_EXT_RE.test(basename)) return { kind: 'markdown' }

  const extMatch = basename.match(/\.([a-z0-9]+)$/i)
  const ext = extMatch?.[1]?.toLowerCase()

  if (ext) {
    const lang = SOURCE_EXT_TO_LANG[ext]
    if (lang) return { kind: 'source', language: lang }
    if (ext === 'txt' || ext === 'text') return { kind: 'plain' }
    return null
  }

  // No extension — match against known plain-text doc basenames.
  if (PLAIN_TEXT_BASENAMES.test(basename.toUpperCase())) return { kind: 'plain' }
  return null
}

// Back-compat shim for callers that only need the markdown check
// (the GitHub `/readme` API filter). Kept narrow because the API can
// return `README.rst` etc. and we still don't handle those.
function isMarkdownPath(path: string): boolean {
  const clean = path.split('?')[0]!.split('#')[0]!
  return MD_EXT_RE.test(clean)
}

// Four shapes the parser produces. `direct` covers blob/raw/already-raw
// URLs (and direct gist raw URLs) that map 1:1 onto a single fetchable
// URL. `tree` and `repo` synthesise README.md and may need a branch
// fallback (repo only). `gist` resolves to a gist.githubusercontent.com
// /raw endpoint that serves the latest revision in one CORS-clean hop
// — we never go via gist.github.com.
type Parsed =
  | { kind: 'direct'; rawUrl: string; content: ContentKind }
  | { kind: 'tree'; user: string; repo: string; branch: string; dir: string }
  | { kind: 'repo'; user: string; repo: string }
  | { kind: 'gist'; user: string; id: string }

// reasonCode is the discriminator callers branch on (e.g. "should we
// surface this rejection in the UI?"); reason is the human-readable
// string for direct display. Keeping both means callers can pick
// their own message without re-discriminating on the string.
export type ParseRejectReason = 'not-github' | 'unsupported-file'

type ParseResult =
  | { ok: true; parsed: Parsed }
  | { ok: false; reason: string; reasonCode: ParseRejectReason }

const REASON_NOT_GITHUB = 'Not a GitHub URL'
const REASON_UNSUPPORTED_FILE =
  'Unsupported file — Nicer.md reads markdown, plain text (LICENSE/CHANGELOG/.txt), and common source files'

export function parseGithubUrl(input: string): ParseResult {
  let trimmed = input.trim()
  // Tolerate protocol-less inputs like "github.com/user/repo" — common
  // when copy-pasting from chat / docs that omitted the scheme. Only
  // auto-prepend https:// for hosts we already accept downstream, so
  // this can't widen the host allowlist.
  if (!/^[a-z]+:\/\//i.test(trimmed)) {
    if (
      /^(?:www\.)?github\.com\//.test(trimmed) ||
      trimmed.startsWith('raw.githubusercontent.com/') ||
      trimmed.startsWith('gist.github.com/') ||
      trimmed.startsWith('gist.githubusercontent.com/')
    ) {
      trimmed = `https://${trimmed}`
    }
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, reason: REASON_NOT_GITHUB, reasonCode: 'not-github' }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: REASON_NOT_GITHUB, reasonCode: 'not-github' }

  if (url.hostname === RAW_HOST) {
    const content = classifyPath(url.pathname)
    if (!content) return { ok: false, reason: REASON_UNSUPPORTED_FILE, reasonCode: 'unsupported-file' }
    return { ok: true, parsed: { kind: 'direct', rawUrl: url.toString(), content } }
  }

  // gist.githubusercontent.com paths are revision-specific raw content;
  // pass through as direct (no redirect needed). Gists aren't typed by
  // extension at the URL level, so we treat them as markdown by default
  // (matches pre-plain-text behaviour); content-type sniffing post-fetch
  // could refine this later.
  if (url.hostname === GIST_RAW_HOST) {
    return { ok: true, parsed: { kind: 'direct', rawUrl: url.toString(), content: { kind: 'markdown' } } }
  }

  // gist.github.com/<u>/<id> — gist page; we'll fetch via /<id>/raw
  // which 302s to the latest revision's first file.
  if (url.hostname === GIST_PAGE_HOST) {
    const gistMatch = url.pathname.match(/^\/([^/]+)\/([0-9a-f]+)(?:\/.*)?$/i)
    if (!gistMatch) return { ok: false, reason: REASON_NOT_GITHUB, reasonCode: 'not-github' }
    const [, gistUser, gistId] = gistMatch
    return { ok: true, parsed: { kind: 'gist', user: gistUser!, id: gistId! } }
  }

  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return { ok: false, reason: REASON_NOT_GITHUB, reasonCode: 'not-github' }
  }

  // Strip any trailing slash so /<u>/<r>/ matches the bare-repo branch.
  const path = url.pathname.replace(/\/+$/, '')

  // /<u>/<r>/(blob|raw)/<branch>/<path…> — direct file in a tree.
  const blob = path.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/)
  if (blob) {
    const [, user, repo, rest] = blob
    const content = classifyPath(rest!)
    if (!content) return { ok: false, reason: REASON_UNSUPPORTED_FILE, reasonCode: 'unsupported-file' }
    return { ok: true, parsed: { kind: 'direct', rawUrl: `https://${RAW_HOST}/${user}/${repo}/${rest}`, content } }
  }

  // /<u>/<r>/tree/<branch>[/<dir>] — directory listing on a branch;
  // we render the README.md at that location.
  const tree = path.match(/^\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.*))?$/)
  if (tree) {
    const [, user, repo, branch, dir = ''] = tree
    return { ok: true, parsed: { kind: 'tree', user: user!, repo: repo!, branch: branch!, dir } }
  }

  // /<u>/<r> — bare repo URL; fetch README.md, branch resolved at
  // fetch time (main → master fallback).
  const repo = path.match(/^\/([^/]+)\/([^/]+)$/)
  if (repo) {
    const [, user, repoName] = repo
    return { ok: true, parsed: { kind: 'repo', user: user!, repo: repoName! } }
  }

  return { ok: false, reason: REASON_NOT_GITHUB, reasonCode: 'not-github' }
}

// What we'd fetch if the user pressed Enter right now. For repo URLs
// we show `main/README.md` — the master fallback is silent and only
// kicks in if main 404s. For gists, the /raw endpoint 302s to a
// revision-specific URL we don't know yet, so we show the redirect
// origin as the preview.
function previewUrl(p: Parsed): string {
  switch (p.kind) {
    case 'direct':
      return p.rawUrl
    case 'tree': {
      const dir = p.dir ? `${p.dir}/` : ''
      return `https://${RAW_HOST}/${p.user}/${p.repo}/${p.branch}/${dir}README.md`
    }
    case 'repo':
      return `https://${RAW_HOST}/${p.user}/${p.repo}/main/README.md`
    case 'gist':
      return `https://${GIST_RAW_HOST}/${p.user}/${p.id}/raw`
  }
}

// Candidates to try in priority order. For `repo` we always include
// main + master as fallbacks; `loadFromUrl` prepends the API-derived
// default branch when it can. main + master cover ~all public repos
// at no extra latency cost when the API succeeds, and act as the
// belt-and-braces when the API fails (rate-limited, offline, etc.).
function resolveCandidates(p: Parsed): string[] {
  switch (p.kind) {
    case 'direct':
      return [p.rawUrl]
    case 'tree': {
      const dir = p.dir ? `${p.dir}/` : ''
      return [`https://${RAW_HOST}/${p.user}/${p.repo}/${p.branch}/${dir}README.md`]
    }
    case 'repo':
      return [
        `https://${RAW_HOST}/${p.user}/${p.repo}/main/README.md`,
        `https://${RAW_HOST}/${p.user}/${p.repo}/master/README.md`,
      ]
    case 'gist':
      // gist.githubusercontent.com/<u>/<id>/raw serves the gist's first
      // file in a single hop with CORS headers. We deliberately don't
      // route via gist.github.com/<u>/<id>/raw — its 301 response lacks
      // access-control-allow-origin, so a browser fetch chain breaks
      // before reaching the destination (curl works because curl
      // doesn't enforce CORS).
      return [`https://${GIST_RAW_HOST}/${p.user}/${p.id}/raw`]
  }
}

// Ask api.github.com for the repo's actual README. The `/readme`
// endpoint returns whichever file GitHub considers the README,
// regardless of filename case (`README.md`, `readme.md`,
// `Readme.markdown`, etc.) and regardless of which branch hosts it.
// Returns the `download_url` (a raw.githubusercontent.com URL) on
// success, null on any failure so the caller can fall through to
// the main / master `README.md` heuristic.
//
// We accept download URLs only on the raw host the CSP allows, and
// only when the filename ends in a markdown extension — the API can
// return `README.rst` etc. for non-markdown READMEs, and we have
// nothing useful to do with those today.
async function fetchReadmeDownloadUrl(user: string, repo: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://${API_HOST}/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/readme`, {
      headers: { Accept: 'application/vnd.github+json' },
      redirect: 'error',
    })
    if (!resp.ok) return null
    const data = (await resp.json()) as { name?: unknown; download_url?: unknown }
    if (typeof data.name !== 'string' || !isMarkdownPath(data.name)) return null
    if (typeof data.download_url !== 'string' || !data.download_url) return null
    let parsed: URL
    try {
      parsed = new URL(data.download_url)
    } catch {
      return null
    }
    if (parsed.protocol !== 'https:') return null
    if (parsed.hostname !== RAW_HOST) return null
    return parsed.toString()
  } catch {
    return null
  }
}

class HttpError extends Error {
  status: number
  constructor(status: number, statusText: string) {
    super(`Fetch failed (${status} ${statusText})`)
    this.status = status
  }
}

// --- Recent URLs ---------------------------------------------------------
// A tiny LRU of the last few URLs the user successfully opened. Stored in
// localStorage so it survives reloads. We keep the user's original input
// (so chips show recognisable shapes like `github.com/user/repo` rather
// than the resolved raw URL) plus the displayName the loader computed.

interface RecentEntry {
  input: string
  name: string
}

const RECENT_KEY = 'nicermd:url-recents'
const RECENT_MAX = 5

function readRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((e): e is RecentEntry =>
        e != null &&
        typeof (e as RecentEntry).input === 'string' &&
        typeof (e as RecentEntry).name === 'string',
      )
      .slice(0, RECENT_MAX)
  } catch {
    return []
  }
}

function pushRecent(input: string, name: string): void {
  try {
    const existing = readRecent()
    // Dedupe by input — re-opening a URL bumps it to the top rather
    // than producing a duplicate row.
    const filtered = existing.filter((e) => e.input !== input)
    const next = [{ input, name }, ...filtered].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // localStorage unavailable; recents stay empty for this session.
  }
}

// Strip characters that allow visual confusion in title-strip / recents
// rendering: bidi-override characters (U+202A–E, U+2066–9) reorder
// displayed text; zero-width characters (U+200B–D, U+FEFF) hide
// differences between similar-looking strings; control characters
// (U+0000–1F, U+007F–9F) can corrupt the rendered line. Cap length
// so a long crafted path doesn't overflow the strip. Display goes
// through textContent so HTML injection is moot — this is a phishing-
// aid hardening, not an XSS fix.
function sanitiseDisplayName(name: string): string {
  return name
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // control chars
    .replace(/[\u200B-\u200D\uFEFF]/g, '')          // zero-width chars
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')  // bidi overrides
    .slice(0, 80)
}

// Build a label for the title strip + recents chip. Plain "README.md"
// loses context fast — every bare-repo URL resolves to the same name —
// so we prepend `<user>/<repo>` whenever we can recover it from the
// parsed shape or the raw URL path.
//
//   - repo       →  <user>/<repo>
//   - tree       →  <user>/<repo>[/<dir>]
//   - direct     →  <user>/<repo>/<filename>  (when on raw host)
//   - direct     →  <basename>                (everything else)
//   - gist       →  gist-<first-8-of-id>.md
//
// Trailing `/README.md` is then stripped (case-insensitive) — for the
// dominant URL-load case (someone opens a repo README), the repo path
// is the identifier and the `/README.md` suffix is redundant noise that
// pushes long org/repo combinations into truncation on narrow viewports.
// For non-README files the suffix stays since the filename is what
// disambiguates multiple docs from the same repo.
function displayNameFor(p: Parsed, fetchedUrl: string): string {
  const raw = computeDisplayName(p, fetchedUrl)
  const stripped = raw.replace(/\/README\.md$/i, '')
  return sanitiseDisplayName(stripped || raw)
}

function computeDisplayName(p: Parsed, fetchedUrl: string): string {
  if (p.kind === 'gist') return `gist-${p.id.slice(0, 8)}.md`
  if (p.kind === 'repo') return `${p.user}/${p.repo}`
  if (p.kind === 'tree') {
    const dirSuffix = p.dir ? `/${p.dir}` : ''
    return `${p.user}/${p.repo}${dirSuffix}`
  }
  try {
    const u = new URL(fetchedUrl)
    if (u.hostname === RAW_HOST) {
      // /<user>/<repo>/<branch>/<...path>
      const parts = u.pathname.split('/').filter(Boolean)
      const user = parts[0]
      const repo = parts[1]
      const filename = parts[parts.length - 1]
      if (user && repo && filename) return `${user}/${repo}/${filename}`
    }
    const last = u.pathname.split('/').filter(Boolean).pop()
    return last ?? 'untitled.md'
  } catch {
    return 'untitled.md'
  }
}

async function fetchMarkdown(rawUrl: string): Promise<string> {
  const resp = await fetch(rawUrl, { redirect: 'error' })
  if (!resp.ok) throw new HttpError(resp.status, resp.statusText)
  // Cheap pre-check before reading the body; the streaming cap below
  // is the real defence (servers can lie or omit content-length).
  const declared = Number(resp.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new Error('File is too large (>5 MiB)')
  }
  return readBodyWithCap(resp, MAX_BYTES)
}

// Stream the response body, aborting as soon as cumulative bytes exceed
// `cap`. Previous implementation buffered the whole arrayBuffer first
// and checked size after — meaning an attacker-controlled server could
// transmit up to (cap-1) bytes BEFORE the check, plus a TCP send window
// of overshoot, and we'd still hold the whole thing in memory. The
// streaming variant pulls chunks until the running total exceeds the
// cap, then cancels the reader; no whole-body buffering past the cap.
// `resp.body` may be null on certain older browsers / opaque responses;
// fall back to the arrayBuffer path with the same cap check after.
export async function readBodyWithCap(resp: Response, cap: number): Promise<string> {
  if (!resp.body) {
    const buf = await resp.arrayBuffer()
    if (buf.byteLength > cap) throw new Error('File is too large (>5 MiB)')
    return new TextDecoder('utf-8').decode(buf)
  }
  const reader = resp.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let text = ''
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        // Final flush — picks up any incomplete multi-byte sequence
        // remaining in the decoder's internal buffer.
        text += decoder.decode()
        return text
      }
      received += value.byteLength
      if (received > cap) {
        await reader.cancel('size cap exceeded')
        throw new Error('File is too large (>5 MiB)')
      }
      // stream: true defers errors until the final decode() flush so
      // a multi-byte UTF-8 sequence split across chunks decodes
      // correctly when reassembled.
      text += decoder.decode(value, { stream: true })
    }
  } catch (err) {
    // Make sure the reader is released even on unexpected errors.
    try {
      await reader.cancel()
    } catch {
      // ignore
    }
    throw err
  }
}

export async function loadFromUrl(harness: Harness, input: string): Promise<void> {
  const result = parseGithubUrl(input)
  if (!result.ok) throw new Error(result.reason)
  let candidates = resolveCandidates(result.parsed)

  // For bare-repo URLs, ask the GitHub API for the actual README's
  // raw URL. The `/readme` endpoint handles case-sensitive filenames
  // (`readme.md` vs `README.md`), non-main default branches
  // (`develop`, `trunk`, etc.), and `readme.markdown` / `readme.mdx`
  // — all in one call. The `main/README.md` and `master/README.md`
  // candidates stay as defensive fallbacks for when the API fails
  // (rate-limit, offline, private repo, …).
  if (result.parsed.kind === 'repo') {
    const apiReadmeUrl = await fetchReadmeDownloadUrl(result.parsed.user, result.parsed.repo)
    if (apiReadmeUrl) {
      candidates = [apiReadmeUrl, ...candidates]
    }
  }

  // Try candidates in order; 404 falls through to the next one (happens
  // for bare-repo URLs working through the default-branch / main /
  // master candidates). Any other HTTP status or network error aborts
  // immediately — those aren't recoverable by switching branches.
  let lastError: Error | null = null
  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i]!
    try {
      const text = await fetchMarkdown(url)
      // Source is { kind: 'url', url } — informational only. saveFile
      // treats this as no-save-back (falls through to Save-As), and
      // the title strip exposes it as a hover tooltip via
      // getCurrentSourceUrl(). The display name comes from the URL
      // path so the title strip shows something useful even before
      // hover.
      const name = displayNameFor(result.parsed, url)
      // tree/repo/gist resolve to README.md, so they're implicitly
      // markdown. Only `direct` shapes carry an explicit content kind.
      const contentKind: ContentKind =
        result.parsed.kind === 'direct' ? result.parsed.content : { kind: 'markdown' }
      setDocState(text, name, { kind: 'url', url }, contentKind)
      harness.replaceDoc(text)
      // Record the user's original input (not the resolved URL) — chips
      // show what they typed, and re-clicking re-runs the parser so
      // bare-repo URLs etc. still get current main→master resolution
      // rather than a stale candidate.
      pushRecent(input.trim(), name)
      return
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const isLast = i === candidates.length - 1
      const is404 = err instanceof HttpError && err.status === 404
      if (isLast || !is404) break
      // 404 on a non-last candidate (i.e. main missing for a bare-repo
      // URL) → silently try master next.
    }
  }
  // For bare-repo URLs that 404'd on every candidate, give a more
  // useful message than the raw HTTP error. We tried the API-resolved
  // README URL (which handles arbitrary case + branch) plus the
  // `main/README.md` / `master/README.md` fallbacks; the most likely
  // remaining cause is that the repo has no README at all (or it's a
  // non-markdown file like README.rst that we filter out).
  if (result.parsed.kind === 'repo' && lastError instanceof HttpError && lastError.status === 404) {
    throw new Error('No markdown README found at the repo root — paste a /blob/<branch>/<path> URL for non-root docs')
  }
  throw lastError ?? new Error('Unknown fetch error')
}

// --- Boot-time ?url= and ?ext-pickup handler ----------------------------
// Invoked from main.ts during boot. Three inbound paths to handle:
//
//   1. ?ext-pickup=<token> — Chrome extension opened this tab. The
//      target URL isn't in the address bar; we message the extension
//      with the token and it tells us what URL to load. Forgery-proof
//      because the token is a fresh random UUID held only in the
//      extension's service-worker memory. No gate.
//
//   2. ?url=<github-url> with an internal-nav trust signal
//      (history.state.chainKind === 'chain' OR a same-origin
//      window.opener) — same-tab chain click or new-tab from a
//      modifier-click inside the reader. No gate.
//
//   3. ?url=<github-url> from any other source (share link, paste,
//      external site embedding the URL) — show the phishing gate. The
//      gate is what defends against share-link arrivals that point at
//      attacker-controlled markdown (brand-impersonation content,
//      misleading login mockups, etc.).
//
// Default gate action is Cancel, focused on open. The user has to
// click Open or tab+Enter to actually load — single-key dismissal
// stays safe.
export function processBootUrlParam(harness: Harness): void {
  void processBootUrlParamAsync(harness)
}

async function processBootUrlParamAsync(harness: Harness): Promise<void> {
  const params = new URLSearchParams(window.location.search)

  // Path 1: extension pickup. Token in URL, target URL retrieved via
  // messaging.
  const pickupToken = params.get('ext-pickup')
  if (pickupToken) {
    await processExtensionPickup(harness, pickupToken, params)
    return
  }

  const urlParam = params.get('url')
  if (!urlParam) return

  // Path 2: internal nav (chained click, opener-trusted new tab). Two
  // trust signals identify an internal navigation:
  //
  //   - history.state.chainKind === 'chain' — a chained link click
  //     pushed this URL via pushState; preserved across refresh per
  //     the HTML5 spec.
  //   - Same-origin window.opener — this tab was opened from another
  //     Nicer.md tab via window.open (Cmd / Ctrl / Shift-click on a
  //     rendered link). Cross-origin opener access throws; an
  //     attacker on attacker.com can't fake this signal.
  //
  // Either signal means the user chose the link from a trusted
  // rendered doc; skip the gate and keep the `?url=…` in the address
  // bar so the page stays a copyable share link.
  const state = window.history.state as { chainKind?: string; url?: string } | null
  const fromChainState = state?.chainKind === 'chain' && state.url === urlParam
  const fromTrustedOpener = isSameOriginOpener()
  if (fromChainState || fromTrustedOpener) {
    const result = parseGithubUrl(urlParam)
    if (!result.ok) return
    if (!fromChainState) {
      window.history.replaceState({ chainKind: 'chain', url: urlParam }, '', window.location.href)
    }
    void loadFromUrl(harness, urlParam).catch((err) => {
      console.error('[boot] chained-state load failed:', err)
    })
    return
  }

  // Path 3: external arrival. Strip the param so refresh is a clean
  // re-boot (no re-prompt loop) and the user's address bar shows the
  // canonical app URL even if they glance up before deciding. Then
  // show the gate.
  params.delete('url')
  const remaining = params.toString()
  const newUrl = window.location.pathname + (remaining ? `?${remaining}` : '') + window.location.hash
  window.history.replaceState({}, '', newUrl)

  const result = parseGithubUrl(urlParam)
  if (!result.ok) {
    // Silently ignore malformed / non-GitHub URLs — surfacing a
    // specific reason here helps an attacker probe what shapes the
    // parser accepts. But the `unsupported-file` case is different:
    // the URL IS a GitHub URL the user clearly intended Nicer.md to
    // render, just for a file type we don't support yet. Tell them
    // discreetly so they don't think the share-link is broken.
    if (result.reasonCode === 'unsupported-file') {
      try {
        const basename = new URL(urlParam).pathname.split('/').pop() || urlParam
        const { showNoticeBanner } = await import('./link-chain')
        showNoticeBanner(`${basename} isn't a supported file type yet`)
      } catch {
        // Banner module failed to load — fall through silently.
      }
    }
    return
  }

  showBootConfirmation(harness, urlParam, result.parsed)
}

// --- Chrome extension pickup --------------------------------------------
// `?ext-pickup=<token>` is the arrival shape used by the Nicer.md
// Chrome extension. The target URL isn't in the address bar — we ask
// the extension what it wanted us to load via runtime.sendMessage.
// Restricted at both ends: only nicer.md can talk to the extension
// (externally_connectable.matches in the manifest), and only the
// specific extension ID below is trusted by the page. Tokens are
// random UUIDs held in the extension's service-worker memory; they
// can't be forged, predicted, or replayed.

const NICERMD_EXTENSION_ID = 'mkflkihbecjppfpnjiokofphjcmdbghc'

interface ChromeRuntimeShim {
  runtime?: {
    sendMessage?: (
      extensionId: string,
      message: unknown,
      callback: (response: unknown) => void,
    ) => void
    lastError?: { message?: string }
  }
}

async function processExtensionPickup(
  harness: Harness,
  token: string,
  params: URLSearchParams,
): Promise<void> {
  // Strip the pickup token from the URL bar regardless of outcome — a
  // refresh on `?ext-pickup=…` would otherwise re-attempt a now-
  // invalid pickup and visibly do nothing.
  params.delete('ext-pickup')
  const remaining = params.toString()
  const newUrl = window.location.pathname + (remaining ? `?${remaining}` : '') + window.location.hash
  window.history.replaceState({}, '', newUrl)

  const pickedUrl = await askExtensionForPickup(token)
  if (!pickedUrl) return

  const parsed = parseGithubUrl(pickedUrl)
  if (!parsed.ok) return

  // Rewrite the address bar to the canonical `?url=<picked>` shape
  // and mark it as chained so a refresh stays gate-free. Effectively
  // this turns "I came from the extension" into "I'm a chained nav,"
  // which is the right mental model: both are user-initiated, both
  // are trusted, and the page now reads as a copyable share link.
  const dest = new URL(window.location.href)
  dest.searchParams.set('url', pickedUrl)
  dest.hash = ''
  window.history.replaceState(
    { chainKind: 'chain', url: pickedUrl },
    '',
    dest.toString(),
  )

  try {
    await loadFromUrl(harness, pickedUrl)
  } catch (err) {
    console.error('[ext-pickup] load failed:', err)
  }
}

function askExtensionForPickup(token: string): Promise<string | null> {
  const chromeShim = (globalThis as unknown as { chrome?: ChromeRuntimeShim }).chrome
  const sendMessage = chromeShim?.runtime?.sendMessage
  if (!sendMessage) return Promise.resolve(null)
  return new Promise<string | null>((resolve) => {
    let settled = false
    const finish = (val: string | null): void => {
      if (settled) return
      settled = true
      resolve(val)
    }
    try {
      sendMessage(
        NICERMD_EXTENSION_ID,
        { type: 'pickup-load', token },
        (response: unknown) => {
          // The runtime can populate `lastError` when the extension
          // isn't installed or isn't responding — read it to silence
          // Chrome's "unchecked lastError" warning, then resolve null.
          const _err = chromeShim?.runtime?.lastError
          if (_err) return finish(null)
          if (
            typeof response === 'object' &&
            response !== null &&
            'url' in response &&
            typeof (response as { url: unknown }).url === 'string'
          ) {
            finish((response as { url: string }).url)
          } else {
            finish(null)
          }
        },
      )
      // Defensive timeout in case the callback never fires (extension
      // not installed but the messaging API doesn't error cleanly).
      setTimeout(() => finish(null), 1500)
    } catch {
      finish(null)
    }
  })
}

function isSameOriginOpener(): boolean {
  try {
    const opener = window.opener as Window | null
    if (!opener || opener.closed) return false
    return opener.location.origin === window.location.origin
  } catch {
    // SecurityError on cross-origin access — that's exactly the
    // case we want to reject (opener is some other site).
    return false
  }
}

let bootConfirmOpen = false

function showBootConfirmation(harness: Harness, originalInput: string, parsed: Parsed): void {
  if (bootConfirmOpen) return
  bootConfirmOpen = true

  const backdrop = document.createElement('div')
  backdrop.className = 'url-open__backdrop'

  const panel = document.createElement('div')
  panel.className = 'url-open__panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-label', 'Open URL from link')

  const title = document.createElement('div')
  title.className = 'url-open__title'
  title.textContent = 'Open URL from link?'
  panel.appendChild(title)

  const body = document.createElement('div')
  body.className = 'url-open__body'
  body.textContent = 'A link is asking Nicer.md to load this markdown file:'
  panel.appendChild(body)

  const target = document.createElement('div')
  target.className = 'url-open__hint url-open__hint--preview'
  target.textContent = `→ ${previewUrl(parsed)}`
  panel.appendChild(target)

  const warning = document.createElement('div')
  warning.className = 'url-open__warning'
  warning.textContent = 'Only open links from sources you trust. Markdown content can mimic login pages or include misleading instructions.'
  panel.appendChild(warning)

  const error = document.createElement('div')
  error.className = 'url-open__error'
  panel.appendChild(error)

  const actions = document.createElement('div')
  actions.className = 'url-open__actions'
  // Cancel is the default button (left + primary styling) — a stray
  // Enter / focus loss / click should never load. Open is the
  // explicit affirmative action and must be clicked or Tab-Entered.
  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.className = 'url-open__btn url-open__btn--primary'
  cancelBtn.textContent = 'Cancel'
  const openBtn = document.createElement('button')
  openBtn.type = 'button'
  openBtn.className = 'url-open__btn'
  openBtn.textContent = 'Open'
  actions.append(cancelBtn, openBtn)
  panel.appendChild(actions)

  backdrop.appendChild(panel)
  document.body.appendChild(backdrop)

  const close = (): void => {
    if (!bootConfirmOpen) return
    bootConfirmOpen = false
    window.removeEventListener('keydown', onKeydown, true)
    backdrop.remove()
  }

  const accept = async (): Promise<void> => {
    error.textContent = ''
    openBtn.disabled = true
    cancelBtn.disabled = true
    openBtn.textContent = 'Loading…'
    try {
      await loadFromUrl(harness, originalInput)
      // Mirror the ext-pickup path: once the user has consented and the
      // doc has loaded, restore `?url=<original>` to the address bar and
      // mark it `chainKind: 'chain'` so a refresh hits the trusted-nav
      // path (Path 2) instead of stripping again. Effect: the URL becomes
      // a copyable share link, and refresh re-loads the same doc without
      // re-prompting. The gate's defence only matters on initial arrival
      // from outside; once accepted, this tab is internal.
      const dest = new URL(window.location.href)
      dest.searchParams.set('url', originalInput)
      window.history.replaceState(
        { chainKind: 'chain', url: originalInput },
        '',
        dest.toString(),
      )
      close()
    } catch (err) {
      openBtn.disabled = false
      cancelBtn.disabled = false
      openBtn.textContent = 'Open'
      error.textContent = err instanceof Error ? err.message : String(err)
    }
  }

  const onKeydown = (e: KeyboardEvent): void => {
    if (!bootConfirmOpen) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      // Enter follows the focused button. Default focus is Cancel,
      // so a reflexive Enter dismisses safely. Loading requires
      // either click on Open or arrow/Tab → Enter.
      if (document.activeElement === openBtn) {
        void accept()
      } else {
        close()
      }
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      cancelBtn.focus()
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      openBtn.focus()
      return
    }
  }
  window.addEventListener('keydown', onKeydown, true)

  cancelBtn.addEventListener('click', close)
  openBtn.addEventListener('click', () => void accept())
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close()
  })

  // Default focus on Cancel so reflexive Space / Enter dismisses the
  // dialog rather than confirming a load.
  setTimeout(() => cancelBtn.focus(), 0)
}

let isOpen = false

export function openUrlPrompt(harness: Harness): void {
  if (isOpen) return
  isOpen = true

  const backdrop = document.createElement('div')
  backdrop.className = 'url-open__backdrop'

  const panel = document.createElement('div')
  panel.className = 'url-open__panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-label', 'Open URL')

  const title = document.createElement('div')
  title.className = 'url-open__title'
  title.textContent = 'Open URL'
  panel.appendChild(title)

  const recents = readRecent()

  const input = document.createElement('input')
  input.className = 'url-open__input'
  input.type = 'url'
  input.name = 'open-url'
  input.placeholder = 'https://github.com/…'
  input.setAttribute('aria-label', 'GitHub URL to open')
  input.spellcheck = false
  input.autocomplete = 'off'
  // Same anti-autofill cocktail as the command palette — Chrome /
  // 1Password / LastPass otherwise swallow the first Escape press.
  input.setAttribute('data-form-type', 'other')
  input.setAttribute('data-1p-ignore', 'true')
  input.setAttribute('data-lpignore', 'true')
  panel.appendChild(input)

  // Status line below the input doubles as hint and as a live preview
  // of the normalised raw URL. Keeping both in one slot — instead of a
  // separate hint + preview row — means the modal stays the same height
  // whether the input is empty or filled, so the layout doesn't pop.
  const status = document.createElement('div')
  status.className = 'url-open__hint'
  panel.appendChild(status)

  const error = document.createElement('div')
  error.className = 'url-open__error'
  panel.appendChild(error)

  // Vertical list of recent URLs — only rendered when there are any.
  // Sits between error and actions; each row is { name, url-hint }.
  // Highlight follows arrow-key nav AND mouse hover; Enter on a
  // highlighted row loads it (instead of submitting the input).
  // selectedRecentIdx: -1 = focus is on the input, no recent active.
  let selectedRecentIdx = -1
  const recentRows: HTMLElement[] = []
  if (recents.length > 0) {
    const section = document.createElement('div')
    section.className = 'url-open__recent'

    const heading = document.createElement('div')
    heading.className = 'url-open__recent-heading'
    heading.textContent = 'Recent'
    section.appendChild(heading)

    const list = document.createElement('ul')
    list.className = 'url-open__recent-list'
    list.setAttribute('role', 'listbox')

    recents.forEach((entry, idx) => {
      const row = document.createElement('li')
      row.className = 'url-open__recent-row'
      row.setAttribute('role', 'option')

      const name = document.createElement('span')
      name.className = 'url-open__recent-row__name'
      name.textContent = entry.name

      const url = document.createElement('span')
      url.className = 'url-open__recent-row__url'
      url.textContent = entry.input

      row.append(name, url)

      row.addEventListener('mousemove', () => {
        if (selectedRecentIdx === idx) return
        selectedRecentIdx = idx
        applySelection()
      })
      row.addEventListener('mousedown', (e) => {
        // mousedown rather than click — fires before the input loses
        // focus, so the modal close + load happen synchronously rather
        // than after a focus blur cycle.
        e.preventDefault()
        loadRecent(entry)
      })

      list.appendChild(row)
      recentRows.push(row)
    })

    section.appendChild(list)
    panel.appendChild(section)
  }

  const applySelection = (): void => {
    recentRows.forEach((row, idx) => {
      row.classList.toggle('url-open__recent-row--selected', idx === selectedRecentIdx)
    })
  }

  const HINT_EMPTY = 'Paste a GitHub URL — file, repo, tree, or gist'
  const HINT_INVALID = 'Not recognised — paste a github.com or gist.github.com URL'

  const updateStatus = (): void => {
    const value = input.value.trim()
    if (!value) {
      status.textContent = HINT_EMPTY
      status.classList.remove('url-open__hint--preview')
      return
    }
    const result = parseGithubUrl(value)
    if (result.ok) {
      // Arrow + monospace makes it read like "this is what we'll fetch"
      // rather than a free-form description; the --preview modifier
      // applies the code font + ellipsis clipping for long URLs.
      status.textContent = `→ ${previewUrl(result.parsed)}`
      status.classList.add('url-open__hint--preview')
    } else {
      // While typing, prefer the generic "not recognised" hint over a
      // specific reason — partial URLs trip specific errors like
      // REASON_NOT_MARKDOWN even though the user is mid-paste. The
      // specific reason still surfaces in the error row on submit.
      status.textContent = HINT_INVALID
      status.classList.remove('url-open__hint--preview')
    }
  }
  updateStatus()
  input.addEventListener('input', updateStatus)

  const actions = document.createElement('div')
  actions.className = 'url-open__actions'
  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.className = 'url-open__btn'
  cancelBtn.textContent = 'Cancel'
  const openBtn = document.createElement('button')
  openBtn.type = 'button'
  openBtn.className = 'url-open__btn url-open__btn--primary'
  openBtn.textContent = 'Open'
  actions.append(cancelBtn, openBtn)
  panel.appendChild(actions)

  backdrop.appendChild(panel)
  document.body.appendChild(backdrop)

  const close = (): void => {
    if (!isOpen) return
    isOpen = false
    window.removeEventListener('keydown', onKeydown, true)
    backdrop.remove()
  }

  const submit = async (): Promise<void> => {
    error.textContent = ''
    const value = input.value.trim()
    if (!value) return
    openBtn.disabled = true
    openBtn.textContent = 'Loading…'
    try {
      await loadFromUrl(harness, value)
      close()
    } catch (err) {
      openBtn.disabled = false
      openBtn.textContent = 'Open'
      error.textContent = err instanceof Error ? err.message : String(err)
    }
  }

  // Mirror a recent into the input + run submit, so the load goes through
  // the normal parser/fetch path (re-resolving main→master fallbacks etc.)
  // and any error surfaces in the same place as a typed URL.
  const loadRecent = (entry: RecentEntry): void => {
    input.value = entry.input
    updateStatus()
    void submit()
  }

  const onKeydown = (e: KeyboardEvent): void => {
    if (!isOpen) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    // Down/Up navigate the recents list. -1 means "focus on input" and
    // first Down jumps into the list; Up from row 0 goes back to -1
    // (input). Out of range values get clamped to the row count.
    if (e.key === 'ArrowDown' && recents.length > 0) {
      e.preventDefault()
      selectedRecentIdx = Math.min(selectedRecentIdx + 1, recents.length - 1)
      applySelection()
      return
    }
    if (e.key === 'ArrowUp' && recents.length > 0) {
      e.preventDefault()
      selectedRecentIdx = Math.max(selectedRecentIdx - 1, -1)
      applySelection()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      // If a recent is highlighted, load it; otherwise submit the input.
      if (selectedRecentIdx >= 0 && selectedRecentIdx < recents.length) {
        loadRecent(recents[selectedRecentIdx]!)
      } else {
        void submit()
      }
      return
    }
  }
  window.addEventListener('keydown', onKeydown, true)
  // Belt-and-braces direct binding on the input — Chrome's autofill
  // machinery sometimes intercepts Escape on focused inputs before
  // the window listener sees it.
  input.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close()
    },
    true,
  )

  cancelBtn.addEventListener('click', close)
  openBtn.addEventListener('click', () => void submit())
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close()
  })

  setTimeout(() => input.focus(), 0)

  // Best-effort clipboard prefill. If the user just copied a GitHub URL
  // (the most common reason to open this dialog), drop it into the
  // input pre-selected so Enter immediately submits and any keystroke
  // replaces it. Skipped silently when:
  //   - we're inside Tauri/WKWebView on macOS — clipboard.readText
  //     triggers a system "Allow paste?" sheet that renders BEFORE
  //     our modal becomes visible. Browsers handle this silently in
  //     the normal flow, but the WebKit-on-macOS prompt is jarring.
  //     Tauri users naturally Cmd+V into the field instead.
  //   - the Clipboard API isn't available (older browsers)
  //   - the user / browser denies read permission
  //   - the clipboard text isn't a normalisable GitHub URL — we don't
  //     want to paste arbitrary clipboard contents into the input,
  //     since the user might have something private on their clipboard
  //     and would have to manually clear it.
  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  if (inTauri) return
  void (async () => {
    try {
      const text = await navigator.clipboard?.readText()
      const trimmed = text?.trim()
      if (!trimmed || !parseGithubUrl(trimmed).ok) return
      // Don't clobber if the user has already started typing in the
      // tiny window between modal mount and clipboard resolution.
      if (input.value) return
      input.value = trimmed
      input.select()
      updateStatus()
    } catch {
      // Permission denied / unavailable — fall through silently.
    }
  })()
}
