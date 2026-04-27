// Hybrid-engine spike — five-mode harness with hot-swapped editors.
//
// Mode order (nicest → least nice):
//   1 Read              nicermd-core HTML, no editor
//   2 WYSIWYG           Tiptap (lazy-loaded on first enter)
//   3 Code + preview    CM source + nicermd-core preview, live-updating
//   4 Raw code          CM, syntax highlighting only
//
// Each mode is a function (parent, markdown) → ModeHandle. Switching:
// capture text via getMarkdown(), destroy(), mount the next mode with the
// captured text. Cmd/Ctrl + 1..4 jumps directly; Cmd/Ctrl+Shift+M cycles.
//
// Dev-only aids (cross-tab broadcast sync, mode label pill, ?freeze=1,
// stress.md as boot doc) live in ./dev-features. They're loaded lazily
// and only when `import.meta.env.DEV && ?dev=1` — production builds
// tree-shake the entire dev module out.

import { EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { render as renderMarkdown } from 'nicermd-core'

import showcase from './samples/showcase.md?raw'
import { setupTauriBridge } from './tauri-bridge'
import { setupFileDrop } from './file-drop'
import { openFile, saveFile, newFile, setDocState, isDirty, markDirty } from './doc-source'
import { setupAutosave, checkRecovery } from './autosave'
import { setupModeIcons } from './mode-icons'
import { setupTitle } from './title'
import { setupZoom, zoomIn, zoomOut, zoomReset, isTauri as isZoomTauri } from './zoom'
import { initTheme } from './themes'
import { openThemePicker } from './theme-picker'
import { setupScrollStrip } from './scroll-strip'
import './main.css'

const THEME_STORAGE_KEY = 'nicermd:theme'

interface ModeHandle {
  destroy(): void
  getMarkdown(): string
  // Optional — only modes that can re-render without disturbing user
  // editing state implement this. Used by dev-features for cross-tab
  // updates; production code paths don't currently call it.
  setMarkdown?: (markdown: string) => void
}

type OnChange = (markdown: string) => void

interface ModeDef {
  key: number
  label: string
  mount: (parent: HTMLElement, markdown: string, onChange?: OnChange) => ModeHandle
}

// Markdown source highlight palette — colours come from CSS variables so
// the active theme drives them. Tokens: markers (#, **, *, _, `, ~~, list
// bullets, --- rules) → --cm-marker. Heading text, inline code, link text,
// URLs, quotes each get their own var. The theme system flips the data-
// attribute on <html>; CM picks up the change via the cascading vars.
const mdHighlight = HighlightStyle.define([
  { tag: t.processingInstruction, color: 'var(--cm-marker)' },
  { tag: t.contentSeparator, color: 'var(--cm-marker)' },
  { tag: t.heading1, fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.heading2, fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.heading3, fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.heading4, fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.heading5, fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.heading6, fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--cm-link)' },
  { tag: t.url, color: 'var(--cm-url)' },
  { tag: t.monospace, color: 'var(--cm-monospace)' },
  { tag: t.quote, color: 'var(--cm-quote)' },
  { tag: t.meta, color: 'var(--cm-marker)' },
])

const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--cm-bg)',
    color: 'var(--cm-fg)',
    fontFamily: 'var(--font-code)',
    fontSize: '13px',
    lineHeight: '1.55',
  },
  '.cm-content': {
    caretColor: 'var(--cm-caret)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--cm-caret)',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--cm-selection)',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--cm-gutter-bg)',
    border: 'none',
    color: 'var(--cm-gutter-fg)',
    fontFamily: 'inherit',
    fontSize: '12px',
    paddingRight: '12px',
  },
  '.cm-gutterElement': {
    padding: '0 4px 0 8px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--cm-fg)',
  },
})

const codeMirrorBase = [
  history(),
  drawSelection(),
  lineNumbers(),
  EditorView.lineWrapping,
  markdown({ extensions: [GFM] }),
  syntaxHighlighting(mdHighlight),
  editorTheme,
  keymap.of([...defaultKeymap, ...historyKeymap]),
]

function mountRead(parent: HTMLElement, markdown: string): ModeHandle {
  const div = document.createElement('div')
  div.className = 'mode-read'
  let current = markdown
  div.innerHTML = renderMarkdown(current)
  parent.appendChild(div)
  return {
    destroy: () => div.remove(),
    getMarkdown: () => current,
    setMarkdown: (md) => {
      current = md
      div.innerHTML = renderMarkdown(md)
    },
  }
}

