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
import './main.css'

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

// GitHub markdown source highlight palette — markers (#, **, *, _, `, ~~,
// list bullets, --- rules) get GitHub's "danger" red; link text blue; URLs
// and quotes green; emphasis/strong styled with weight + italic on the
// content tokens themselves so headings and bold lines read as intended.
const githubMdHighlight = HighlightStyle.define([
  { tag: t.processingInstruction, color: '#cf222e' },
  { tag: t.contentSeparator, color: '#cf222e' },
  { tag: t.heading1, fontWeight: '700', color: '#0550ae' },
  { tag: t.heading2, fontWeight: '700', color: '#0550ae' },
  { tag: t.heading3, fontWeight: '700', color: '#0550ae' },
  { tag: t.heading4, fontWeight: '700', color: '#0550ae' },
  { tag: t.heading5, fontWeight: '700', color: '#0550ae' },
  { tag: t.heading6, fontWeight: '700', color: '#0550ae' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#0969da' },
  { tag: t.url, color: '#1a7f37' },
  { tag: t.monospace, color: '#0550ae' },
  { tag: t.quote, color: '#1a7f37' },
  { tag: t.meta, color: '#cf222e' },
])

const githubCodeTheme = EditorView.theme({
  '&': {
    backgroundColor: '#ffffff',
    color: '#1f2328',
    fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
    fontSize: '13px',
    lineHeight: '1.55',
  },
  '.cm-content': {
    caretColor: '#0969da',
  },
  '.cm-cursor': {
    borderLeftColor: '#0969da',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(9, 105, 218, 0.18)',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
  },
  // GitHub-style line numbers — narrow gutter, muted color, right-aligned.
  '.cm-gutters': {
    backgroundColor: '#ffffff',
    border: 'none',
    color: '#8c959f',
    fontFamily: 'inherit',
    fontSize: '12px',
    paddingRight: '12px',
  },
  '.cm-gutterElement': {
    padding: '0 4px 0 8px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: '#1f2328',
  },
})

const codeMirrorBase = [
  history(),
  drawSelection(),
  lineNumbers(),
  EditorView.lineWrapping,
  markdown({ extensions: [GFM] }),
  syntaxHighlighting(githubMdHighlight),
  githubCodeTheme,
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
  private localChangeListener: OnChange | null = null
  private modeChangeListener: ((key: number, label: string) => void) | null = null

  constructor(
    private readonly host: HTMLElement,
    initialMarkdown: string,
  ) {
    this.currentMarkdown = initialMarkdown
  }

  onLocalChange(cb: OnChange): void {
    this.localChangeListener = cb
  }

  onModeChange(cb: (key: number, label: string) => void): void {
    this.modeChangeListener = cb
  }

  // External markdown injection — for dev-features cross-tab sync, and
  // any future feature that needs to push text into the current mode.
  // Only modes that expose setMarkdown actually update; editing modes
  // ignore the call to preserve cursor/selection state.
  setMarkdown(md: string): void {
    this.currentMarkdown = md
    this.currentHandle?.setMarkdown?.(md)
  }

  getCurrentMode(): { key: number; label: string } {
    const def = MODES.find((m) => m.key === this.currentMode)
    return { key: this.currentMode, label: def?.label ?? '' }
  }

  private readonly handleLocalChange = (md: string): void => {
    this.currentMarkdown = md
    this.localChangeListener?.(md)
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
    this.modeChangeListener?.(key, next.label)
  }

  cycle(): void {
    const next = (this.currentMode % MODES.length) + 1
    this.switchTo(next)
  }
}

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app')
  if (!root) throw new Error('#app root missing')
  root.innerHTML = ''

  // Mark the document so CSS can leave clearance for the Tauri title-bar
  // overlay (traffic-light area on macOS, ~22px tall top-left).
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    document.documentElement.dataset.tauri = '1'
  }

  const host = document.createElement('div')
  host.className = 'mode-host'
  root.appendChild(host)

  let bootMarkdown: string = showcase
  // Tree-shake gate: import.meta.env.DEV is a compile-time `false` in
  // `pnpm build`, so the entire branch (and ./dev-features) is dead-code-
  // eliminated from production bundles.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('dev')) {
    try {
      const dev = await import('./dev-features')
      bootMarkdown = dev.bootDoc
      // setupDev wires its own listeners; harness already exists below.
      const harness = new Harness(host, bootMarkdown)
      dev.setupDev(harness, root)
      finish(harness)
      return
    } catch (err) {
      console.error('Dev features failed to load:', err)
    }
  }

  const harness = new Harness(host, bootMarkdown)
  finish(harness)
}

function finish(harness: Harness): void {
  harness.switchTo(1)

  // No-op outside Tauri. Inside Tauri, wires native menu events to the
  // harness so File / View / Cycle menu items dispatch the right action.
  void setupTauriBridge(harness)

  window.addEventListener('keydown', (event) => {
    const meta = event.metaKey || event.ctrlKey
    if (!meta || event.altKey) return
    if (event.shiftKey) {
      if (event.key === 'M' || event.key === 'm') {
        event.preventDefault()
        harness.cycle()
      }
      return
    }
    const n = Number(event.key)
    if (Number.isInteger(n) && n >= 1 && n <= 4) {
      event.preventDefault()
      harness.switchTo(n)
    }
  })
}

void boot()
