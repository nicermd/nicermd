// CodeMirror 6 prototype — engine spike for the 5-mode editor.
// Goal at this checkpoint: prove CM mounts, loads markdown, edits cleanly,
// and renders syntax-highlighted markdown in a centred reading column.
// Mode wiring, palette, format bar, FAB all come back later once the
// foundation is sound. See memory/milkdown_v1_learnings.md for the patterns
// to port.

import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language'
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
    '.cm-focused': {
      outline: 'none',
    },
    '.cm-scroller': {
      fontFamily: 'inherit',
      lineHeight: 'inherit',
      overflow: 'visible',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(37, 99, 235, 0.18)',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
  },
  { dark: false },
)

function mount(parent: HTMLElement): EditorView {
  const state = EditorState.create({
    doc: INITIAL,
    extensions: [
      history(),
      drawSelection(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      markdown(),
      syntaxHighlighting(proseHighlight),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
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
