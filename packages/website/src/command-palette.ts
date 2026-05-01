// Command palette — fuzzy-search every action. Opens on Cmd+K or
// Cmd+/, both bound here. Centred modal with an auto-focused input
// and a single flat result list. Up/Down navigate, Enter executes,
// Esc closes; clicking a row executes; clicking the backdrop closes.
//
// Each command can be filtered out via an optional `available()`
// predicate — used to scope format actions to mode 2 and zoom /
// reload to Tauri.
//
// Commands display their keyboard shortcut in muted text on the right
// — teaches the shortcut as a side effect of using the palette.

import type { Harness } from './main'
import { toggleFullscreen } from './main'
import { openFile, saveFile, newFile, getCurrentSourceUrl } from './doc-source'
import { openUrlPrompt } from './url-open'
import { openThemePicker } from './theme-picker'
import { toggleRecentTheme, showThemeToast, showToast } from './themes'
import { openFontPicker } from './font-picker'
import { isTauri as isZoomTauri, zoomIn, zoomOut, zoomReset } from './zoom'
import { IS_MAC } from './platform'

interface Command {
  id: string
  label: string
  hint?: string
  shortcut?: string
  action: () => void | Promise<void>
  available?: () => boolean
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function buildCommands(harness: Harness): Command[] {
  const inMode = (k: number) => () => harness.getCurrentMode().key === k
  const inWysiwyg = inMode(2)

  return [
    // Modes
    { id: 'mode.read', label: 'Switch to Read', shortcut: 'Cmd+1', action: () => harness.switchTo(1) },
    { id: 'mode.write', label: 'Switch to Write', shortcut: 'Cmd+2 / Cmd+Return', action: () => harness.switchTo(2) },
    { id: 'mode.split', label: 'Switch to Split', shortcut: 'Cmd+3', action: () => harness.switchTo(3) },
    { id: 'mode.code', label: 'Switch to Code', shortcut: 'Cmd+4', action: () => harness.switchTo(4) },
    { id: 'mode.cycle', label: 'Cycle modes', shortcut: 'Cmd+Shift+M', action: () => harness.cycle() },

    // File
    { id: 'file.new', label: 'New file', hint: 'Discards unsaved changes', shortcut: 'Cmd+N', action: () => void newFile(harness) },
    { id: 'file.open', label: 'Open file…', shortcut: 'Cmd+O', action: () => void openFile(harness) },
    { id: 'file.openUrl', label: 'Open URL…', hint: 'GitHub markdown files', shortcut: 'Cmd+Alt+O', action: () => openUrlPrompt(harness) },
    {
      id: 'file.shareLink',
      label: 'Copy share link',
      hint: 'Reopens this doc on this site',
      // Only available when the current doc was loaded from a URL —
      // there's nothing meaningful to share for files-on-disk or
      // untitled drafts. Predicate runs at palette open time, so the
      // command appears / disappears as the active doc changes.
      available: () => getCurrentSourceUrl() !== null,
      action: async () => {
        const sourceUrl = getCurrentSourceUrl()
        if (!sourceUrl) return
        // Use the current origin so dev-server users get a localhost
        // link they can actually visit; in production this becomes
        // nicer.md/?url=… (the recipient still sees the phishing
        // gate before any fetch happens — share links are not auto-
        // -trust, they just bootstrap the prompt).
        const shareUrl = `${window.location.origin}/?url=${encodeURIComponent(sourceUrl)}`
        try {
          await navigator.clipboard.writeText(shareUrl)
          showToast('Share link copied')
        } catch {
          showToast('Couldn’t copy link')
        }
      },
    },
    { id: 'file.save', label: 'Save', shortcut: 'Cmd+S', action: () => void saveFile(harness) },
    { id: 'file.saveAs', label: 'Save As…', shortcut: 'Cmd+Shift+S', action: () => void saveFile(harness, { saveAs: true }) },

    // View / window
    { id: 'view.fullscreen', label: 'Toggle fullscreen', shortcut: 'Cmd+Shift+F', action: () => void toggleFullscreen() },
    { id: 'view.reload', label: 'Reload', shortcut: 'Cmd+R', action: () => window.location.reload(), available: isTauri },
    { id: 'view.zoomIn', label: 'Zoom in', shortcut: 'Cmd+=', action: () => void zoomIn(), available: isZoomTauri },
    { id: 'view.zoomOut', label: 'Zoom out', shortcut: 'Cmd+-', action: () => void zoomOut(), available: isZoomTauri },
    { id: 'view.zoomReset', label: 'Reset zoom', shortcut: 'Cmd+0', action: () => void zoomReset(), available: isZoomTauri },

    // Theme
    { id: 'theme.picker', label: 'Theme…', shortcut: 'Cmd+Alt+T', action: () => openThemePicker() },
    {
      id: 'theme.toggleRecent',
      label: 'Switch to previous theme',
      hint: 'Cycles between the two most recent',
      shortcut: 'Cmd+\\',
      action: () => {
        const swapped = toggleRecentTheme()
        if (swapped) showThemeToast(swapped)
      },
    },

    // Fonts
    { id: 'font.picker', label: 'Fonts…', shortcut: 'Cmd+Alt+F', action: () => openFontPicker() },

    // Format — mode 2 only
    { id: 'format.bold', label: 'Bold', shortcut: 'Cmd+B', action: () => harness.toggleFormat('bold'), available: inWysiwyg },
    { id: 'format.italic', label: 'Italic', shortcut: 'Cmd+I', action: () => harness.toggleFormat('italic'), available: inWysiwyg },
    { id: 'format.strike', label: 'Strikethrough', action: () => harness.toggleFormat('strike'), available: inWysiwyg },
    { id: 'format.code', label: 'Inline code', shortcut: 'Cmd+E', action: () => harness.toggleFormat('code'), available: inWysiwyg },
    { id: 'format.h1', label: 'Heading 1', shortcut: 'Cmd+Alt+1', action: () => harness.toggleFormat('h1'), available: inWysiwyg },
    { id: 'format.h2', label: 'Heading 2', shortcut: 'Cmd+Alt+2', action: () => harness.toggleFormat('h2'), available: inWysiwyg },
    { id: 'format.bulletList', label: 'Bullet list', shortcut: 'Cmd+Shift+8', action: () => harness.toggleFormat('bulletList'), available: inWysiwyg },
    { id: 'format.orderedList', label: 'Numbered list', shortcut: 'Cmd+Shift+7', action: () => harness.toggleFormat('orderedList'), available: inWysiwyg },
    { id: 'format.blockquote', label: 'Blockquote', shortcut: 'Cmd+Shift+B', action: () => harness.toggleFormat('blockquote'), available: inWysiwyg },
    { id: 'format.link', label: 'Link…', action: () => harness.toggleFormat('link'), available: inWysiwyg },
  ]
}

// Tiny fuzzy scorer. Empty query → 1 (everything matches). Exact match
// > prefix > substring > char-skip-with-consecutive-bonus. Returns 0
// when not all query chars appear in target order.
function fuzzyScore(query: string, target: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (t === q) return 10000
  if (t.startsWith(q)) return 5000 - (t.length - q.length)
  if (t.includes(q)) return 2000 - t.indexOf(q)
  let qi = 0
  let lastMatch = -2
  let score = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t.charCodeAt(ti) === q.charCodeAt(qi)) {
      score += lastMatch === ti - 1 ? 6 : 2
      lastMatch = ti
      qi++
    }
  }
  return qi === q.length ? score : 0
}

