// ProseMirror find adapter for Tiptap (Write mode).
//
// Why a PM plugin instead of wrapping `<mark>` in the contentDOM:
// Tiptap reconciles its editor DOM against the underlying PM state,
// so any non-PM element we inserted would either get clobbered on the
// next render or trigger ProseMirror to think the doc structure
// changed. Decorations are PM's purpose-built mechanism for ephemeral
// visual overlays — they live alongside the doc state without being
// part of it, and PM redraws them automatically when content shifts.
//
// Match collection walks the PM doc's text nodes (literally, the
// text-typed Node instances), recording absolute positions so the
// decoration ranges and the optional selection change both speak the
// same coordinate system. We deliberately keep the navigation simple:
// `next` / `prev` set a text selection at the current match and call
// scrollIntoView, mirroring how CM and most editor find UIs behave.

import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { FindAdapter, SearchStats } from './types'

interface Match {
  from: number
  to: number
}

interface PluginState {
  matches: Match[]
  currentIdx: number
}

const FIND_PLUGIN_KEY = new PluginKey<PluginState>('nicermd-find')

function collectMatches(doc: PmNode, query: string): Match[] {
  if (!query) return []
  const out: Match[] = []
  const lcNeedle = query.toLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = node.text ?? ''
    if (!text) return
    const haystack = text.toLowerCase()
    let cursor = 0
    let idx = haystack.indexOf(lcNeedle, cursor)
    while (idx !== -1) {
      out.push({ from: pos + idx, to: pos + idx + lcNeedle.length })
      cursor = idx + lcNeedle.length
      idx = haystack.indexOf(lcNeedle, cursor)
    }
  })
  return out
}

export function createPmFindAdapter(editor: Editor): FindAdapter {
  let lastQuery = ''

  const plugin = new Plugin<PluginState>({
    key: FIND_PLUGIN_KEY,
    state: {
      init: () => ({ matches: [], currentIdx: -1 }),
      apply(tr, value) {
        const meta = tr.getMeta(FIND_PLUGIN_KEY) as PluginState | undefined
        if (meta) return meta
        // Doc edit while highlights are showing: invalidate matches.
        // The bar will re-issue setQuery via its own listeners (or the
        // user will scroll past the now-empty count). Cheap defensive
        // clear keeps decorations from pointing into the wrong byte
        // ranges after an insert/delete.
        if (tr.docChanged && value.matches.length > 0) {
          return { matches: [], currentIdx: -1 }
        }
        return value
      },
    },
    props: {
      decorations(state) {
        const v = FIND_PLUGIN_KEY.getState(state)
        if (!v || v.matches.length === 0) return DecorationSet.empty
        const decos: Decoration[] = []
        for (let i = 0; i < v.matches.length; i++) {
          const m = v.matches[i]!
          const cls =
            i === v.currentIdx
              ? 'nicermd-find nicermd-find--current'
              : 'nicermd-find'
          decos.push(Decoration.inline(m.from, m.to, { class: cls }))
        }
        return DecorationSet.create(state.doc, decos)
      },
    },
  })

  editor.registerPlugin(plugin)

  function setState(matches: Match[], currentIdx: number): void {
    const tr = editor.view.state.tr.setMeta(FIND_PLUGIN_KEY, { matches, currentIdx })
    editor.view.dispatch(tr)
  }

  function getState(): PluginState {
    return (
      FIND_PLUGIN_KEY.getState(editor.view.state) ?? {
        matches: [],
        currentIdx: -1,
      }
    )
  }

  function gotoCurrent(): void {
    const { matches, currentIdx } = getState()
    if (currentIdx < 0 || currentIdx >= matches.length) return
    const m = matches[currentIdx]!
    // setTextSelection + scrollIntoView mirrors what cm-find does for
    // the Code modes — cursor lands at the match and the editor
    // scrolls to bring it into view. Tiptap focuses naturally because
    // setTextSelection dispatches on the active editor view.
    editor
      .chain()
      .setTextSelection({ from: m.from, to: m.to })
      .scrollIntoView()
      .run()
  }

  function stats(): SearchStats {
    const { matches, currentIdx } = getState()
    return {
      matchCount: matches.length,
      current: currentIdx >= 0 ? currentIdx + 1 : 0,
    }
  }

  return {
    setQuery(query) {
      if (query === lastQuery) return stats()
      lastQuery = query
      const matches = collectMatches(editor.view.state.doc, query)
      const currentIdx = matches.length > 0 ? 0 : -1
      setState(matches, currentIdx)
      if (currentIdx >= 0) gotoCurrent()
      return stats()
    },
    next() {
      const { matches, currentIdx } = getState()
      if (matches.length === 0) return stats()
      const nextIdx = (currentIdx + 1) % matches.length
      setState(matches, nextIdx)
      gotoCurrent()
      return stats()
    },
    prev() {
      const { matches, currentIdx } = getState()
      if (matches.length === 0) return stats()
      const prevIdx = (currentIdx - 1 + matches.length) % matches.length
      setState(matches, prevIdx)
      gotoCurrent()
      return stats()
    },
    close() {
      editor.unregisterPlugin(FIND_PLUGIN_KEY)
      lastQuery = ''
    },
  }
}
