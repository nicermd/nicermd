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
//     gist.github.com, gist.githubusercontent.com).
//   - Path-extension filter: explicit blob/raw URLs must end in .md,
//     .markdown, or .mdx (case-insensitive). bare-repo / tree URLs
//     synthesise README.md, so the filter doesn't apply there. Gist
//     /raw endpoints return whatever GitHub serves (gists are typed
//     by content, not extension); we accept the response as long as
//     it's text and within the size cap.
//   - Redirects: blocked by default (`redirect: 'error'`). The gist
//     /raw endpoint 302s to the resolved revision, so for that single
//     candidate type we allow follow + post-fetch host check that the
//     final URL still lives on gist.githubusercontent.com.
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
// fallback (repo only). `gist` resolves via gist.github.com/<id>/raw,
// which 302s to the latest revision — handled with redirect:'follow'
// gated to gist.githubusercontent.com only.
type Parsed =
  | { kind: 'direct'; rawUrl: string }
  | { kind: 'tree'; user: string; repo: string; branch: string; dir: string }
  | { kind: 'repo'; user: string; repo: string }
  | { kind: 'gist'; user: string; id: string }

type ParseResult = { ok: true; parsed: Parsed } | { ok: false; reason: string }

const REASON_NOT_GITHUB = 'Not a GitHub URL'
const REASON_NOT_MARKDOWN = 'URL must point to a .md, .markdown, or .mdx file'

function parseGithubUrl(input: string): ParseResult {
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
      return `https://${GIST_PAGE_HOST}/${p.user}/${p.id}/raw`
  }
}

// A fetch candidate. Gist /raw URLs need redirect-follow because the
// canonical /raw endpoint 302s to a revision-specific URL on
// gist.githubusercontent.com; everything else fetches with strict
// `redirect: 'error'`. allowedFinalHosts gates the post-redirect host
// so a hypothetical chain still can't end up off the GitHub family.
interface Candidate {
  url: string
  allowRedirect: boolean
  allowedFinalHosts?: readonly string[]
}

// Candidates to try in priority order. `repo` produces two — main first
// (modern default), master as fallback for pre-2020 / legacy repos —
// without an api.github.com call.
function resolveCandidates(p: Parsed): Candidate[] {
  switch (p.kind) {
    case 'direct':
      return [{ url: p.rawUrl, allowRedirect: false }]
    case 'tree': {
      const dir = p.dir ? `${p.dir}/` : ''
      return [{ url: `https://${RAW_HOST}/${p.user}/${p.repo}/${p.branch}/${dir}README.md`, allowRedirect: false }]
    }
    case 'repo':
      return [
        { url: `https://${RAW_HOST}/${p.user}/${p.repo}/main/README.md`, allowRedirect: false },
        { url: `https://${RAW_HOST}/${p.user}/${p.repo}/master/README.md`, allowRedirect: false },
      ]
    case 'gist':
      return [
        {
          url: `https://${GIST_PAGE_HOST}/${p.user}/${p.id}/raw`,
          allowRedirect: true,
          allowedFinalHosts: [GIST_RAW_HOST],
        },
      ]
  }
}

class HttpError extends Error {
  status: number
  constructor(status: number, statusText: string) {
    super(`Fetch failed (${status} ${statusText})`)
    this.status = status
  }
}

// Pull a sensible filename for the title strip out of the rewritten
// raw URL. raw.githubusercontent path looks like
// /<user>/<repo>/<branch>/<path…>, so basename of the path is what
// the user expects to see.
function filenameFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    const last = u.pathname.split('/').filter(Boolean).pop()
    return last ?? 'untitled.md'
  } catch {
    return 'untitled.md'
  }
}

async function fetchMarkdown(c: Candidate): Promise<{ text: string; finalUrl: string }> {
  const resp = await fetch(c.url, { redirect: c.allowRedirect ? 'follow' : 'error' })
  if (!resp.ok) throw new HttpError(resp.status, resp.statusText)
  // Post-redirect host check — gist /raw 302s within the GitHub family
  // but we still validate that the response landed on an explicitly
  // allowed host, in case GitHub ever changes the redirect chain.
  if (c.allowRedirect && c.allowedFinalHosts && c.allowedFinalHosts.length > 0) {
    const finalHost = new URL(resp.url).hostname
    if (!c.allowedFinalHosts.includes(finalHost)) {
      throw new Error(`Refused: redirect ended on disallowed host (${finalHost})`)
    }
  }
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
  return { text: new TextDecoder('utf-8').decode(buf), finalUrl: resp.url }
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
    const candidate = candidates[i]!
    try {
      const { text, finalUrl } = await fetchMarkdown(candidate)
      // Source is { kind: 'url', url } — informational only. saveFile
      // treats this as no-save-back (falls through to Save-As), and
      // the title strip exposes it as a hover tooltip via
      // getCurrentSourceUrl(). For gists, finalUrl is the resolved
      // revision URL after the /raw redirect (more useful than the
      // original /raw endpoint). The display name comes from the URL
      // path so the title strip shows something useful even before
      // hover.
      setDocState(text, filenameFromUrl(finalUrl), { kind: 'url', url: finalUrl })
      harness.replaceDoc(text)
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

  const HINT_EMPTY = 'Paste a GitHub URL — file, repo, or tree path'
  const HINT_INVALID = 'Not recognised — paste a github.com or raw.githubusercontent.com URL'

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

  const onKeydown = (e: KeyboardEvent): void => {
    if (!isOpen) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
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
  //   - the Clipboard API isn't available (older browsers)
  //   - the user / browser denies read permission
  //   - the clipboard text isn't a normalisable GitHub URL — we don't
  //     want to paste arbitrary clipboard contents into the input,
  //     since the user might have something private on their clipboard
  //     and would have to manually clear it.
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