// Cached after the first import so re-entering mode 2 is instant.
let wysiwygModule: Promise<typeof import('./wysiwyg-engine')> | null = null

function mountWysiwyg(
  parent: HTMLElement,
  initialMarkdown: string,
  onChange?: OnChange,
): ModeHandle {
  const wrap = document.createElement('div')
  wrap.className = 'mode-wysiwyg'
  parent.appendChild(wrap)

  const surface = document.createElement('div')
  surface.className = 'mode-wysiwyg__surface'
  wrap.appendChild(surface)

  const status = document.createElement('div')
  status.className = 'mode-wysiwyg__status'
  status.textContent = 'Loading WYSIWYG engine…'
  wrap.appendChild(status)

  // Mutable state so destroy() can short-circuit a still-loading mount, and
  // getMarkdown() can fall back to the original text before the engine is up.
  let destroyed = false
  let handle: import('./wysiwyg-engine').WysiwygHandle | null = null
  let latestMarkdown = initialMarkdown

  if (!wysiwygModule) wysiwygModule = import('./wysiwyg-engine')

  void wysiwygModule
    .then((mod) => {
      if (destroyed) return
      status.remove()
      handle = mod.createWysiwyg(surface, latestMarkdown, onChange)
    })
    .catch((err: unknown) => {
      if (destroyed) return
      status.textContent = `WYSIWYG failed to load: ${String(err)}`
    })

  return {
    destroy: () => {
      destroyed = true
      if (handle) handle.destroy()
      wrap.remove()
    },
    getMarkdown: () => (handle ? handle.getMarkdown() : latestMarkdown),
  }
}

function mountCodePlusPreview(
  parent: HTMLElement,
  markdown: string,
  onChange?: OnChange,
): ModeHandle {
  const wrap = document.createElement('div')
  wrap.className = 'mode-split'
  const editorPane = document.createElement('div')
  editorPane.className = 'mode-split__editor'
  const previewPane = document.createElement('div')
  previewPane.className = 'mode-split__preview'
  wrap.append(editorPane, previewPane)
  parent.appendChild(wrap)

  const renderTo = (text: string): void => {
    previewPane.innerHTML = renderMarkdown(text)
  }
  renderTo(markdown)

  const view = new EditorView({
    state: EditorState.create({
      doc: markdown,
      extensions: [
        ...codeMirrorBase,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const md = update.state.doc.toString()
          renderTo(md)
          onChange?.(md)
        }),
      ],
    }),
    parent: editorPane,
  })

  return {
    destroy: () => {
      view.destroy()
      wrap.remove()
    },
    getMarkdown: () => view.state.doc.toString(),
  }
}

function mountRawCode(
  parent: HTMLElement,
  markdown: string,
  onChange?: OnChange,
): ModeHandle {
  const wrap = document.createElement('div')
  wrap.className = 'mode-raw'
  parent.appendChild(wrap)
  const view = new EditorView({
    state: EditorState.create({
      doc: markdown,
      extensions: [
        ...codeMirrorBase,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange?.(update.state.doc.toString())
        }),
      ],
    }),
    parent: wrap,
  })
  return {
    destroy: () => {
      view.destroy()
      wrap.remove()
    },
    getMarkdown: () => view.state.doc.toString(),
  }
}

const MODES: ModeDef[] = [
  { key: 1, label: 'Read', mount: mountRead },
  { key: 2, label: 'WYSIWYG', mount: mountWysiwyg },
  { key: 3, label: 'Code + preview', mount: mountCodePlusPreview },
  { key: 4, label: 'Raw code', mount: mountRawCode },
]

// Mode-switching engine. Owns no UI chrome and no cross-tab sync — those
// are layered in via callbacks (onLocalChange, onModeChange) and the
// public setMarkdown hook so dev-features.ts (or future product chrome)
// can subscribe without the harness knowing they exist.
export class Harness {
  private currentMode = 1
  private currentHandle: ModeHandle | null = null
  private currentMarkdown: string
  private localChangeListeners = new Set<OnChange>()
  private modeChangeListeners = new Set<(key: number, label: string) => void>()

  constructor(
    private readonly host: HTMLElement,
    initialMarkdown: string,
  ) {
    this.currentMarkdown = initialMarkdown
  }

  onLocalChange(cb: OnChange): void {
    this.localChangeListeners.add(cb)
  }

  offLocalChange(cb: OnChange): void {
    this.localChangeListeners.delete(cb)
  }

