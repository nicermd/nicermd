// CodeMirror 6 prototype — engine spike for the 5-mode editor.
// Goal at this checkpoint: prove CM mounts, loads markdown, edits cleanly,
// and renders syntax-highlighted markdown in a centred reading column.
// Mode wiring, palette, format bar, FAB all come back later once the
// foundation is sound. See memory/milkdown_v1_learnings.md for the patterns
// to port.

import { EditorState, StateField } from '@codemirror/state'
import type { Range } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  Decoration,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, syntaxTree } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { render as renderMarkdown } from 'nicermd-core'

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
    // List item widgets — bullets and task checkboxes.
    '.cm-list-bullet': {
      color: '#6b7280',
      fontWeight: '700',
    },
    '.cm-task-marker': {
      color: '#6b7280',
      letterSpacing: '0.04em',
    },
    '.cm-task-marker.is-checked': {
      color: '#2563eb',
    },
    '.cm-image-widget': {
      maxWidth: '100%',
      height: 'auto',
      display: 'inline-block',
      borderRadius: '4px',
      verticalAlign: 'middle',
    },
    // Fenced code block lines — uniform bg, rounded corners on first/last.
    // Empty first/last lines (markers hidden) act as visual padding inside
    // the block. All lines share the same line-height so the bg flows clean.
    '.cm-code-line': {
      backgroundColor: '#f6f8fa',
      paddingLeft: '0.85em',
      paddingRight: '0.85em',
    },
    '.cm-code-line-first': {
      borderRadius: '6px 6px 0 0',
    },
    '.cm-code-line-last': {
      borderRadius: '0 0 6px 6px',
    },
    // Horizontal rule — line gets the `cm-hr-line` class; chars are hidden,
    // a pseudo-element draws the rule centred vertically across the line.
    '.cm-hr-line': {
      position: 'relative',
    },
    '.cm-hr-line::after': {
      content: '""',
      position: 'absolute',
      top: '50%',
      left: '0',
      right: '0',
      borderTop: '1px solid #d1d5db',
    },
    // Diagnostic placeholder version of the table widget — bright box so it's
    // visually obvious where the widget rendered.
    '.cm-table-widget': {
      backgroundColor: '#fef3c7',
      padding: '0.75em',
      margin: '1em 0',
      textAlign: 'center',
      fontWeight: '600',
      borderRadius: '6px',
    },
    // (Real table styling, kept for when we wire the rendered HTML back in.)
    '.cm-table-widget--real': {
      margin: '1em 0',
      cursor: 'text',
    },
    '.cm-table-widget table': {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: '0.95em',
    },
    '.cm-table-widget th, .cm-table-widget td': {
      padding: '0.5em 0.75em',
      borderBottom: '1px solid #e5e7eb',
      textAlign: 'left',
      verticalAlign: 'top',
    },
    '.cm-table-widget th': {
      borderBottom: '2px solid #d1d5db',
      fontWeight: '600',
      color: '#111827',
    },
    '.cm-table-widget tr:hover td': {
      backgroundColor: '#f9fafb',
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

// Block-widget: tables. Diagnostic placeholder version — once block layout is
// confirmed working we'll swap to the rendered nicermd-core HTML.
// Holds the source position so a click can dispatch the cursor INTO the
// widget's range, which triggers the StateField to unmount and reveal source.
class TableWidget extends WidgetType {
  constructor(
    readonly markdown: string,
    readonly fromPos: number,
  ) {
    super()
  }
  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-table-widget'
    wrapper.textContent = 'TABLE PLACEHOLDER'
    wrapper.addEventListener('mousedown', (event) => {
      event.preventDefault()
      view.dispatch({ selection: { anchor: this.fromPos } })
      view.focus()
    })
    return wrapper
  }
  eq(other: TableWidget): boolean {
    return other.markdown === this.markdown && other.fromPos === this.fromPos
  }
  // We handle mousedown ourselves; let other events fall through.
  ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown'
  }
}

// Inline list-item widgets — bullet for unordered lists, checkbox for tasks.
// Source remains intact; the widgets only replace the marker characters when
// off-cursor, preserving the markdown bytes for editing on the cursor line.
class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-list-bullet'
    span.textContent = '•'
    return span
  }
  eq(): boolean {
    return true
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = `cm-task-marker${this.checked ? ' is-checked' : ''}`
    span.textContent = this.checked ? '☑' : '☐'
    return span
  }
  eq(other: TaskWidget): boolean {
    return other.checked === this.checked
  }
}

// Inline HR widget — renders a thin horizontal line in place of `---` source.
class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-hr-widget'
    return span
  }
  eq(): boolean {
    return true
  }
}

