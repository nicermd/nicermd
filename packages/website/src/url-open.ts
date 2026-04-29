// Open a markdown file by URL. Spike scope: GitHub-hosted files only.
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
//   - Default-branch lookup via api.github.com — would expand the CSP
//     and add an extra hop. The main→master fallback covers ~all
//     public repos in the wild without a separate API call.

import type { Harness } from './main'
import { setDocState } from './doc-source'

const RAW_HOST = 'raw.githubusercontent.com'
const GIST_PAGE_HOST = 'gist.github.com'
const GIST_RAW_HOST = 'gist.githubusercontent.com'
const MAX_BYTES = 5 * 1024 * 1024 // 5 MiB; markdown is never this big.
const MD_EXT_RE = /\.(md|markdown|mdx)$/i

// Strip query / fragment before testing the extension — paths like
// `path/file.md?token=...` should still match.
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
  | { kind: 'direct'; rawUrl: string }
  | { kind: 'tree'; user: string; repo: string; branch: string; dir: string }
  | { kind: 'repo'; user: string; repo: string }
  | { kind: 'gist'; user: string; id: string }

type ParseResult = { ok: true; parsed: Parsed } | { ok: false; reason: string }

const REASON_NOT_GITHUB = 'Not a GitHub URL'
const REASON_NOT_MARKDOWN = 'URL must point to a .md, .markdown, or .mdx file'

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
    return { ok: false, reason: REASON_NOT_GITHUB }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: REASON_NOT_GITHUB }

  if (url.hostname === RAW_HOST) {
    if (!isMarkdownPath(url.pathname)) return { ok: false, reason: REASON_NOT_MARKDOWN }
    return { ok: true, parsed: { kind: 'direct', rawUrl: url.toString() } }
  }

  // gist.githubusercontent.com paths are revision-specific raw content;
  // pass through as direct (no redirect needed). Path-extension filter
  // doesn't apply — gists aren't typed by extension.
  if (url.hostname === GIST_RAW_HOST) {
    return { ok: true, parsed: { kind: 'direct', rawUrl: url.toString() } }
  }

  // gist.github.com/<u>/<id> — gist page; we'll fetch via /<id>/raw
  // which 302s to the latest revision's first file.
  if (url.hostname === GIST_PAGE_HOST) {
    const gistMatch = url.pathname.match(/^\/([^/]+)\/([0-9a-f]+)(?:\/.*)?$/i)
    if (!gistMatch) return { ok: false, reason: REASON_NOT_GITHUB }
    const [, gistUser, gistId] = gistMatch
    return { ok: true, parsed: { kind: 'gist', user: gistUser!, id: gistId! } }
  }

  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return { ok: false, reason: REASON_NOT_GITHUB }
  }

  // Strip any trailing slash so /<u>/<r>/ matches the bare-repo branch.
  const path = url.pathname.replace(/\/+$/, '')

  // /<u>/<r>/(blob|raw)/<branch>/<path…> — direct file in a tree.
  const blob = path.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/)
  if (blob) {
    const [, user, repo, rest] = blob
    if (!isMarkdownPath(rest!)) return { ok: false, reason: REASON_NOT_MARKDOWN }
    return { ok: true, parsed: { kind: 'direct', rawUrl: `https://${RAW_HOST}/${user}/${repo}/${rest}` } }
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

  return { ok: false, reason: REASON_NOT_GITHUB }
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

// Candidates to try in priority order. `repo` produces two — main first
// (modern default), master as fallback for pre-2020 / legacy repos —
// without an api.github.com call.
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
function displayNameFor(p: Parsed, fetchedUrl: string): string {
  const raw = computeDisplayName(p, fetchedUrl)
  return sanitiseDisplayName(raw)
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
  // Cheap pre-check before reading the body; the byte cap below is the
  // real defence (servers can lie or omit content-length).
  const declared = Number(resp.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new Error('File is too large (>5 MiB)')
  }
  const buf = await resp.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) {
    throw new Error('File is too large (>5 MiB)')
  }
  return new TextDecoder('utf-8').decode(buf)
}

export async function loadFromUrl(harness: Harness, input: string): Promise<void> {
  const result = parseGithubUrl(input)
  if (!result.ok) throw new Error(result.reason)
  const candidates = resolveCandidates(result.parsed)

  // Try candidates in order; 404 falls through to the next one (only
  // happens for bare-repo URLs trying main → master). Any other HTTP
  // status or network error aborts immediately — those aren't recoverable
  // by switching branches.
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
      setDocState(text, name, { kind: 'url', url })
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
  // For bare-repo URLs that 404'd on every branch we tried, give a more
  // useful message than the raw HTTP error.
  if (result.parsed.kind === 'repo' && lastError instanceof HttpError && lastError.status === 404) {
    throw new Error('README.md not found on main or master — paste a /blob/<branch> URL for non-standard branches')
  }
  throw lastError ?? new Error('Unknown fetch error')
}

// --- Boot-time ?url= handler --------------------------------------------
// Invoked from main.ts during boot. If the inbound URL carries a ?url=
// param that parses as a GitHub URL, show a confirmation modal before
// fetching — defends against social-engineered links that point at
// attacker-controlled markdown (e.g. brand-impersonation content). The
// param is stripped from the address bar immediately so a refresh
// doesn't re-trigger the gate or leak the source URL into history /
// share menus.
//
// Default action is Cancel, focused on open. The user has to click Open
// or tab+Enter to actually load — single-key dismissal stays safe.
export function processBootUrlParam(harness: Harness): void {
  const params = new URLSearchParams(window.location.search)
  const urlParam = params.get('url')
  if (!urlParam) return

  // Strip the param from the URL bar before showing the modal, so the
  // user's address bar shows the canonical app URL even if they
  // glance up before deciding. Also makes refresh a clean re-boot
  // (without re-prompting) rather than a re-prompt loop.
  params.delete('url')
  const remaining = params.toString()
  const newUrl = window.location.pathname + (remaining ? `?${remaining}` : '') + window.location.hash
  window.history.replaceState({}, '', newUrl)

  const result = parseGithubUrl(urlParam)
  // Silently ignore malformed / non-GitHub URLs in the param. We don't
  // want to surface specific parser reasons here — reduces phishing
  // signal value (an attacker could probe what shapes are accepted).
  if (!result.ok) return

  showBootConfirmation(harness, urlParam, result.parsed)
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
  input.placeholder = 'https://github.com/…'
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
