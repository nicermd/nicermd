// Live mode — CM6 editor where markdown source stays in place styled
// inline. Block widgets only kick in for constructs that genuinely need
// HTML rendering (fenced code, tables, HR, HTML blocks). Everything
// else — headings, blockquotes, lists, paragraphs — keeps the source
// text visible with line-class + mark-hide decorations applied via
// CM6's facet pipeline. This is the Obsidian-style approach; matches
// Read-mode visual density because there are no widget→blank-line
// transitions to introduce gaps.

import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from '@codemirror/state'
import {
  EditorView,
  Decoration,
  WidgetType,
  ViewPlugin,
  type DecorationSet,
  keymap,
  drawSelection,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { search } from '@codemirror/search'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import {
  syntaxHighlighting,
  HighlightStyle,
  ensureSyntaxTree,
  syntaxTree,
  syntaxTreeAvailable,
} from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { render as renderMarkdown } from 'nicermd-core'

import { getCurrentSourceUrl } from './doc-source'
import { createCmFindAdapter } from './find/cm'
import type { FindAdapter } from './find/types'

export interface LiveHandle {
  destroy(): void
  getMarkdown(): string
  createFindAdapter(): FindAdapter | null
}

type OnChange = (markdown: string) => void

// Source-highlight palette used on revealed (cursor) lines. Identical
// to the Code mode palette so the on-cursor source view feels
// consistent with mode 5.
const liveSourceHighlight = HighlightStyle.define([
  { tag: t.heading, color: 'var(--cm-heading)', fontWeight: '600' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: 'var(--cm-link)' },
  { tag: t.url, color: 'var(--cm-url)' },
  { tag: t.monospace, color: 'var(--cm-monospace)' },
  { tag: t.quote, color: 'var(--cm-quote)' },
  { tag: [t.processingInstruction, t.contentSeparator], color: 'var(--cm-marker)' },
])

const liveTheme = EditorView.theme({
  // Let the editor grow with its content so the window scrolls
  // (Read-mode behaviour) instead of CM's internal scroller. The
  // alternative — height: 100% — gives a scrollbar inside the
  // editor that doesn't match the other modes' chrome.
  '&': {
    height: 'auto',
    backgroundColor: 'transparent',
    color: 'var(--fg)',
    fontFamily: 'var(--font-prose)',
    fontSize: 'var(--prose-font-size, 17px)',
    lineHeight: '1.65',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    padding: '2rem max(2rem, calc((100% - var(--reading-width, 68ch)) / 2)) 6rem',
    overflow: 'visible',
  },
  '.cm-content': { padding: 0, caretColor: 'var(--cm-caret, var(--accent, currentColor))' },
  '.cm-line': { padding: 0 },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, ::selection': {
    background: 'var(--cm-selection, rgba(127,127,127,0.25))',
  },
})

// Block widgets — used ONLY when HTML render is required. Everything
// else is handled inline so source positions stay addressable for
// cursor navigation and the gaps match Read-mode density.
const BLOCK_WIDGET_TYPES = new Set([
  'FencedCode',
  'CodeBlock',
  'Table',
  'HorizontalRule',
  'HTMLBlock',
])

// Inline markers we hide so the visible source reads like rendered
// output (e.g. `**bold**` → `bold`). When the cursor's line is in
// the exclude set, these are NOT hidden so the user sees the raw
// markdown they're editing.
const INLINE_MARK_TYPES = new Set([
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'LinkMark',
  'HeaderMark',
  'QuoteMark',
])

// Inline content wrappers — apply a CSS class to the content range
// so it reads as bold/italic/etc. Markers inside these get hidden
// via INLINE_MARK_TYPES above.
const INLINE_STYLE_TYPES: Record<string, string> = {
  StrongEmphasis: 'live-strong',
  Emphasis: 'live-em',
  Strikethrough: 'live-strike',
  InlineCode: 'live-inline-code',
  Link: 'live-link',
}

// Image inline widget — replaces the entire ![alt](url) syntax with
// a real <img> element so visuals match Read mode. Hits typical
// markdown image syntax; falls back to leaving source visible if the
// regex doesn't match (e.g. images with title attributes, escaped
// brackets).
class ImageWidget extends WidgetType {
  constructor(private readonly src: string, private readonly alt: string) {
    super()
  }
  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt
  }
  toDOM(): HTMLElement {
    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.style.maxWidth = '100%'
    img.style.height = 'auto'
    return img
  }
}

