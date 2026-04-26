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
import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
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

const codeMirrorBase = [
  history(),
  drawSelection(),
  EditorView.lineWrapping,
  markdown({ extensions: [GFM] }),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
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
    if (!meta || event.shiftKey || event.altKey) return
    const n = Number(event.key)
    if (Number.isInteger(n) && n >= 1 && n <= 5) {
      event.preventDefault()
      harness.switchTo(n)
    }
  })
}

boot()
