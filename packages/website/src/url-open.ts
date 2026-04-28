// Open a markdown file by URL. Spike scope: GitHub-hosted files only.
// Pasting a github.com/blob URL is rewritten to its raw.githubusercontent
// equivalent and fetched directly — anything outside the GitHub raw host
// is rejected up front, so the prod CSP `connect-src` allowlist stays
// narrow.
//
// Safety posture for the spike:
//
//   - Host allowlist (raw.githubusercontent.com only).
//   - 5 MiB ceiling on response bodies — markdown is small, anything
//     larger is almost certainly the wrong file.
//   - Core renderer runs markdown-it with html:false + DOMPurify
//     allowlist, so untrusted content can't smuggle <script>. The
//     allowlist still permits <a href> and <img src> — links go to
//     wherever the file points, and images load from the document's
//     img-src CSP (https:), not connect-src.
//   - Loaded URL is recorded as a null DocSource — Save falls through
//     to Save-As, since we can't write back to GitHub.
//
// Deliberately not in scope:
//
//   - Gists (different host + multi-file pages need their own UX).
//   - Private repos / auth tokens.
//   - URL share param on boot (`?url=…`) — would unlock sharing but
//     wants more thought on phishing risk first.

import type { Harness } from './main'
import { setDocState } from './doc-source'

const RAW_HOST = 'raw.githubusercontent.com'
const MAX_BYTES = 5 * 1024 * 1024 // 5 MiB; markdown is never this big.

// github.com/<user>/<repo>/blob/<branch>/<path…> → raw equivalent.
// Also accepts /raw/ in place of /blob/ (GitHub serves both routes;
// we rewrite to raw host directly so the response doesn't need a
// cross-host redirect that the CSP would block).
function normalizeGithubUrl(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null

  if (url.hostname === RAW_HOST) {
    return url.toString()
  }
  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
    // /<user>/<repo>/(blob|raw)/<branch>/<path>
    const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/)
    if (!m) return null
    const [, user, repo, rest] = m
    return `https://${RAW_HOST}/${user}/${repo}/${rest}`
  }
  return null
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

async function fetchMarkdown(rawUrl: string): Promise<string> {
  const resp = await fetch(rawUrl, { redirect: 'error' })
  if (!resp.ok) {
    throw new Error(`Fetch failed (${resp.status} ${resp.statusText})`)
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
  return new TextDecoder('utf-8').decode(buf)
}

export async function loadFromUrl(harness: Harness, input: string): Promise<void> {
  const rawUrl = normalizeGithubUrl(input)
  if (!rawUrl) {
    throw new Error('Only GitHub URLs are supported (e.g. github.com/user/repo/blob/main/README.md)')
  }
  const text = await fetchMarkdown(rawUrl)
  // Source is null — we can't write back to GitHub from the browser, so
  // a subsequent Cmd+S falls through to Save-As. The display name comes
  // from the URL path so the title strip shows something useful.
  setDocState(text, filenameFromUrl(rawUrl), null)
  harness.replaceDoc(text)
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

  const HINT_EMPTY = 'Paste a GitHub URL — github.com/user/repo/blob/branch/file.md'
  const HINT_INVALID = 'Not recognised — paste a github.com or raw.githubusercontent.com URL'

  const updateStatus = (): void => {
    const value = input.value.trim()
    if (!value) {
      status.textContent = HINT_EMPTY
      status.classList.remove('url-open__hint--preview')
      return
    }
    const raw = normalizeGithubUrl(value)
    if (raw) {
      // Arrow + monospace makes it read like "this is what we'll fetch"
      // rather than a free-form description; the --preview modifier
      // applies the code font + ellipsis clipping for long URLs.
      status.textContent = `→ ${raw}`
      status.classList.add('url-open__hint--preview')
    } else {
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
      if (!trimmed || !normalizeGithubUrl(trimmed)) return
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
