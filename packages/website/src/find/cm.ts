// CodeMirror find adapter.
//
// Used by Code (mode 4) and Split's editor pane (mode 3 left). Drives
// CodeMirror's built-in `@codemirror/search` decorations via
// setSearchQuery so the match highlights match CM's native look —
// then handles next/prev navigation by collecting match positions
// from `SearchCursor` and dispatching selection changes ourselves
// instead of opening CM's separate search panel (we'd otherwise be
// showing TWO find UIs at once).

import { EditorView } from '@codemirror/view'
import { SearchCursor, SearchQuery, setSearchQuery } from '@codemirror/search'
import type { FindAdapter, SearchStats } from './types'

type Match = { from: number; to: number }

function collectMatches(view: EditorView, query: string): Match[] {
  if (!query) return []
  const out: Match[] = []
  const cursor = new SearchCursor(
    view.state.doc,
    query,
    0,
    view.state.doc.length,
    (s) => s.toLowerCase(),
  )
  while (!cursor.next().done) {
    out.push({ from: cursor.value.from, to: cursor.value.to })
  }
  return out
}

export function createCmFindAdapter(view: EditorView): FindAdapter {
  let matches: Match[] = []
  let currentIdx = -1
  let lastQuery = ''

  function gotoCurrent(): void {
    if (currentIdx < 0 || currentIdx >= matches.length) return
    const m = matches[currentIdx]!
    view.dispatch({
      selection: { anchor: m.from, head: m.to },
      effects: EditorView.scrollIntoView(m.from, { y: 'center' }),
    })
  }

  function stats(): SearchStats {
    return {
      matchCount: matches.length,
      current: currentIdx >= 0 ? currentIdx + 1 : 0,
    }
  }

  function rebuild(query: string): SearchStats {
    lastQuery = query
    matches = collectMatches(view, query)
    // Set search query state so CM draws the standard match
    // decorations. Empty query clears them.
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: query, caseSensitive: false }),
      ),
    })
    if (matches.length > 0) {
      currentIdx = 0
      gotoCurrent()
    } else {
      currentIdx = -1
    }
    return stats()
  }

  return {
    setQuery(query) {
      if (query === lastQuery) return stats()
      return rebuild(query)
    },
    next() {
      if (matches.length === 0) return stats()
      currentIdx = (currentIdx + 1) % matches.length
      gotoCurrent()
      return stats()
    },
    prev() {
      if (matches.length === 0) return stats()
      currentIdx = (currentIdx - 1 + matches.length) % matches.length
      gotoCurrent()
      return stats()
    },
    close() {
      // Clear CM's search-query state (which removes highlights) but
      // leave the user's selection alone — they may want to keep
      // working from wherever the last match landed.
      view.dispatch({
        effects: setSearchQuery.of(new SearchQuery({ search: '' })),
      })
      matches = []
      currentIdx = -1
      lastQuery = ''
    },
  }
}
