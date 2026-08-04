// Right-click menu — the whole page as the target, zero visible
// chrome (2026-08-01 minimal-affordance round; the Typora pattern).
// Read mode only: in the edit modes the native context menu carries
// spellcheck and clipboard, which a custom menu can't replicate —
// revisit if dogfooding wants modes there too.
//
// Content mirrors the unified panel's priorities: modes first (with
// the current one marked), the daily commands, then the hand-off to
// everything ("All commands… ⌘K"). Rows and shortcuts render from
// the same EDIT_FLAVOURS data as the panel, so nothing forks.

import type { Harness } from './main'
import { EDIT_FLAVOURS, READ_ENTRY } from './edit-mode'
import { getContentKind, openFile } from './doc-source'
import { openPalette } from './command-palette'
import { openThemePicker } from './theme-picker'
import { IS_MAC } from './platform'

let menuEl: HTMLElement | null = null
let teardown: (() => void) | null = null

function closeMenu(): void {
  teardown?.()
  teardown = null
  menuEl?.remove()
  menuEl = null
}

function shortcutLabel(shortcut: string): string {
  return IS_MAC ? shortcut : shortcut.replace(/\bCmd\b/g, 'Ctrl')
}

interface CtxRow {
  label: string
  shortcut?: string
  current?: boolean
  action: () => void
}

function openMenu(harness: Harness, x: number, y: number): void {
  closeMenu()

  const isMarkdown = getContentKind().kind === 'markdown'
  const current = harness.getCurrentMode().key
  const modeRows: CtxRow[] = [READ_ENTRY, ...EDIT_FLAVOURS]
    .filter((f) => isMarkdown || !f.markdownOnly)
    .map((f) => ({
      label: f.name,
      shortcut: f.shortcut,
      current: f.key === current,
      action: () => harness.switchTo(f.key),
    }))

  const groups: CtxRow[][] = [
    modeRows,
    [
      { label: 'Open file…', shortcut: 'Cmd+O', action: () => void openFile(harness) },
      { label: 'Theme…', shortcut: 'Cmd+Alt+T', action: () => openThemePicker() },
    ],
    [{ label: 'All commands…', shortcut: 'Cmd+K', action: () => void openPalette() }],
  ]

  const el = document.createElement('div')
  el.className = 'ctxm'
  el.setAttribute('role', 'menu')

  groups.forEach((rows, gi) => {
    if (gi > 0) {
      const div = document.createElement('div')
      div.className = 'ctxm__divider'
      el.appendChild(div)
    }
    for (const row of rows) {
      const r = document.createElement('button')
      r.type = 'button'
      r.className = 'ctxm__row'
      if (row.current) r.classList.add('ctxm__row--current')
      r.setAttribute('role', 'menuitem')
      const label = document.createElement('span')
      label.className = 'ctxm__label'
      label.textContent = row.label
      r.appendChild(label)
      if (row.shortcut) {
        const k = document.createElement('span')
        k.className = 'ctxm__shortcut'
        k.textContent = shortcutLabel(row.shortcut)
        r.appendChild(k)
      }
      r.addEventListener('mousedown', (e) => e.preventDefault())
      r.addEventListener('click', () => {
        closeMenu()
        queueMicrotask(() => row.action())
      })
      el.appendChild(r)
    }
  })

  document.body.appendChild(el)
  menuEl = el

  // Clamp inside the viewport — open up/left of the cursor when the
  // natural position would spill off an edge.
  const rect = el.getBoundingClientRect()
  const left = Math.min(x, window.innerWidth - rect.width - 8)
  const top = Math.min(y, window.innerHeight - rect.height - 8)
  el.style.left = `${Math.max(8, left)}px`
  el.style.top = `${Math.max(8, top)}px`

  const onPointerDown = (e: PointerEvent): void => {
    if (e.target instanceof Element && e.target.closest('.ctxm')) return
    closeMenu()
  }
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    closeMenu()
  }
  const onDismiss = (): void => closeMenu()
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('scroll', onDismiss, { passive: true })
  window.addEventListener('blur', onDismiss)
  teardown = () => {
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('keydown', onKeydown, true)
    window.removeEventListener('scroll', onDismiss)
    window.removeEventListener('blur', onDismiss)
  }
}

export function setupContextMenu(harness: Harness): void {
  document.addEventListener('contextmenu', (e) => {
    // Desktop-only: on the web the browser's own context menu is the
    // valuable native affordance (copy, search, open-link) — reader
    // sites never hijack it. On desktop the bare webview menu is
    // near-empty, so the custom menu adds value instead of removing it.
    if (document.documentElement.dataset.shell !== 'tauri') return
    if (harness.getCurrentMode().key !== 1) return
    const t = e.target
    if (!(t instanceof Element) || !t.closest('.mode-host')) return
    // Target-sensitive pass-through: selections and links keep the
    // native WKWebView menu (Copy, Look Up, Translate, Copy Link…) —
    // those are text intents, not app intents. The app menu owns
    // plain-area right-clicks only, matching macOS menu conventions.
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    if (t.closest('a')) return
    e.preventDefault()
    openMenu(harness, e.clientX, e.clientY)
  })
}
