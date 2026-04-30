// Faint bottom-right version badge. Always visible, low-emphasis —
// signals early-product status without competing with the content.
// Rendered in both web and Tauri shells; auto-hides in fullscreen
// alongside other chrome.
//
// Click opens a small "About" popover with the alpha note + a link
// to the issue tracker. The popover is the canonical place to learn
// what alpha means for this app — the corner badge is just the
// affordance.

import { APP_NAME, APP_VERSION, IS_ALPHA } from './version'

const ISSUES_URL = 'https://github.com/isherlock/nicermd/issues'

let popoverOpen = false

export function setupVersionBadge(root: HTMLElement): void {
  const badge = document.createElement('button')
  badge.type = 'button'
  badge.className = 'version-badge'
  badge.textContent = APP_VERSION
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
