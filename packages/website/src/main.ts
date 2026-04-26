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

import { EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { render as renderMarkdown } from 'nicermd-core'

import stress from './samples/stress.md?raw'
import './main.css'

interface ModeHandle {
  destroy(): void
  getMarkdown(): string
  // Optional — only modes that can re-render without disturbing user
  // editing state implement this. Used to receive cross-tab updates.
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

// Cross-tab sync: every tab broadcasts its current markdown when an editor
// emits an onChange. Receiving tabs update their currentMarkdown and, if
// the active mode supports setMarkdown (currently mode 1 read), re-render
// in place. Editing modes ignore incoming broadcasts to preserve cursor
// state. ?freeze=1 disables receiving — for a "before" snapshot tab.
class Harness {
  private currentMode = 1
  private currentHandle: ModeHandle | null = null
  private currentMarkdown = stress
  private readonly channel = new BroadcastChannel('nicermd-spike')
  private readonly tabId =
    typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Math.random())
  private readonly frozen: boolean

  constructor(
    private readonly host: HTMLElement,
    private readonly label: HTMLElement,
  ) {
    this.frozen = new URLSearchParams(window.location.search).get('freeze') === '1'
    if (!this.frozen) {
      this.channel.addEventListener('message', (event) => {
        const data = event.data as { tabId: string; markdown: string } | undefined
        if (!data || data.tabId === this.tabId) return
        this.currentMarkdown = data.markdown
        this.currentHandle?.setMarkdown?.(data.markdown)
      })
    }
  }

  private readonly handleLocalChange = (md: string): void => {
    this.currentMarkdown = md
    this.channel.postMessage({ tabId: this.tabId, markdown: md })
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
    const suffix = this.frozen ? ' · frozen' : ''
    this.label.textContent = `Mode ${key} · ${next.label}${suffix}`
  }

  cycle(): void {
    const next = (this.currentMode % MODES.length) + 1
    this.switchTo(next)
  }
}

function boot(): void {
  const root = document.querySelector<HTMLElement>('#app')
  if (!root) throw new Error('#app root missing')
  root.innerHTML = ''

  const label = document.createElement('div')
  label.className = 'mode-label'
  root.appendChild(label)

  const host = document.createElement('div')
  host.className = 'mode-host'
  root.appendChild(host)

  const harness = new Harness(host, label)
  harness.switchTo(1)

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

boot()
