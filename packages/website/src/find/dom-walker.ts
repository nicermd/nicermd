// DOM walker find adapter.
//
// Used by Read (mode 1) and Split's preview pane (mode 3 right). Walks
// text nodes inside the target element, splits them at every match,
// and wraps matches in `<mark class="nicermd-find">`. Navigation
// applies an extra `--current` class to the active mark and scrolls
// it into view.
//
// Case-insensitivity is the default — most users typing in a find bar
// want "TODO" and "todo" to both match. We use a literal substring
// (no regex / word-boundary) so partial matches inside identifiers
// behave the same way as in a browser's native find.
//
// Why mutate the DOM directly instead of using CSS `::highlight`?
// Highlight API isn't supported in Tauri's WKWebView build at the
// time of writing, and even on supported browsers it requires
// resolution-aware Range tracking that fights with our re-render-
// the-whole-DOM model (the Read mode emits fresh innerHTML on every
// doc change). Mark-wrap survives a renderer refresh by being part
// of the rendered DOM — though we still clear on doc change to
// avoid stale highlights, the cost is the same as a fresh walk.

import type { FindAdapter, SearchStats } from './types'

const HIGHLIGHT_CLASS = 'nicermd-find'
const CURRENT_CLASS = 'nicermd-find--current'

function clearMarks(root: Element): void {
  // querySelectorAll returns a static NodeList — safe to iterate while
  // we mutate. For each mark, splice its children up into the parent
  // and drop the mark element itself. Normalise the parent so split
  // text nodes coalesce back into one — important so a subsequent
  // setQuery() doesn't see fragmented neighbours that look like
  // distinct text nodes.
  const marks = root.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`)
  const parents = new Set<Node>()
  for (const mark of marks) {
    const parent = mark.parentNode
    if (!parent) continue
    parents.add(parent)
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  }
  for (const p of parents) {
    if (p instanceof Element) p.normalize()
  }
}

function shouldSkipParent(el: Element | null): boolean {
  if (!el) return true
  const tag = el.tagName
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return true
  // Don't re-wrap our own marks if a stale one slipped through.
  if (el.classList.contains(HIGHLIGHT_CLASS)) return true
  return false
}

function collectTextNodes(root: Element): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const t = node as Text
      if (!t.data) return NodeFilter.FILTER_REJECT
      if (shouldSkipParent(t.parentElement)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const out: Text[] = []
  let n = walker.nextNode()
  while (n) {
    out.push(n as Text)
    n = walker.nextNode()
  }
  return out
}

function wrapMatchesInTextNode(textNode: Text, needle: string): HTMLElement[] {
  const text = textNode.data
  const haystack = text.toLowerCase()
  const lcNeedle = needle.toLowerCase()
  if (!lcNeedle) return []
  const parent = textNode.parentNode
  if (!parent) return []

  const out: HTMLElement[] = []
  const replacements: Node[] = []
  let cursor = 0
  let idx = haystack.indexOf(lcNeedle, cursor)
  while (idx !== -1) {
    if (idx > cursor) {
      replacements.push(document.createTextNode(text.slice(cursor, idx)))
    }
    const mark = document.createElement('mark')
    mark.className = HIGHLIGHT_CLASS
    mark.textContent = text.slice(idx, idx + lcNeedle.length)
    replacements.push(mark)
    out.push(mark)
    cursor = idx + lcNeedle.length
    idx = haystack.indexOf(lcNeedle, cursor)
  }
  if (out.length === 0) return []
  if (cursor < text.length) {
    replacements.push(document.createTextNode(text.slice(cursor)))
  }
  for (const node of replacements) parent.insertBefore(node, textNode)
  parent.removeChild(textNode)
  return out
}

function applyCurrent(marks: HTMLElement[], idx: number): void {
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]!
    if (i === idx) m.classList.add(CURRENT_CLASS)
    else m.classList.remove(CURRENT_CLASS)
  }
  if (idx >= 0 && idx < marks.length) {
    marks[idx]!.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

export function createDomFindAdapter(root: Element): FindAdapter {
  let marks: HTMLElement[] = []
  let currentIdx = -1
  let lastQuery = ''

  function rebuild(query: string): SearchStats {
    clearMarks(root)
    marks = []
    currentIdx = -1
    lastQuery = query
    if (!query) return { matchCount: 0, current: 0 }
    const textNodes = collectTextNodes(root)
    for (const tn of textNodes) {
      const found = wrapMatchesInTextNode(tn, query)
      marks.push(...found)
    }
    if (marks.length > 0) {
      currentIdx = 0
      applyCurrent(marks, currentIdx)
    }
    return { matchCount: marks.length, current: currentIdx + 1 }
  }

  function stats(): SearchStats {
    return {
      matchCount: marks.length,
      current: currentIdx >= 0 ? currentIdx + 1 : 0,
    }
  }

  return {
    setQuery(query) {
      // Skip a full rebuild if the query hasn't changed — the user
      // typing the same value twice (or the bar re-confirming on
      // focus) shouldn't blow away current-match state.
      if (query === lastQuery) return stats()
      return rebuild(query)
    },
    next() {
      if (marks.length === 0) return stats()
      currentIdx = (currentIdx + 1) % marks.length
      applyCurrent(marks, currentIdx)
      return stats()
    },
    prev() {
      if (marks.length === 0) return stats()
      currentIdx = (currentIdx - 1 + marks.length) % marks.length
      applyCurrent(marks, currentIdx)
      return stats()
    },
    close() {
      clearMarks(root)
      marks = []
      currentIdx = -1
      lastQuery = ''
    },
  }
}
