// Hybrid-engine spike — five-mode harness with hot-swapped editors.
//
// Mode order (nicest → least nice):
//   1 Read              nicermd-core HTML, no editor
//   2 WYSIWYG           Tiptap (placeholder for now)
//   3 Themed code       CM + theme decorations (placeholder for now)
//   4 Code + preview    CM source + nicermd-core preview, live-updating
//   5 Raw code          CM, syntax highlighting only
//
// Each mode is a function (parent, markdown) → ModeHandle. Switching:
// capture text via getMarkdown(), destroy(), mount the next mode with the
// captured text. Cmd/Ctrl + 1..5 cycles modes.

import { EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { render as renderMarkdown } from 'nicermd-core'

import showcase from './samples/showcase.md?raw'
import './main.css'

interface ModeHandle {
  destroy(): void
  getMarkdown(): string
}

interface ModeDef {
  key: number
  label: string
  mount: (parent: HTMLElement, markdown: string) => ModeHandle
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
  div.innerHTML = renderMarkdown(markdown)
  parent.appendChild(div)
  return {
    destroy: () => div.remove(),
    getMarkdown: () => markdown,
  }
}

function mountWysiwygPlaceholder(parent: HTMLElement, markdown: string): ModeHandle {
  const div = document.createElement('div')
  div.className = 'mode-placeholder'
  const heading = document.createElement('h2')
  heading.textContent = 'Mode 2 — WYSIWYG (placeholder)'
  const note = document.createElement('p')
  note.textContent =
    'Tiptap will mount here, lazy-loaded on first enter. For now this proves the mode-switch carries text in/out cleanly.'
  const sample = document.createElement('pre')
  sample.textContent = markdown.slice(0, 400) + (markdown.length > 400 ? '…' : '')
  div.append(heading, note, sample)
  parent.appendChild(div)
  return {
    destroy: () => div.remove(),
    getMarkdown: () => markdown,
  }
}

function mountThemedCodePlaceholder(parent: HTMLElement, markdown: string): ModeHandle {
  const div = document.createElement('div')
  div.className = 'mode-placeholder'
  const heading = document.createElement('h2')
  heading.textContent = 'Mode 3 — Themed code (placeholder)'
  const note = document.createElement('p')
  note.textContent =
    'CodeMirror with theme decorations applied to markers (#, **, etc.) — markers stay visible, styling tracks the theme. Decoration work from v0.2-cm-prototype ports here.'
  div.append(heading, note)
  parent.appendChild(div)
  return {
    destroy: () => div.remove(),
    getMarkdown: () => markdown,
  }
}

function mountCodePlusPreview(parent: HTMLElement, markdown: string): ModeHandle {
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
          if (update.docChanged) renderTo(update.state.doc.toString())
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

function mountRawCode(parent: HTMLElement, markdown: string): ModeHandle {
  const wrap = document.createElement('div')
  wrap.className = 'mode-raw'
  parent.appendChild(wrap)
  const view = new EditorView({
    state: EditorState.create({
      doc: markdown,
      extensions: codeMirrorBase,
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
  { key: 2, label: 'WYSIWYG', mount: mountWysiwygPlaceholder },
  { key: 3, label: 'Themed code', mount: mountThemedCodePlaceholder },
  { key: 4, label: 'Code + preview', mount: mountCodePlusPreview },
  { key: 5, label: 'Raw code', mount: mountRawCode },
]

class Harness {
  private currentMode = 1
  private currentHandle: ModeHandle | null = null
  private currentMarkdown = showcase

  constructor(
    private readonly host: HTMLElement,
    private readonly label: HTMLElement,
  ) {}

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
    this.currentHandle = next.mount(this.host, this.currentMarkdown)
    this.label.textContent = `Mode ${key} · ${next.label}`
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
    if (Number.isInteger(n) && n >= 1 && n <= 5) {
      event.preventDefault()
      harness.switchTo(n)
    }
  })
}

boot()
