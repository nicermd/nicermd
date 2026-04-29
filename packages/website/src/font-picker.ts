// Font picker modal. Two grids — prose font and code font. Each
// section keeps its OWN current selection (the card with the accent
// outline = "this would commit if you press Enter"). A separate
// keyboard-focus highlight floats across the modal showing where
// arrow keys are pointing right now.
//
// Hover or focus a card → live preview applies that font for that
// section only; the other section's selection is untouched. Click a
// card to select it for that section without closing; Enter commits
// both sections' selections + persists; Esc reverts both.
//
// Loads the entire Google Fonts catalogue on first open so live
// preview is instant; the active selection's <link> stays minimal so
// boot-time bandwidth is unchanged for users who never open this.

import {
  PROSE_FONTS,
  CODE_FONTS,
  applyProseFont,
  applyCodeFont,
  getActiveProseFont,
  getActiveCodeFont,
  loadCatalogue,
  resolveProseThemeDefault,
  resolveCodeThemeDefault,
  THEME_DEFAULT_ID,
  type Font,
} from './fonts'

let isOpen = false

interface CardEntry {
  id: string // 'theme-default' or a font id
  name: string
  family: string
  isThemeDefault: boolean
}

interface Section {
  label: string
  entries: CardEntry[]
  apply: (id: string, persist?: boolean) => Font
}

// Build cards in catalogue order so positions are stable across
// themes — the only thing that moves between themes is which card
// carries the "(theme default)" tag. Selecting a tagged card opts
// the user into theme-default mode (clears localStorage so future
// theme switches re-engage their font pairings); selecting any
// other card sets it as an explicit pick and theme switches no
// longer touch the font.
function buildEntries(
  fonts: readonly Font[],
  resolvedDefault: Font,
): CardEntry[] {
  return fonts.map((f) => {
    const isThemeDefault = f.id === resolvedDefault.id
    return {
      id: f.id,
      name: isThemeDefault ? `${f.name} (theme default)` : f.name,
      family: f.family,
      isThemeDefault,
    }
  })
}

// Where the picker should land when opened. If the user is on
// theme-default mode (no localStorage entry), focus the card that
// carries the (theme default) tag — the same card whose font is
// currently rendering. Otherwise focus their explicit choice.
function initialSelectedIndex(
  entries: CardEntry[],
  storedId: string | null,
): number {
  if (storedId === null) {
    return Math.max(0, entries.findIndex((e) => e.isThemeDefault))
  }
  const idx = entries.findIndex((e) => e.id === storedId)
  return idx < 0 ? 0 : idx
}

