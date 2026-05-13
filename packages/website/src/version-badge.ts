// Faint bottom-right version badge. Always visible, low-emphasis —
// signals early-product status without competing with the content.
// Rendered in both web and Tauri shells; auto-hides in fullscreen
// alongside other chrome.
//
// Click opens a small "About" popover with the alpha note + a link
// to the issue tracker. The popover is the canonical place to learn
// what alpha means for this app — the corner badge is just the
// affordance.

import { APP_NAME, APP_VERSION, BUILD_SHA, BUILT_AT, IS_ALPHA } from './version'

const ISSUES_URL = 'https://github.com/isherlock/nicermd/issues'
const COMMIT_BASE_URL = 'https://github.com/isherlock/nicermd/commit/'

// Format a build's ISO timestamp into a compact human form for the
// popover meta line. Returns empty for empty input (dev / no build
// timestamp), so the meta line silently degrades.
function formatBuiltAt(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

let popoverOpen = false

export function setupVersionBadge(root: HTMLElement): void {
  const badge = document.createElement('button')
  badge.type = 'button'
  badge.className = 'version-badge'
  // In alpha the status word is the at-a-glance signal — the full
  // version (v0.1 alpha) lives in the popover alongside build SHA
  // and timestamp so the corner stays uncluttered. Non-alpha builds
  // fall back to the full APP_VERSION on the rare chance the badge
  // sticks around past GA.
  badge.textContent = IS_ALPHA ? 'alpha' : APP_VERSION
  badge.setAttribute('aria-label', `${APP_VERSION} — about this release`)
  badge.addEventListener('click', () => openPopover())
  root.appendChild(badge)
}

function openPopover(): void {
  if (popoverOpen) return
  popoverOpen = true

  const backdrop = document.createElement('div')
  backdrop.className = 'alpha-popover__backdrop'

  const panel = document.createElement('div')
  panel.className = 'alpha-popover__panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-label', `About ${APP_NAME}`)

  // Brand mark above the title — the popover is the canonical 'about
  // this app' surface, so the logo lands here without competing with
  // reading content. Decorative; aria-hidden because the title text
  // immediately follows.
  const logo = document.createElement('img')
  logo.className = 'alpha-popover__logo'
  logo.src = '/favicon-256.png'
  logo.alt = ''
  logo.setAttribute('aria-hidden', 'true')
  panel.appendChild(logo)

  const title = document.createElement('div')
  title.className = 'alpha-popover__title'
  title.textContent = IS_ALPHA ? `${APP_NAME} is in alpha` : APP_NAME
  panel.appendChild(title)

  const body = document.createElement('div')
  body.className = 'alpha-popover__body'
  body.textContent = IS_ALPHA
    ? "Early release — expect rough edges. Your data stays on your device; there's no server."
    : `Version ${APP_VERSION}.`
  panel.appendChild(body)

  if (IS_ALPHA) {
    const link = document.createElement('a')
    link.className = 'alpha-popover__link'
    link.href = ISSUES_URL
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = 'Report a bug on GitHub'
    panel.appendChild(link)
  }

  // Version + build line — small, muted, last item before the close
  // button. The corner badge drops the version number to just 'alpha'
  // for cleanliness, so the full APP_VERSION lives here for anyone
  // who wants the precise number. SHA links to the GitHub commit.
  const meta = document.createElement('div')
  meta.className = 'alpha-popover__meta'
  meta.append(APP_VERSION)
  if (BUILD_SHA && BUILD_SHA !== 'dev') {
    const sha = document.createElement('a')
    sha.href = `${COMMIT_BASE_URL}${BUILD_SHA}`
    sha.target = '_blank'
    sha.rel = 'noopener noreferrer'
    sha.textContent = BUILD_SHA
    meta.append(' · ', sha)
    const builtLabel = formatBuiltAt(BUILT_AT)
    if (builtLabel) meta.append(` · ${builtLabel}`)
  } else {
    meta.append(' · dev')
  }
  panel.appendChild(meta)

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'alpha-popover__btn'
  closeBtn.textContent = 'Close'
  panel.appendChild(closeBtn)

  backdrop.appendChild(panel)
  document.body.appendChild(backdrop)
  closeBtn.focus()

  const close = (): void => {
    if (!popoverOpen) return
    popoverOpen = false
    window.removeEventListener('keydown', onKeydown, true)
    backdrop.remove()
  }

  const onKeydown = (e: KeyboardEvent): void => {
    if (!popoverOpen) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }
  window.addEventListener('keydown', onKeydown, true)

  closeBtn.addEventListener('click', close)
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close()
  })
}
