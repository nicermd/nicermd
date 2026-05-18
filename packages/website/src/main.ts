// Hybrid-engine harness with hot-swapped editors across four modes.
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
import { IS_MAC } from './platform'
import { setupTauriBridge } from './tauri-bridge'
import { setupFileDrop } from './file-drop'
import { openFile, saveFile, newFile, setDocState, isDirty, markDirty, getCurrentSourceUrl } from './doc-source'
import { setupAutosave, checkRecovery } from './autosave'
import { setupModeIcons } from './mode-icons'
import { setupTitle } from './title'
import { setupVersionBadge } from './version-badge'
import { setupZoom, zoomIn, zoomOut, zoomReset, isTauri as isZoomTauri } from './zoom'
import { initTheme, toggleRecentTheme, showThemeToast } from './themes'
import { initFonts } from './fonts'
import { openFontPicker } from './font-picker'
import { openUrlPrompt, processBootUrlParam } from './url-open'
import { setupLinkChaining } from './link-chain'
import { openThemePicker } from './theme-picker'
import { registerServiceWorker } from './sw-register'
import { setupScrollStrip, showStrip } from './scroll-strip'
import { setupFormatBar } from './format-bar'
import { setupCommandPalette } from './command-palette'
import { setupTouchSwipe } from './touch-swipe'
import { cycleOption } from './option-flag'
import type { FormatAction } from './wysiwyg-engine'
import './main.css'

const THEME_STORAGE_KEY = 'nicermd:theme'