  onModeChange(cb: (key: number, label: string) => void): void {
    this.modeChangeListeners.add(cb)
  }

  // External markdown injection — for dev-features cross-tab sync, and
  // any future feature that needs to push text into the current mode.
  // Only modes that expose setMarkdown actually update; editing modes
  // ignore the call to preserve cursor/selection state.
  setMarkdown(md: string): void {
    this.currentMarkdown = md
    this.currentHandle?.setMarkdown?.(md)
  }

  // Hard replace the document — destroys the active mode and remounts it
  // with the new markdown. Used by drag-drop and (future) Open File so
  // editing modes (which don't implement setMarkdown) can swap content.
  replaceDoc(md: string): void {
    this.currentMarkdown = md
    if (!this.currentHandle) return
    const key = this.currentMode
    this.currentHandle.destroy()
    this.currentHandle = null
    const next = MODES.find((m) => m.key === key)
    if (!next) return
    this.currentHandle = next.mount(this.host, this.currentMarkdown, this.handleLocalChange)
  }

  getCurrentMode(): { key: number; label: string } {
    const def = MODES.find((m) => m.key === this.currentMode)
    return { key: this.currentMode, label: def?.label ?? '' }
  }

  // Live current text — pulls from the active mode if mounted (so cursor
  // edits are included), otherwise falls back to the cached value.
  getMarkdown(): string {
    return this.currentHandle?.getMarkdown() ?? this.currentMarkdown
  }

  private readonly handleLocalChange = (md: string): void => {
    this.currentMarkdown = md
    this.localChangeListeners.forEach((cb) => cb(md))
  }

  switchTo(key: number): void {
    if (key === this.currentMode && this.currentHandle) return
    if (this.currentHandle) {
      this.currentMarkdown = this.currentHandle.getMarkdown()
      this.currentHandle.destroy()
      this.currentHandle = null
    }
    const next = MODES.find((m) => m.key === key)
    if (!next) return
    this.currentMode = key
    this.currentHandle = next.mount(this.host, this.currentMarkdown, this.handleLocalChange)
    this.modeChangeListeners.forEach((cb) => cb(key, next.label))
  }

  cycle(): void {
    const next = (this.currentMode % MODES.length) + 1
    this.switchTo(next)
  }
}

async function boot(): Promise<void> {
  initTheme()

  // Auto-open the theme picker on first-ever visit so users see the
  // catalog up front. Detected by absence of the localStorage key.
  let openPickerOnFirstLoad = false
  try {
    openPickerOnFirstLoad = localStorage.getItem(THEME_STORAGE_KEY) === null
  } catch {
    // localStorage may be unavailable; skip the auto-open.
  }

  const root = document.querySelector<HTMLElement>('#app')
  if (!root) throw new Error('#app root missing')
  root.innerHTML = ''

  // Title strip + mode icons are baseline UI in both shells; pinned to
  // the top, icons top-right. CSS gates display on `data-tauri="1"`,
  // so set it unconditionally. `data-shell` distinguishes the real
  // Tauri runtime from the web shell — used by future shell-specific
  // CSS (e.g. extra reserve for macOS traffic lights).
  document.documentElement.dataset.tauri = '1'
  document.documentElement.dataset.shell =
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
      ? 'tauri'
      : 'web'

  // Hide title strip + mode icons on scroll-down, restore on scroll-up.
  // Inert in mode 3 (split scrolls inside panes, not the document).
  setupScrollStrip()

  const host = document.createElement('div')
  host.className = 'mode-host'
  root.appendChild(host)

  let bootMarkdown: string = showcase
  let harness: Harness
  // Tree-shake gate: import.meta.env.DEV is a compile-time `false` in
  // `pnpm build`, so the entire branch (and ./dev-features) is dead-code-
  // eliminated from production bundles.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('dev')) {
    try {
      const dev = await import('./dev-features')
      bootMarkdown = dev.bootDoc
      harness = new Harness(host, bootMarkdown)
      dev.setupDev(harness, root)
    } catch (err) {
      console.error('Dev features failed to load:', err)
      harness = new Harness(host, bootMarkdown)
    }
  } else {
    harness = new Harness(host, bootMarkdown)
  }

  // Establish the dirty baseline. Boot doc has no name — shown as
  // "Untitled" in the title; not dirty until user edits.
  setDocState(bootMarkdown, null, null)
  // markDirty must be the first onLocalChange listener so the title
  // refresh listener (added by setupTitle) reads dirty=true on user
  // edits. Set iteration follows insertion order.
  harness.onLocalChange(() => markDirty())
  setupTitle(harness, root)
  setupModeIcons(harness, root)
  setupAutosave(harness)
  checkRecovery(harness, bootMarkdown)
  setupCloseGuard(harness)

  finish(harness)

  if (openPickerOnFirstLoad) {
    // Defer one tick so the harness paints first; otherwise the picker
    // overlay can sit on top of an empty document for a frame.
    setTimeout(() => openThemePicker(), 0)
  }
}

