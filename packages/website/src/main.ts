// CodeMirror 6 prototype — engine spike for the 5-mode editor.
// Goal at this checkpoint: prove CM mounts, loads markdown, edits cleanly,
// and renders syntax-highlighted markdown in a centred reading column.
// Mode wiring, palette, format bar, FAB all come back later once the
// foundation is sound. See memory/milkdown_v1_learnings.md for the patterns
// to port.

import { EditorState, RangeSetBuilder } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  Decoration,
  ViewPlugin,
} from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, syntaxTree } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

import showcase from './samples/showcase.md?raw'

const INITIAL = showcase

// Prose-friendly highlight palette — sized headings, bold/italic styled
// inline, code blocks tinted. This is the "source + theme styling" mode
// in spirit, even though we haven't built mode-switching yet.
const proseHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.75em', fontWeight: '700', color: '#111827' },
  { tag: t.heading2, fontSize: '1.4em', fontWeight: '700', color: '#111827' },
  { tag: t.heading3, fontSize: '1.2em', fontWeight: '600', color: '#1f2937' },
  { tag: t.heading4, fontSize: '1.1em', fontWeight: '600', color: '#1f2937' },
  { tag: [t.heading5, t.heading6], fontWeight: '600', color: '#1f2937' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: '#6b7280' },
  { tag: t.link, color: '#2563eb', textDecoration: 'underline' },
  { tag: t.url, color: '#6b7280' },
  { tag: t.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#7c3aed' },
  { tag: t.quote, color: '#4b5563', fontStyle: 'italic' },
  // Markdown markers (#, *, _, `, etc.) — kept visible but quietened so
  // they don't shout. Mode 4 will hide them off-cursor via decorations.
  { tag: t.processingInstruction, color: '#9ca3af' },
  { tag: t.meta, color: '#9ca3af' },
])

// Editor theme — quiet, prose-focused. Centred 720px column, system font for body
// (markdown blocks like code stay monospace via the highlight palette). No gutter,
// no active-line shading. White background to match the v1 read view.
const proseTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#ffffff',
      color: '#1f2937',
      height: '100vh',
      maxWidth: '720px',
      margin: '0 auto',
      padding: '3rem 1rem 6rem',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '17px',
      lineHeight: '1.65',
      border: 'none',
      outline: 'none',
    },
    '&.cm-editor.cm-focused': {
      outline: 'none',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
    },
    '.cm-content': {
      padding: '0',
      caretColor: '#111827',
    },
    '.cm-line': {
      padding: '0',
    },
    '.cm-cursor': {
      borderLeftColor: '#111827',
      borderLeftWidth: '2px',
    },
    '.cm-scroller': {
      fontFamily: 'inherit',
      lineHeight: 'inherit',
      overflow: 'visible',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(37, 99, 235, 0.18)',
    },
  },
  { dark: false },
)

// Live preview plugin — Obsidian / Typora behaviour. Walks the syntax tree in
// the visible viewport, hides marker tokens (#, **, *, ~~, `) on lines that
// don't contain the cursor, leaves them visible on the cursor's line. Lezer
// trees are already incrementally maintained, so iteration is cheap (<1ms for
// typical docs). For headings and quotes the trailing space after the marker
// is collapsed too so content doesn't appear shifted.
const HIDE = Decoration.replace({})
// Block markers consume the trailing space too so content sits flush left.
const MARKERS_WITH_TRAILING_SPACE = new Set(['HeaderMark', 'QuoteMark'])
// Inline markers: emphasis (`*`/`_`), strong (`**`/`__`), inline code (`` ` ``),
// strike (`~~`), the brackets/parens of links and images (`[`, `]`, `(`, `)`,
// `!`), the URL inside a link/image, and the language tag on a fenced code
// block (e.g. ` ```python `). The fenced code block's ``` itself is `CodeMark`
// and is already handled by that entry.
const INLINE_MARKERS = new Set([
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'LinkMark',
  'URL',
  'CodeInfo',
])

function buildLiveDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const tree = syntaxTree(view.state)
  const doc = view.state.doc

  // Lines that contain (or are adjacent to) any cursor stay fully revealed.
  const cursorLines = new Set<number>()
  for (const range of view.state.selection.ranges) {
    const fromLine = doc.lineAt(range.from).number
    const toLine = doc.lineAt(range.to).number
    for (let i = fromLine; i <= toLine; i++) cursorLines.add(i)
  }

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const isBlock = MARKERS_WITH_TRAILING_SPACE.has(node.name)
        const isInline = INLINE_MARKERS.has(node.name)
        if (!isBlock && !isInline) return
        const lineNum = doc.lineAt(node.from).number
        if (cursorLines.has(lineNum)) return
        let toPos = node.to
        if (isBlock && doc.sliceString(toPos, toPos + 1) === ' ') toPos += 1
        builder.add(node.from, toPos, HIDE)
      },
    })
  }

  return builder.finish()
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildLiveDecorations(view)
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildLiveDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

function mount(parent: HTMLElement): EditorView {
  const state = EditorState.create({
    doc: INITIAL,
    extensions: [
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      markdown({ extensions: [GFM] }),
      syntaxHighlighting(proseHighlight),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      livePreview,
      proseTheme,
      keymap.of([...defaultKeymap, ...historyKeymap]),
    ],
  })

  return new EditorView({ state, parent })
}

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('#app root missing')
mount(root)

// Suppress the unused-import warning for lineNumbers — kept as a reminder
// that CM ships a gutter we may want for mode 2 (raw source edit).
void lineNumbers