interface ModeHandle {
  destroy(): void
  getMarkdown(): string
  // Optional — only modes that can re-render without disturbing user
  // editing state implement this. Used by dev-features for cross-tab
  // updates; production code paths don't currently call it.
  setMarkdown?: (markdown: string) => void
  // Optional — modes that support format commands (currently mode 2 /
  // WYSIWYG) implement these. The format bar is the only consumer.
  toggleFormat?: (action: FormatAction) => void
  isFormatActive?: (action: FormatAction) => boolean
  onFormatUpdate?: (cb: () => void) => () => void
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
  // baseUrl resolves relative href/src in URL-loaded docs (e.g. a README's
  // `images/logo.png`) against the source URL; null/undefined for local
  // and showcase docs leaves URLs untouched.
  const renderInto = (text: string): void => {
    div.innerHTML = renderMarkdown(text, { baseUrl: getCurrentSourceUrl() ?? undefined })
  }
  renderInto(current)
  parent.appendChild(div)
  return {
    destroy: () => div.remove(),
    getMarkdown: () => current,
    setMarkdown: (md) => {
      current = md
      renderInto(md)
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
  status.textContent = 'Loading Write mode…'
  wrap.appendChild(status)

  // Mutable state so destroy() can short-circuit a still-loading mount, and
  // getMarkdown() can fall back to the original text before the engine is up.
  let destroyed = false
  let handle: import('./wysiwyg-engine').WysiwygHandle | null = null
  let latestMarkdown = initialMarkdown
  // Format-bar subscribers attach before the engine is loaded — buffer
  // them here and re-attach once `handle` is set. Same for one-shot
  // notification so the bar can refresh active states immediately.
  const pendingUpdateCallbacks = new Set<() => void>()
  const pendingDetachers = new Set<() => void>()

  if (!wysiwygModule) wysiwygModule = import('./wysiwyg-engine')

  void wysiwygModule
    .then((mod) => {
      if (destroyed) return
      status.remove()
      handle = mod.createWysiwyg(surface, latestMarkdown, onChange, {
        baseUrl: getCurrentSourceUrl() ?? undefined,
      })
      for (const cb of pendingUpdateCallbacks) {
        const detach = handle.onFormatUpdate(cb)
        pendingDetachers.add(detach)
        cb()
      }
      pendingUpdateCallbacks.clear()
    })
    .catch((err: unknown) => {
      if (destroyed) return
      status.textContent = `Write mode failed to load: ${String(err)}`
    })

  return {
    destroy: () => {
      destroyed = true
      for (const detach of pendingDetachers) detach()
      pendingDetachers.clear()
      pendingUpdateCallbacks.clear()
      if (handle) handle.destroy()
      wrap.remove()
    },
    getMarkdown: () => (handle ? handle.getMarkdown() : latestMarkdown),
    toggleFormat: (action) => handle?.toggleFormat(action),
    isFormatActive: (action) => handle?.isFormatActive(action) ?? false,
    onFormatUpdate: (cb) => {
      if (handle) {
        const detach = handle.onFormatUpdate(cb)
        pendingDetachers.add(detach)
        return () => {
          detach()
          pendingDetachers.delete(detach)
        }
      }
      pendingUpdateCallbacks.add(cb)
      return () => {
        pendingUpdateCallbacks.delete(cb)
      }
    },
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
    previewPane.innerHTML = renderMarkdown(text, { baseUrl: getCurrentSourceUrl() ?? undefined })
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
  { key: 2, label: 'Write', mount: mountWysiwyg },
  { key: 3, label: 'Split', mount: mountCodePlusPreview },
  { key: 4, label: 'Code', mount: mountRawCode },
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

  // In-flight mode-switch animation timer. The transition splits into
  // a 150ms leave + 150ms enter; the timer fires at the midpoint to
  // swap content. If a second switch arrives during the first one's
  // leave phase, we cancel the pending swap and start fresh.
  private transitionTimer: number | null = null

  // Animate the .mode-host on every mode change so the swap reads as a
  // signal rather than an instant content jump (the Read↔Write pair
  // looks near-identical otherwise). Two styles:
  //
  //   - 'slide' (~300ms, directional) — only the touch-swipe handler
  //     triggers this. Matches the gesture: content slides 20px out in
  //     the direction your finger moved, then the new content slides
  //     in from the opposite side. Reads as causal because the user's
  //     own movement initiated it.
  //   - 'fade' (~120ms, default) — keyboard shortcuts, mode-icon
  //     clicks, and Cmd+Shift+M cycle. Discrete deliberate actions
  //     don't have a gesture direction to match, and a 300ms slide
  //     reads as delay rather than signal there. A quick opacity dip
  //     is short enough not to feel laggy but visible enough to
  //     confirm the swap, especially for Read↔Write.
  //
  // Direction (slide only) defaults to: target > current → 'forward'.
  // cycle / cyclePrevious override to handle the wrap edges.
  // prefers-reduced-motion users skip the animation entirely.
  switchTo(
    key: number,
    direction?: 'forward' | 'backward',
    style: 'fade' | 'slide' = 'fade',
  ): void {
    if (key === this.currentMode && this.currentHandle) return
    const dir = direction ?? (key > this.currentMode ? 'forward' : 'backward')
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    // First mount or reduced-motion: skip the animation entirely.
    if (!this.currentHandle || reducedMotion) {
      this.doSwitch(key)
      return
    }
    if (this.transitionTimer !== null) {
      window.clearTimeout(this.transitionTimer)
      this.transitionTimer = null
    }
    const allClasses = [
      'mode-host--leave-forward',
      'mode-host--leave-backward',
      'mode-host--enter-forward',
      'mode-host--enter-backward',
      'mode-host--fade-out',
      'mode-host--fade-in',
    ]
    this.host.classList.remove(...allClasses)
    const leaveClass =
      style === 'slide' ? `mode-host--leave-${dir}` : 'mode-host--fade-out'
    const enterClass =
      style === 'slide' ? `mode-host--enter-${dir}` : 'mode-host--fade-in'
    // Slide takes 150ms each half; fade is 60ms each half. Total visual
    // span is 300ms for slide, 120ms for fade.
    const halfDuration = style === 'slide' ? 150 : 60
    this.host.classList.add(leaveClass)
    this.transitionTimer = window.setTimeout(() => {
      this.transitionTimer = null
      this.doSwitch(key)
      this.host.classList.remove(leaveClass)
      this.host.classList.add(enterClass)
    }, halfDuration)
  }

  private doSwitch(key: number): void {
    if (this.currentHandle) {
      this.currentMarkdown = this.currentHandle.getMarkdown()
      this.currentHandle.destroy()
      this.currentHandle = null
    }
    const next = MODES.find((m) => m.key === key)
    if (!next) return
    this.currentMode = key
    this.currentHandle = next.mount(
      this.host,
      this.currentMarkdown,
      this.handleLocalChange,
    )
    this.modeChangeListeners.forEach((cb) => cb(key, next.label))
  }

  cycle(style: 'fade' | 'slide' = 'fade'): void {
    const next = (this.currentMode % MODES.length) + 1
    // Pass 'forward' explicitly so the 4 → 1 wrap reads as forward
    // (key comparison would infer 'backward' from target < current).
    this.switchTo(next, 'forward', style)
  }

  // Reverse cycle — touch swipe-right maps to this. Same wrap logic
  // as cycle() but stepping backward (1 → 4, 2 → 1, …). Passes
  // 'backward' to override the wrap-direction inference.
  cyclePrevious(style: 'fade' | 'slide' = 'fade'): void {
    const prev = ((this.currentMode - 2 + MODES.length) % MODES.length) + 1
    this.switchTo(prev, 'backward', style)
  }

  // Format command surface — delegates to the active mode handle if it
  // implements the optional methods (currently mode 2 / WYSIWYG).
  // Returns no-ops elsewhere so the format bar can call without
  // checking the active mode itself.
  toggleFormat(action: FormatAction): void {
    this.currentHandle?.toggleFormat?.(action)
  }
  isFormatActive(action: FormatAction): boolean {
    return this.currentHandle?.isFormatActive?.(action) ?? false
  }
  onFormatUpdate(cb: () => void): () => void {
    return this.currentHandle?.onFormatUpdate?.(cb) ?? (() => {})
  }
}

async function boot(): Promise<void> {
  initTheme()
  initFonts()
  registerServiceWorker()

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
  const inTauri =
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  document.documentElement.dataset.shell = inTauri ? 'tauri' : 'web'

  // Keep `data-fullscreen` in sync with Tauri's actual window state.
  // Without this it gets stuck if the user enters / exits fullscreen
  // via macOS native controls (green button, swipe up to Mission
  // Control) instead of our Cmd+Shift+F toggle, which only updates the
  // attribute when itself fires. A stuck `'1'` hides .window-title
  // forever via [data-shell="tauri"][data-fullscreen="1"]. The resize
  // event fires on fullscreen transitions in Tauri / WebKit.
  if (inTauri) {
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const sync = async (): Promise<void> => {
        const fs = await win.isFullscreen()
        document.documentElement.dataset.fullscreen = fs ? '1' : '0'
      }
      await sync()
      await win.onResized(() => void sync())
    })()
  }

  // PWA standalone-mode chrome detection. Chrome's PWA has a 'Hide
  // title bar' toggle that doesn't change display-mode but DOES
  // collapse the chrome strip — page viewport extends to the window
  // top and Chrome overlays its controls (traffic lights / menu) on
  // our content. We can't detect the toggle via CSS, but
  // outerHeight - innerHeight is roughly the chrome height (~32-44px
  // when shown, ~0 when hidden). main.css uses
  // [data-pwa-chrome-hidden="1"] to push the mode icons down past
  // the overlay row when chrome is hidden, and back to the
  // viewport-top when chrome is shown.
  if (!inTauri) {
    const isStandalonePwa = (): boolean =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches
    const syncPwaChrome = (): void => {
      if (!isStandalonePwa()) {
        document.documentElement.dataset.pwaChromeHidden = '0'
        return
      }
      const chromeHeight = window.outerHeight - window.innerHeight
      document.documentElement.dataset.pwaChromeHidden = chromeHeight < 8 ? '1' : '0'
    }
    window.addEventListener('resize', syncPwaChrome)
    syncPwaChrome()
  }

  // Hide title strip + mode icons on scroll-down, restore on scroll-up.
  // Inert in mode 3 (split scrolls inside panes, not the document).
  setupScrollStrip()

  const host = document.createElement('div')
  host.className = 'mode-host'
  root.appendChild(host)

  // Showcase is authored Mac-side ('Cmd+1', 'Cmd+S', etc.). On non-Mac
  // boots rewrite those tokens inside inline code spans only — prose
  // outside backticks (if any) stays untouched. Only applies to the
  // built-in landing doc; user-loaded markdown is rendered as-authored.
  let bootMarkdown: string = IS_MAC
    ? showcase
    : showcase.replace(/`([^`]*)`/g, (_m, inner: string) => `\`${inner.replace(/\bCmd\+/g, 'Ctrl+')}\``)
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
  setupFormatBar(harness, root)
  setupCommandPalette(harness)
  setupVersionBadge(root)
  // Touch swipe on the doc surface cycles modes. Scoped to .mode-host
  // (which `host` IS) so top chrome and bottom format bar keep their
  // own behaviour; filters in the gesture handler exclude editor
  // surfaces so text selection in Write / Code modes still works.
  setupTouchSwipe(harness, host)

  // Resurface the strip on mode change — user benefits from re-seeing
  // filename + active mode whenever the editing context shifts.
  harness.onModeChange(() => showStrip())
  setupAutosave(harness)
  // Link chaining: intercept clicks on markdown-targeting links in
  // rendered docs so they load inside the reader instead of navigating
  // to raw GitHub. Must run BEFORE processBootUrlParam so the chain-
  // state marker is on the initial history entry by the time the boot
  // handler reads it. See link-chain.ts.
  setupLinkChaining(harness, host)
  // Boot-time ?url=… handler. Sits between autosave wiring and recovery
  // banner so a link-driven open prompt sits on top of (and supersedes)
  // any recovery banner — if the user clicked a share link, that's
  // probably what they want to read, not their old draft. Cancelling
  // the gate falls through to the recovery banner naturally.
  processBootUrlParam(harness)
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
    // Cmd/Ctrl + Alt/Option + F — open the font picker. Same rationale
    // as the theme key: Alt-modified to dodge browser-claimed
    // Cmd+Shift / Cmd-only combos. Cmd+F is browser find-in-page.
    if (event.altKey && event.code === 'KeyF') {
      event.preventDefault()
      openFontPicker()
      return
    }
    // Cmd+Shift+Alt+O — cycle the iteration A/B flag. Tauri-friendly
    // counterpart to `?option=N` URLs: reloads into the next variant
    // (option-flag.ts persists the choice via localStorage). Must
    // precede the plain Cmd+Alt+O handler because that branch doesn't
    // check shift and would otherwise swallow the shifted combo.
    if (event.altKey && event.shiftKey && event.code === 'KeyO') {
      event.preventDefault()
      cycleOption()
      return
    }
    // Cmd/Ctrl + Alt/Option + O — open URL prompt. Slots into the
    // Cmd+Alt+letter picker family. Cmd+Shift+O is Chrome's bookmark
    // manager and Cmd+U is View-Source on most browsers (and not always
    // overridable), so Alt is the safe modifier here.
    if (event.altKey && event.code === 'KeyO') {
      event.preventDefault()
      openUrlPrompt(harness)
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
    // Cmd/Ctrl + 1..4 — direct mode jump. event.code over event.key so
    // the binding is stable across keyboard layouts. Mac users on
    // Safari can't use Cmd+1..4 (Safari reserves them for tab switch);
    // plain Ctrl+1..4 also fires our handler via the ctrlKey branch.
    if (
      event.code === 'Digit1' ||
      event.code === 'Digit2' ||
      event.code === 'Digit3' ||
      event.code === 'Digit4'
    ) {
      event.preventDefault()
      harness.switchTo(Number(event.code.slice(5)))
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
    // Cmd+Return — toggle Read ↔ Write. From Read, jump into Write;
    // from Write, jump back to Read; from Split or Code, go to Write
    // (treats Cmd+Return as "go to primary edit mode").
    if (event.code === 'Enter') {
      event.preventDefault()
      const cur = harness.getCurrentMode().key
      harness.switchTo(cur === 2 ? 1 : 2)
      return
    }
    // Cmd+\ — swap between the two most recently committed themes.
    // Designed for "I have a light theme and a dark theme and want
    // to bounce between them." No-op until the user has changed
    // theme at least once.
    if (event.code === 'Backslash') {
      event.preventDefault()
      const swapped = toggleRecentTheme()
      if (swapped) showThemeToast(swapped)
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
  })
}

// Cmd/Ctrl + Shift + F — toggle fullscreen. Inside Tauri the native window
// API gives macOS-native fullscreen (menu bar hidden, dock hidden); in plain
// browser contexts the HTML5 Fullscreen API does the equivalent on the page.
// Also flips data-fullscreen on <html> so CSS can hide the title strip.
export async function toggleFullscreen(): Promise<void> {
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