export function openFontPicker(): void {
  if (isOpen) return
  isOpen = true

  loadCatalogue()

  const originalProse = getActiveProseFont().id
  const originalCode = getActiveCodeFont().id

  // Capture the explicit user-saved IDs at open time so cancel can
  // restore them (rather than the resolved defaults which look the
  // same to the user but differ in localStorage state).
  const originalProseStored = localStorage.getItem('nicermd:font-prose')
  const originalCodeStored = localStorage.getItem('nicermd:font-code')

  const proseEntries = buildEntries(PROSE_FONTS, resolveProseThemeDefault())
  const codeEntries = buildEntries(CODE_FONTS, resolveCodeThemeDefault())

  const sections: Section[] = [
    { label: 'Prose font', entries: proseEntries, apply: applyProseFont },
    { label: 'Code font', entries: codeEntries, apply: applyCodeFont },
  ]

  // Each section tracks its OWN selected index (the persistent
  // "what would commit" state). focusedSection / focusedIndex
  // tracks the keyboard-roving cursor — at most one card across the
  // whole modal. Both states are visualised independently in CSS.
  const proseInitial = initialSelectedIndex(proseEntries, originalProseStored)
  const codeInitial = initialSelectedIndex(codeEntries, originalCodeStored)
  const sectionState: { selectedIdx: number }[] = [
    { selectedIdx: proseInitial },
    { selectedIdx: codeInitial },
  ]
  let focusedSection = 0
  let focusedIndex = sectionState[0]!.selectedIdx

  const backdrop = document.createElement('div')
  backdrop.className = 'font-picker-backdrop'

  const modal = document.createElement('div')
  modal.className = 'font-picker'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-label', 'Choose fonts')

  const header = document.createElement('div')
  header.className = 'font-picker__header'
  const title = document.createElement('h2')
  title.className = 'font-picker__title'
  title.textContent = 'Choose fonts'
  const hint = document.createElement('span')
  hint.className = 'font-picker__hint'
  hint.textContent = 'Hover to preview · click to choose · Enter commits · Esc reverts'
  const closeBtn = document.createElement('button')
  closeBtn.className = 'font-picker__close'
  closeBtn.type = 'button'
  closeBtn.setAttribute('aria-label', 'Close picker')
  closeBtn.textContent = '×'
  header.append(title, hint, closeBtn)
  modal.appendChild(header)

  const sectionEls: { card: HTMLElement; cards: HTMLElement[]; nameEl: HTMLElement }[] = []

  sections.forEach((section, sIdx) => {
    const wrap = document.createElement('div')
    wrap.className = 'font-picker__section'

    const labelRow = document.createElement('div')
    labelRow.className = 'font-picker__section-label-row'
    const label = document.createElement('div')
    label.className = 'font-picker__section-label'
    label.textContent = section.label
    const currentName = document.createElement('div')
    currentName.className = 'font-picker__section-current'
    currentName.textContent = section.entries[sectionState[sIdx]!.selectedIdx]!.name
    labelRow.append(label, currentName)
    wrap.appendChild(labelRow)

    const grid = document.createElement('div')
    grid.className = 'font-picker__grid'
    const cards = section.entries.map((entry, idx) => {
      const card = document.createElement('div')
      card.className = 'font-card'
      if (entry.isThemeDefault) card.classList.add('font-card--theme-default')
      card.tabIndex = 0
      card.setAttribute('role', 'button')
      card.setAttribute('aria-label', `${section.label}: ${entry.name}`)

      const sample = document.createElement('div')
      sample.className = 'font-card__sample'
      sample.style.fontFamily = entry.family
      if (section.label === 'Prose font') {
        const heading = document.createElement('div')
        heading.className = 'font-card__sample-heading'
        heading.textContent = 'Heading'
        const body = document.createElement('div')
        body.className = 'font-card__sample-body'
        body.textContent = 'Body — the quick brown fox.'
        sample.append(heading, body)
      } else {
        const line1 = document.createElement('div')
        line1.textContent = 'function render(md) {'
        const line2 = document.createElement('div')
        line2.textContent = '  return parse(md)'
        sample.append(line1, line2)
      }
      card.appendChild(sample)

      const name = document.createElement('div')
      name.className = 'font-card__name'
      name.textContent = entry.name
      card.appendChild(name)

      // Hover / arrow only previews — does not change the section's
      // committed selection. Click locks the card in for that section.
      card.addEventListener('mouseenter', () => focus(sIdx, idx))
      card.addEventListener('click', () => select(sIdx, idx))

      grid.appendChild(card)
      return card
    })
    wrap.appendChild(grid)

    modal.appendChild(wrap)
    sectionEls.push({ card: wrap, cards, nameEl: currentName })
  })

  backdrop.appendChild(modal)
  document.body.appendChild(backdrop)

  function applyVisuals(): void {
    sectionEls.forEach((sec, sI) => {
      const sel = sectionState[sI]!.selectedIdx
      sec.nameEl.textContent = sections[sI]!.entries[sel]!.name
      sec.cards.forEach((card, cI) => {
        card.classList.toggle('font-card--selected', cI === sel)
        card.classList.toggle(
          'font-card--focused',
          sI === focusedSection && cI === focusedIndex,
        )
      })
    })
  }

  // Resolve a card to the id we should pass to applyProseFont /
  // applyCodeFont. For the theme-default-flagged card, that's the
  // THEME_DEFAULT_ID sentinel — picking it opts into theme-default
  // mode so subsequent theme switches keep adjusting the font. For
  // any other card, it's the entry's literal font id (explicit pick).
  function applyIdFor(entry: CardEntry): string {
    return entry.isThemeDefault ? THEME_DEFAULT_ID : entry.id
  }

  // Re-apply fonts to the document. The focused section previews the
  // hovered/arrow-targeted card; the non-focused section shows its
  // committed selection. So moving focus across sections doesn't flap
  // the un-focused section's preview.
  function applyFonts(): void {
    sections.forEach((section, sI) => {
      const idx = sI === focusedSection ? focusedIndex : sectionState[sI]!.selectedIdx
      const entry = section.entries[idx]!
      section.apply(applyIdFor(entry), false)
    })
  }

  // Move the keyboard / mouse focus to (sIdx, fIdx). Previews that
  // card's font in its section but does NOT change selectedIdx.
  function focus(sIdx: number, fIdx: number): void {
    focusedSection = sIdx
    focusedIndex = fIdx
    applyFonts()
    applyVisuals()
  }

  // Click handler — locks in this card as the section's selection.
  function select(sIdx: number, fIdx: number): void {
    focusedSection = sIdx
    focusedIndex = fIdx
    sectionState[sIdx]!.selectedIdx = fIdx
    applyFonts()
    applyVisuals()
  }

  applyFonts()
  applyVisuals()

  function commit(): void {
    // Fold the keyboard-focused card into its section's selection
    // before committing — so Enter on a hovered/arrow-targeted card
    // commits THAT card, matching the standard "highlight + Enter"
    // pattern from menus and pickers.
    sectionState[focusedSection]!.selectedIdx = focusedIndex
    sections.forEach((section, sI) => {
      const entry = section.entries[sectionState[sI]!.selectedIdx]!
      section.apply(applyIdFor(entry), true)
    })
    close()
  }

  function cancel(): void {
    // Restore each axis to whatever was *stored* (not just resolved)
    // when the picker opened — so cancelling out of "I tried theme
    // default" puts the explicit pick back in localStorage, and
    // cancelling out of "I tried Inter" with no prior pick clears it.
    if (originalProseStored === null) {
      applyProseFont(THEME_DEFAULT_ID, true)
    } else {
      applyProseFont(originalProse, true)
    }
    if (originalCodeStored === null) {
      applyCodeFont(THEME_DEFAULT_ID, true)
    } else {
      applyCodeFont(originalCode, true)
    }
    close()
  }

  function close(): void {
    if (!isOpen) return
    isOpen = false
    window.removeEventListener('keydown', onKeydown, true)
    backdrop.remove()
  }

  const COLS = 4
  const onKeydown = (e: KeyboardEvent): void => {
    if (!isOpen) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancel()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      return
    }
    const section = sections[focusedSection]!
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focus(focusedSection, (focusedIndex + 1) % section.entries.length)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focus(
        focusedSection,
        (focusedIndex - 1 + section.entries.length) % section.entries.length,
      )
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = focusedIndex + COLS
      if (next < section.entries.length) {
        focus(focusedSection, next)
      } else if (focusedSection + 1 < sections.length) {
        focus(focusedSection + 1, 0)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = focusedIndex - COLS
      if (prev >= 0) {
        focus(focusedSection, prev)
      } else if (focusedSection > 0) {
        const upSection = sections[focusedSection - 1]!
        focus(focusedSection - 1, upSection.entries.length - 1)
      }
    }
  }

  closeBtn.addEventListener('click', cancel)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) cancel()
  })
  window.addEventListener('keydown', onKeydown, true)
}