let isOpen = false
let registeredHarness: Harness | null = null

// Programmatic open — used by mouse-affordance experiments (e.g. the
// option-B format-bar trailing button) to open the palette without
// having to dispatch a synthetic Cmd+K. Returns false silently if the
// palette has not been wired yet (setupCommandPalette not called) or
// is already open.
export function openPalette(): boolean {
  if (isOpen || !registeredHarness) return false
  openPaletteImpl(registeredHarness)
  return true
}

export function setupCommandPalette(harness: Harness): void {
  registeredHarness = harness
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return
    if (e.shiftKey || e.altKey) return
    // Cmd+K and Cmd+/ both open the palette. Cmd+/ would otherwise be
    // a no-op in the browser; Cmd+K is the de-facto standard across
    // modern apps (Linear, Notion, GitHub, Vercel).
    if (e.code !== 'KeyK' && e.code !== 'Slash') return
    e.preventDefault()
    if (!isOpen) openPaletteImpl(harness)
  })
}

function openPaletteImpl(harness: Harness): void {
  if (isOpen) return
  isOpen = true

  const all = buildCommands(harness).filter((cmd) => !cmd.available || cmd.available())

  const backdrop = document.createElement('div')
  backdrop.className = 'cmdp__backdrop'

  const panel = document.createElement('div')
  panel.className = 'cmdp__panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Command palette')

  const input = document.createElement('input')
  input.className = 'cmdp__input'
  input.type = 'text'
  input.name = 'cmdp-search'
  input.placeholder = 'Search commands…'
  input.setAttribute('aria-label', 'Command search')
  input.autocomplete = 'off'
  input.spellcheck = false
  // Stop Chrome / 1Password / LastPass from attaching autofill UI that
  // silently swallows the first Escape press. `autocomplete="off"`
  // alone isn't enough — Chrome ignores it on plain text inputs.
  input.setAttribute('data-form-type', 'other')
  input.setAttribute('data-1p-ignore', 'true')
  input.setAttribute('data-lpignore', 'true')
  panel.appendChild(input)

  const list = document.createElement('ul')
  list.className = 'cmdp__list'
  list.setAttribute('role', 'listbox')
  panel.appendChild(list)

  backdrop.appendChild(panel)
  document.body.appendChild(backdrop)

  let filtered: Command[] = all
  let selectedIdx = 0

  const close = (): void => {
    if (!isOpen) return
    isOpen = false
    window.removeEventListener('keydown', onKeydown, true)
    backdrop.remove()
  }

  const execute = (cmd: Command): void => {
    close()
    // Run after the modal is gone so commands like "Open file…" that
    // hand off to a system dialog don't fight the closing backdrop.
    queueMicrotask(() => void cmd.action())
  }

  const render = (): void => {
    list.textContent = ''
    if (filtered.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'cmdp__empty'
      empty.textContent = 'No matching commands'
      list.appendChild(empty)
      return
    }
    filtered.forEach((cmd, idx) => {
      const row = document.createElement('li')
      row.className = 'cmdp__row'
      if (idx === selectedIdx) {
        row.classList.add('cmdp__row--selected')
      }
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', idx === selectedIdx ? 'true' : 'false')

      const label = document.createElement('span')
      label.className = 'cmdp__label'
      label.textContent = cmd.label
      row.appendChild(label)

      if (cmd.hint) {
        const hint = document.createElement('span')
        hint.className = 'cmdp__hint'
        hint.textContent = cmd.hint
        row.appendChild(hint)
      }

      if (cmd.shortcut) {
        const sc = document.createElement('span')
        sc.className = 'cmdp__shortcut'
        // Shortcuts are authored Mac-side ('Cmd+K'); rewrite at render
        // time for non-Mac so Windows / Linux readers don't see a key
        // that doesn't exist on their keyboard.
        sc.textContent = IS_MAC ? cmd.shortcut : cmd.shortcut.replace(/\bCmd\b/g, 'Ctrl')
        row.appendChild(sc)
      }

      row.addEventListener('mousemove', () => {
        if (selectedIdx === idx) return
        selectedIdx = idx
        render()
      })
      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        execute(cmd)
      })

      list.appendChild(row)
    })
    // Keep the selected row visible during arrow-key nav. `nearest` is
    // a no-op when the row is already on-screen (so mouse hover doesn't
    // cause spurious scrolling) and only scrolls the minimum needed
    // when the selection moves out of the viewport.
    list
      .querySelector<HTMLLIElement>('.cmdp__row--selected')
      ?.scrollIntoView({ block: 'nearest' })
  }

  const filter = (): void => {
    const q = input.value.trim()
    const scored = all
      .map((cmd) => ({ cmd, score: fuzzyScore(q, cmd.label) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
    filtered = scored.map((entry) => entry.cmd)
    selectedIdx = 0
    render()
  }

  input.addEventListener('input', filter)

  // Modal hotkeys at the window level — Chrome intercepts Escape on
  // focused inputs in some configurations before it bubbles to a
  // panel-level listener, so binding here is more robust. Capture
  // phase so we win over any deeper handler (e.g. Tiptap's editor
  // shortcuts, which would otherwise eat Cmd+B inside the palette).
  const onKeydown = (e: KeyboardEvent): void => {
    if (!isOpen) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (filtered.length === 0) return
      selectedIdx = (selectedIdx + 1) % filtered.length
      render()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (filtered.length === 0) return
      selectedIdx = (selectedIdx - 1 + filtered.length) % filtered.length
      render()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = filtered[selectedIdx]
      if (cmd) execute(cmd)
      return
    }
  }
  window.addEventListener('keydown', onKeydown, true)
  // Also bind directly on the input as a safety net — if Chrome's
  // autofill machinery intercepts the first Escape before the window
  // listener sees it, this one runs in the input's own capture phase
  // and is guaranteed to fire before any browser-level handling.
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

  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close()
  })

  render()
  // Defer focus to the next tick so the keydown that opened the
  // palette finishes processing first — otherwise some browsers fire
  // the same keystroke at the input and prefill it.
  setTimeout(() => input.focus(), 0)
}