function finish(harness: Harness): void {
  harness.switchTo(1)

  // No-op outside Tauri. Inside Tauri, wires native menu events to the
  // harness so File / View / Cycle menu items dispatch the right action.
  void setupTauriBridge(harness)

  setupFileDrop(harness)
  void setupZoom()

  window.addEventListener('keydown', (event) => {
    const meta = event.metaKey || event.ctrlKey
    if (!meta) return

    // Cmd/Ctrl + Alt/Option + T — open the theme picker. Uses event.code
    // because macOS Alt produces special characters (e.g. "†"), but the
    // physical key code is stable. Alt over Shift because Chrome reserves
    // Cmd+Shift+T for "reopen closed tab" and preventDefault can't override.
    if (event.altKey && event.code === 'KeyT') {
      event.preventDefault()
      openThemePicker()
      return
    }
    if (event.altKey) return

    if (event.shiftKey) {
      if (event.code === 'KeyM') {
        event.preventDefault()
        harness.cycle()
        return
      }
      if (event.code === 'KeyF') {
        event.preventDefault()
        void toggleFullscreen()
        return
      }
      if (event.code === 'KeyS') {
        event.preventDefault()
        void saveFile(harness, { saveAs: true })
        return
      }
      return
    }
    if (event.code === 'KeyS') {
      event.preventDefault()
      void saveFile(harness)
      return
    }
    if (event.code === 'KeyO') {
      event.preventDefault()
      void openFile(harness)
      return
    }
    // Cmd+N is browser-reserved (new window) and preventDefault can't
    // override; in Tauri the File menu's accelerator handles it at OS
    // level. So we don't bind it here. Browser users get File→New via
    // future button / palette.
    // Tauri-only browser-style zoom. In plain browsers Cmd+= / Cmd+- /
    // Cmd+0 are handled natively, so we only intercept in Tauri.
    if (isZoomTauri()) {
      if (event.code === 'Equal') {
        event.preventDefault()
        void zoomIn()
        return
      }
      if (event.code === 'Minus') {
        event.preventDefault()
        void zoomOut()
        return
      }
      if (event.code === 'Digit0') {
        event.preventDefault()
        void zoomReset()
        return
      }
    }
    const n = Number(event.key)
    if (Number.isInteger(n) && n >= 1 && n <= 4) {
      event.preventDefault()
      harness.switchTo(n)
    }
  })
}

// Cmd/Ctrl + Shift + F — toggle fullscreen. Inside Tauri the native window
// API gives macOS-native fullscreen (menu bar hidden, dock hidden); in plain
// browser contexts the HTML5 Fullscreen API does the equivalent on the page.
// Also flips data-fullscreen on <html> so CSS can hide the title strip.
async function toggleFullscreen(): Promise<void> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    const fs = await win.isFullscreen()
    await win.setFullscreen(!fs)
    document.documentElement.dataset.fullscreen = !fs ? '1' : '0'
    return
  }
  if (document.fullscreenElement) {
    void document.exitFullscreen()
  } else {
    void document.documentElement.requestFullscreen()
  }
}

// Browser: beforeunload guard prompts before navigating away with unsaved
// edits. Tauri close-requested guard does the equivalent for the desktop
// window via plugin-dialog.
function setupCloseGuard(harness: Harness): void {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    setupTauriCloseGuard(harness)
    return
  }
  window.addEventListener('beforeunload', (event) => {
    if (isDirty()) {
      event.preventDefault()
      // Legacy support — modern browsers ignore this string but require
      // the assignment for the prompt to fire.
      event.returnValue = ''
    }
  })
}

async function setupTauriCloseGuard(harness: Harness): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  await win.onCloseRequested(async (event) => {
    if (!isDirty()) return
    const { ask } = await import('@tauri-apps/plugin-dialog')
    const ok = await ask('Discard unsaved changes and quit?', {
      title: 'Nicer.md',
      kind: 'warning',
    })
    if (!ok) event.preventDefault()
  })
}

void boot()