// Block widget renders source via the core markdown-it pipeline. The
// .mode-read class wraps the output so the same prose CSS applies.
class BlockWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly nodeName: string,
    private readonly baseUrl: string | undefined,
  ) {
    super()
  }
  eq(other: BlockWidget): boolean {
    return other.source === this.source && other.nodeName === this.nodeName
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'live-block mode-read'
    wrap.dataset.contentKind = 'markdown'
    wrap.innerHTML = renderMarkdown(this.source, { baseUrl: this.baseUrl }).trim()
    return wrap
  }
  ignoreEvent(): boolean {
    return false
  }
}

// Compute line ranges that should remain raw (not decorated). One
// range per cursor / selection — empty selections cover one line,
// non-empty cover all lines they touch.
interface ExcludeRange { from: number; to: number }
function computeExcludeRanges(state: EditorState): ExcludeRange[] {
  const doc = state.doc
  const raw: ExcludeRange[] = []
  for (const range of state.selection.ranges) {
    const startLine = doc.lineAt(range.from)
    const endLine = doc.lineAt(range.to)
    raw.push({ from: startLine.from, to: endLine.to })
  }
  raw.sort((a, b) => a.from - b.from)
  const merged: ExcludeRange[] = []
  for (const r of raw) {
    const last = merged[merged.length - 1]
    if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to)
    else merged.push({ ...r })
  }
  return merged
}

function intersectsExclude(from: number, to: number, excludes: ExcludeRange[]): boolean {
  for (const e of excludes) {
    if (e.from > to) break
    if (e.to >= from) return true
  }
  return false
}

// Focus state — when the editor doesn't have focus, exclusion is
// suppressed entirely so the initial reading view is fully styled
// rather than showing one source line under the cursor. Clicking
// into the editor enables cursor-driven reveals.
const setFocusEffect = StateEffect.define<boolean>()
const focusField = StateField.define<boolean>({
  create: () => false,
  update: (prev, tr) => {
    for (const e of tr.effects) if (e.is(setFocusEffect)) return e.value
    return prev
  },
})

function buildDecorations(state: EditorState, baseUrl: string | undefined): DecorationSet {
  const doc = state.doc
  const useTree = ensureSyntaxTree(state, doc.length, 100) ?? syntaxTree(state)
  const hasFocus = state.field(focusField, false)
  const excludes = hasFocus ? computeExcludeRanges(state) : []

  type Pending = { from: number; to: number; deco: Decoration }
  const pending: Pending[] = []

  // Helper: apply a line-class decoration to every line in [fromLine,
  // toLine], skipping lines that intersect the exclude set. The skip
  // is per-line so a single cursor on line N of a multi-line
  // blockquote only reverts line N to raw — other lines keep styling.
  const applyLineClass = (fromLine: number, toLine: number, cls: string) => {
    for (let l = fromLine; l <= toLine; l++) {
      const line = doc.line(l)
      if (intersectsExclude(line.from, line.to, excludes)) continue
      pending.push({
        from: line.from,
        to: line.from,
        deco: Decoration.line({ class: cls }),
      })
    }
  }

  useTree.iterate({
    enter: (node) => {
      const { from, to, name } = node

      // Block widget: full HTML render. Skip children (the widget
      // owns the entire range). If the source range intersects the
      // cursor's exclude set, fall through (don't add the widget) so
      // the raw source is editable.
      if (BLOCK_WIDGET_TYPES.has(name)) {
        if (intersectsExclude(from, to, excludes)) return undefined
        const source = doc.sliceString(from, to)
        pending.push({
          from,
          to,
          deco: Decoration.replace({
            widget: new BlockWidget(source, name, baseUrl),
            block: true,
          }),
        })
        return false
      }

      // ATX heading — apply line class for sizing/colour, then let
      // the iteration continue into children so HeaderMark (the `#`)
      // gets the standard mark-hide treatment via INLINE_MARK_TYPES.
      const atxMatch = name.match(/^ATXHeading([1-6])$/)
      if (atxMatch) {
        const level = atxMatch[1]
        const headLine = doc.lineAt(from).number
        applyLineClass(headLine, headLine, `live-h${level}`)
        return undefined
      }

      // Blockquote — apply line class to every line in the quote so
      // each gets the left-border + muted colour. Children include
      // QuoteMark nodes that get hidden inline.
      if (name === 'Blockquote') {
        const startLine = doc.lineAt(from).number
        const endLine = doc.lineAt(to).number
        applyLineClass(startLine, endLine, 'live-blockquote-line')
        return undefined
      }

      // Image — replace `![alt](url)` with an inline <img>. Skipped
      // when the cursor's on the line so the user sees the raw
      // syntax during editing.
      if (name === 'Image') {
        if (intersectsExclude(from, to, excludes)) return undefined
        const src = doc.sliceString(from, to)
        const match = src.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/)
        if (match) {
          pending.push({
            from,
            to,
            deco: Decoration.replace({
              widget: new ImageWidget(match[2]!, match[1]!),
            }),
          })
          return false
        }
        return undefined
      }

      // Inline markers we hide so the visible text reads clean
      // (e.g. `**` around bold content). Skipped when the line is
      // in the exclude set so the user sees raw syntax mid-edit.
      if (INLINE_MARK_TYPES.has(name)) {
        if (intersectsExclude(from, to, excludes)) return undefined
        pending.push({ from, to, deco: Decoration.replace({}) })
        return undefined
      }

      // Inline content wrappers — apply a class to the content range
      // for styling. The class is rendered in addition to whatever
      // the inner marks emit.
      const styleClass = INLINE_STYLE_TYPES[name]
      if (styleClass) {
        if (intersectsExclude(from, to, excludes)) return undefined
        pending.push({ from, to, deco: Decoration.mark({ class: styleClass }) })
        return undefined
      }

      // URL inside a Link — hide the URL chars; the visible link
      // text stays styled via the Link wrapper.
      if (name === 'URL') {
        if (intersectsExclude(from, to, excludes)) return undefined
        pending.push({ from, to, deco: Decoration.replace({}) })
        return undefined
      }

      return undefined
    },
  })

  return Decoration.set(
    pending.map((p) => p.deco.range(p.from, p.to)),
    true,
  )
}

