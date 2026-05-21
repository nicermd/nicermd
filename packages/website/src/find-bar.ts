// Floating find bar (Cmd+F).
//
// One bar drives every mode via a `FindAdapter` the caller supplies.
// The bar's job is purely UI: input + match-count badge + prev/next
// /close. All highlighting and navigation logic lives in the adapter.
//
// Lifecycle:
//   - openFindBar(adapter) — mounts (or re-uses) the bar, calls
//     adapter.setQuery('') to clear any prior state, focuses the
//     input. Replaces a previously-open adapter cleanly via its
//     close().
//   - closeFindBar() — calls the active adapter's close() and tears
//     down the DOM. Idempotent.
//
// Keyboard: Escape closes, Enter advances to next match, Shift+Enter
// to previous. Cmd+F while already open re-focuses + selects the
// input (mirrors browser native find-bar reopen).

import type { FindAdapter, SearchStats } from './find/types'

let barEl: HTMLDivElement | null = null
let inputEl: HTMLInputElement | null = null
let countEl: HTMLSpanElement | null = null
let activeAdapter: FindAdapter | null = null
let onKeyDown: ((e: KeyboardEvent) => void) | null = null

export function isFindBarOpen(): boolean {
  return barEl !== null
}

export function openFindBar(adapter: FindAdapter): void {
  // Re-open with a different adapter (mode switch while bar was open):
  // dispose the previous adapter so its highlights vanish before the
  // new adapter starts mounting its own.
  if (activeAdapter && activeAdapter !== adapter) {
    activeAdapter.close()
  }
  activeAdapter = adapter

  if (!barEl) {
    mountBar()
  }
  // Re-focus + select existing content so a second Cmd+F while open
  // mimics the browser's native behaviour (cursor in the input ready
  // to retype). If there's existing text, refresh the search against
  // the new adapter so the count updates immediately.
  inputEl?.focus()
  inputEl?.select()
  if (inputEl && inputEl.value) {
    const s = adapter.setQuery(inputEl.value)
    updateCount(s)
  } else {
    updateCount({ matchCount: 0, current: 0 })
  }
}

export function closeFindBar(): void {
  if (activeAdapter) {
    activeAdapter.close()
    activeAdapter = null
  }
  if (onKeyDown) {
    document.removeEventListener('keydown', onKeyDown, true)
    onKeyDown = null
  }
  if (barEl) {
    barEl.remove()
    barEl = null
    inputEl = null
    countEl = null
  }
}

function updateCount(stats: SearchStats): void {
  if (!countEl) return
  // "0 of 0" reads as 'no matches'; "3 of 12" reads as 'this is the
  // third match out of twelve'. The dim look (CSS) for zero-state
  // gives the user a passive cue that nothing's found without an
  // alarming error colour.
  countEl.textContent = `${stats.current} of ${stats.matchCount}`
  countEl.classList.toggle('find-bar__count--empty', stats.matchCount === 0)
}

function mountBar(): void {
  const bar = document.createElement('div')
  bar.className = 'find-bar'
  bar.setAttribute('role', 'search')
  // Stop clicks inside the bar from propagating to the body so the
  // outside-click dismiss logic (if any feature ever adds it) stays
  // simple. Cheap defence; doesn't hurt today.
  bar.addEventListener('mousedown', (e) => {
    e.stopPropagation()
  })

  const input = document.createElement('input')
  input.type = 'search'
  input.className = 'find-bar__input'
  input.placeholder = 'Find'
  input.setAttribute('aria-label', 'Find in document')
  // Disable autofill / browser quirks — this is an in-app find input,
  // not a form field. autocomplete=off + spellcheck=false keeps the
  // experience consistent across runtimes.
  input.autocomplete = 'off'
  input.spellcheck = false
  input.addEventListener('input', () => {
    if (!activeAdapter) return
    const s = activeAdapter.setQuery(input.value)
    updateCount(s)
  })

  const count = document.createElement('span')
  count.className = 'find-bar__count find-bar__count--empty'
  count.textContent = '0 of 0'
  count.setAttribute('aria-live', 'polite')

  const prev = mkButton('Previous match', '‹', () => {
    if (!activeAdapter) return
    updateCount(activeAdapter.prev())
  })
  const next = mkButton('Next match', '›', () => {
    if (!activeAdapter) return
    updateCount(activeAdapter.next())
  })
  const close = mkButton('Close', '×', () => {
    closeFindBar()
  })
  close.classList.add('find-bar__btn--close')

  bar.append(input, count, prev, next, close)
  document.body.appendChild(bar)

  barEl = bar
  inputEl = input
  countEl = count

  // Capture-phase Escape / Enter on the document so the bar wins over
  // mode-level handlers (CodeMirror, Tiptap) that would otherwise
  // swallow Enter as a content edit. We only intercept when the bar's
  // input has focus to avoid hijacking keys elsewhere.
  onKeyDown = (e: KeyboardEvent): void => {
    if (e.target !== inputEl) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeFindBar()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (!activeAdapter) return
      const stats = e.shiftKey ? activeAdapter.prev() : activeAdapter.next()
      updateCount(stats)
    }
  }
  document.addEventListener('keydown', onKeyDown, true)
}

function mkButton(label: string, glyph: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'find-bar__btn'
  btn.setAttribute('aria-label', label)
  btn.title = label
  btn.textContent = glyph
  btn.addEventListener('click', () => {
    onClick()
    inputEl?.focus()
  })
  return btn
}