// Inline image widget — replaces `![alt](src)` with an actual <img>. Inline
// replace (not block), so it works whether the image is alone on a line or
// embedded mid-paragraph. Click → CM positions cursor on the line, widget
// unmounts, source returns for editing.
class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super()
  }
  toDOM(): HTMLElement {
    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.className = 'cm-image-widget'
    return img
  }
  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt
  }
  ignoreEvent(): boolean {
    return false
  }
}
// Block markers consume the trailing space too so content sits flush left.
const MARKERS_WITH_TRAILING_SPACE = new Set(['HeaderMark', 'QuoteMark'])
// Inline markers: emphasis (`*`/`_`), strong (`**`/`__`), inline code (`` ` ``),
// strike (`~~`), the brackets/parens of links and images (`[`, `]`, `(`, `)`,
// `!`), the URL inside a link/image. CodeMark is included — but for *fenced*
// code blocks the parent check skips it (otherwise the ``` and language tag
// lines collapse to empty lines, making the code float). When fenced code
// gets a proper widget renderer, we can revisit.
const INLINE_MARKERS = new Set([
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'LinkMark',
  'URL',
])

function buildLiveDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const add = (from: number, to: number, deco: Decoration): void => {
    ranges.push(deco.range(from, to))
  }
  const tree = syntaxTree(view.state)
  const doc = view.state.doc

  // Lines that contain (or are adjacent to) any cursor stay fully revealed.
  // When the editor isn't focused, no line is "active" — every marker hides,
  // giving a clean rendered-looking view on first load and whenever the user
  // clicks away. Clicking in restores normal cursor-line reveal.
  const cursorLines = new Set<number>()
  if (view.hasFocus) {
    for (const range of view.state.selection.ranges) {
      const fromLine = doc.lineAt(range.from).number
      const toLine = doc.lineAt(range.to).number
      for (let i = fromLine; i <= toLine; i++) cursorLines.add(i)
    }
  }

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        // Block widget: tables get swapped for rendered HTML when off-cursor.
        // When any cursor line falls inside the table's line range, fall back
        // to source mode (skip widget, visit children for normal marker hide).
        if (node.name === 'Table') {
          const fromLine = doc.lineAt(node.from).number
          const toLine = doc.lineAt(node.to).number
          let onCursor = false
          for (const ln of cursorLines) {
            if (ln >= fromLine && ln <= toLine) {
              onCursor = true
              break
            }
          }
          // Tables are handled by a separate StateField (block decorations
          // can't live in a ViewPlugin). Skip children when off-cursor so we
          // don't process inner markers — the widget covers them. Visit
          // children when on-cursor for normal source-view marker handling.
          if (!onCursor) return false
          return
        }

        // Fenced code block — apply per-line bg styling so the block reads as
        // a code block. The opening (```lang) and closing (```) lines have
        // their content hidden off-cursor, so they appear as empty bg strips
        // bracketing the code (visually the bg padding). On-cursor lines fall
        // through to source. We manually hide the marker children rather than
        // relying on tree iteration because we return false to skip nested
        // markdown processing inside code.
        if (node.name === 'FencedCode') {
          const startLine = doc.lineAt(node.from).number
          const endLine = doc.lineAt(node.to).number
          for (let ln = startLine; ln <= endLine; ln++) {
            const line = doc.line(ln)
            let cls = 'cm-code-line'
            if (ln === startLine) cls += ' cm-code-line-first'
            if (ln === endLine) cls += ' cm-code-line-last'
            add(line.from, line.from, Decoration.line({ class: cls }))
          }
          // Hide the ``` markers and language tag on lines off-cursor.
          const fence = node.node
          const c = fence.cursor()
          if (c.firstChild()) {
            do {
              if (c.name === 'CodeMark' || c.name === 'CodeInfo') {
                const markLine = doc.lineAt(c.from).number
                if (!cursorLines.has(markLine)) add(c.from, c.to, HIDE)
              }
            } while (c.nextSibling())
          }
          return false
        }

        // Horizontal rule — apply a class to the line + hide the `---` chars.
        // A pseudo-element on the line creates the visible rule. Earlier
        // widget approach (inline-block + width: 100%) caused the paragraph
        // above to render at heading size — likely a layout side effect of
        // the widget on neighbouring line measurements.
        if (node.name === 'HorizontalRule') {
          const lineNum = doc.lineAt(node.from).number
          if (cursorLines.has(lineNum)) return
          const line = doc.line(lineNum)
          add(line.from, line.from, Decoration.line({ class: 'cm-hr-line' }))
          add(node.from, node.to, HIDE)
          return false
        }

        // Image widget — replace `![alt](src)` with an <img>. When cursor is
        // on the image's line we leave source visible and let normal marker
        // hiding handle the rest (LinkMark/URL each skip on cursor line).
        if (node.name === 'Image') {
          const lineNum = doc.lineAt(node.from).number
          if (cursorLines.has(lineNum)) return
          const text = doc.sliceString(node.from, node.to)
          const m = text.match(/^!\[([^\]]*)\]\(([^\s)]+)/)
          if (!m) return
          const alt = m[1] ?? ''
          const src = m[2] ?? ''
          add(node.from, node.to, Decoration.replace({ widget: new ImageWidget(src, alt) }))
          return false
        }

        // List bullets and task checkboxes (off-cursor only).
        if (node.name === 'ListMark') {
          const lineNum = doc.lineAt(node.from).number
          if (cursorLines.has(lineNum)) return
          const item = node.node.parent
          // If the list item has a TaskMarker, hide the list bullet entirely —
          // the checkbox replaces it visually so we don't show "• ☐".
          if (item) {
            const c = item.cursor()
            let hasTask = false
            if (c.firstChild()) {
              do {
                if (c.name === 'TaskMarker') {
                  hasTask = true
                  break
                }
              } while (c.nextSibling())
            }
            if (hasTask) {
              let toPos = node.to
              if (doc.sliceString(toPos, toPos + 1) === ' ') toPos += 1
              add(node.from, toPos, HIDE)
              return
            }
          }
          // Replace `-`/`*`/`+` with a bullet glyph. Ordered list numbers
          // (1., 2., …) keep as-is — the numbers carry meaning.
          const isOrdered = item?.parent?.name === 'OrderedList'
          if (!isOrdered) {
            add(node.from, node.to, Decoration.replace({ widget: new BulletWidget() }))
          }
          return
        }
        if (node.name === 'TaskMarker') {
          const lineNum = doc.lineAt(node.from).number
          if (cursorLines.has(lineNum)) return
          const text = doc.sliceString(node.from, node.to)
          const checked = /^\[x\]$/i.test(text)
          add(node.from, node.to, Decoration.replace({ widget: new TaskWidget(checked) }))
          return
        }

        const isBlock = MARKERS_WITH_TRAILING_SPACE.has(node.name)
        const isInline = INLINE_MARKERS.has(node.name)
        if (!isBlock && !isInline) return
        // Skip CodeMark inside a FencedCode — those are the ``` lines, hiding
        // them collapses content to empty lines.
        if (node.name === 'CodeMark' && node.node.parent?.name === 'FencedCode') return
        const lineNum = doc.lineAt(node.from).number
        if (cursorLines.has(lineNum)) return
        let toPos = node.to
        if (isBlock && doc.sliceString(toPos, toPos + 1) === ' ') toPos += 1
        add(node.from, toPos, HIDE)
      },
    })
  }

  return Decoration.set(ranges, true)
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildLiveDecorations(view)
    }
    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged
      ) {
        this.decorations = buildLiveDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

// Block decorations (tables today; later images-on-their-own-line, math
// blocks, mermaid, etc.) must live in a StateField — CM rejects block
// decorations sourced from a ViewPlugin. Walks the whole syntax tree on
// each transaction; tree iteration is sub-millisecond on typical docs.
function buildBlockDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const doc = state.doc
  const tree = syntaxTree(state)

  const cursorLines = new Set<number>()
  for (const range of state.selection.ranges) {
    const fromLine = doc.lineAt(range.from).number
    const toLine = doc.lineAt(range.to).number
    for (let i = fromLine; i <= toLine; i++) cursorLines.add(i)
  }

  tree.iterate({
    enter: (node) => {
      if (node.name !== 'Table') return
      const fromLine = doc.lineAt(node.from).number
      const toLine = doc.lineAt(node.to).number
      let onCursor = false
      for (const ln of cursorLines) {
        if (ln >= fromLine && ln <= toLine) {
          onCursor = true
          break
        }
      }
      if (!onCursor) {
        const tableMarkdown = doc.sliceString(node.from, node.to)
        const blockFrom = doc.line(fromLine).from
        const blockTo = toLine < doc.lines ? doc.line(toLine + 1).from : doc.length
        ranges.push(
          Decoration.replace({
            block: true,
            widget: new TableWidget(tableMarkdown, node.from),
          }).range(blockFrom, blockTo),
        )
        return false
      }
      return
    },
  })

  return Decoration.set(ranges, true)
}

const blockDecorations = StateField.define<DecorationSet>({
  create(state) {
    return buildBlockDecorations(state)
  },
  update(decos, tr) {
    if (tr.docChanged || tr.selection) {
      return buildBlockDecorations(tr.state)
    }
    return decos.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

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
      blockDecorations,
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