function liveDecorationField(baseUrl: string | undefined): Extension {
  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, baseUrl)
    },
    update(_prev, tr) {
      return buildDecorations(tr.state, baseUrl)
    },
    provide: (f) => EditorView.decorations.from(f),
  })

  // Poll until the Lezer parser finishes. ensureSyntaxTree has a
  // 100ms budget; for huge docs the rest streams in via parser
  // transactions, which our update() picks up automatically. Bounded
  // at 30 rAF rounds (~0.5s) so we never spin forever.
  const poller = ViewPlugin.fromClass(
    class {
      rounds = 0
      raf: number | null = null
      constructor(view: EditorView) {
        this.tick(view)
      }
      tick(view: EditorView) {
        if (syntaxTreeAvailable(view.state, view.state.doc.length)) return
        if (this.rounds++ > 30) return
        this.raf = window.requestAnimationFrame(() => {
          view.dispatch({})
          this.tick(view)
        })
      }
      destroy() {
        if (this.raf != null) window.cancelAnimationFrame(this.raf)
      }
    },
  )

  // Focus listener — flips the focusField when the editor gains or
  // loses focus, so buildDecorations can skip exclusion on unfocused
  // mounts (the initial reading view).
  const focusWatcher = ViewPlugin.fromClass(
    class {
      view: EditorView
      onFocusIn = () => this.setFocus(true)
      onFocusOut = () => this.setFocus(false)
      constructor(view: EditorView) {
        this.view = view
        view.dom.addEventListener('focusin', this.onFocusIn)
        view.dom.addEventListener('focusout', this.onFocusOut)
      }
      setFocus(focused: boolean) {
        const current = this.view.state.field(focusField, false)
        if (current === focused) return
        this.view.dispatch({ effects: setFocusEffect.of(focused) })
      }
      destroy() {
        this.view.dom.removeEventListener('focusin', this.onFocusIn)
        this.view.dom.removeEventListener('focusout', this.onFocusOut)
      }
    },
  )

  return [focusField, field, poller, focusWatcher]
}

export function mountLive(
  parent: HTMLElement,
  markdownText: string,
  onChange?: OnChange,
): LiveHandle {
  const wrap = document.createElement('div')
  wrap.className = 'mode-live'
  parent.appendChild(wrap)

  const baseUrl = getCurrentSourceUrl() ?? undefined

  const languageCompartment = new Compartment()
  const view = new EditorView({
    state: EditorState.create({
      doc: markdownText,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        languageCompartment.of([
          markdown({ extensions: [GFM] }),
          syntaxHighlighting(liveSourceHighlight),
        ]),
        liveTheme,
        search(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        liveDecorationField(baseUrl),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange?.(update.state.doc.toString())
        }),
      ],
    }),
    parent: wrap,
  })

  // TEMP debug hatch — expose the live mode's EditorView on window so
  // the probe can read its selection/coords without poking the DOM.
  // Remove before merging the spike.
  ;(window as unknown as { __liveView?: EditorView }).__liveView = view

  return {
    destroy: () => {
      delete (window as unknown as { __liveView?: EditorView }).__liveView
      view.destroy()
      wrap.remove()
    },
    getMarkdown: () => view.state.doc.toString(),
    createFindAdapter: () => createCmFindAdapter(view),
  }
}
