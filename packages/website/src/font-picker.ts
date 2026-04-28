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
  type Font,
} from './fonts'

let isOpen = false

interface Section {
  label: string
  fonts: readonly Font[]
  apply: (id: string, persist?: boolean) => Font
}

export function openFontPicker(): void {
  if (isOpen) return
  isOpen = true

  loadCatalogue()

  const originalProse = getActiveProseFont().id
  const originalCode = getActiveCodeFont().id

  const sections: Section[] = [
    { label: 'Prose font', fonts: PROSE_FONTS, apply: applyProseFont },
    { label: 'Code font', fonts: CODE_FONTS, apply: applyCodeFont },
  ]

  // Each section tracks its OWN selected index (the persistent
  // "what would commit" state). focusedSection / focusedIndex
  // tracks the keyboard-roving cursor — at most one card across the
  // whole modal. Both states are visualised independently in CSS.
  const sectionState: { selectedIdx: number }[] = [
    { selectedIdx: Math.max(0, PROSE_FONTS.findIndex((f) => f.id === originalProse)) },
    { selectedIdx: Math.max(0, CODE_FONTS.findIndex((f) => f.id === originalCode)) },
  ]
  let focusedSection = 0
  let focusedIndex = sectionState[0].selectedIdx

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
    currentName.textContent = section.fonts[sectionState[sIdx].selectedIdx]!.name
    labelRow.append(label, currentName)
    wrap.appendChild(labelRow)

    const grid = document.createElement('div')
    grid.className = 'font-picker__grid'
    const cards = section.fonts.map((font, idx) => {
      const card = document.createElement('div')
      card.className = 'font-card'
      card.tabIndex = 0
      card.setAttribute('role', 'button')
      card.setAttribute('aria-label', `${section.label}: ${font.name}`)

      const sample = document.createElement('div')
      sample.className = 'font-card__sample'
      sample.style.fontFamily = font.family
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
      name.textContent = font.name
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
      const sel = sectionState[sI].selectedIdx
      sec.nameEl.textContent = sections[sI].fonts[sel]!.name
      sec.cards.forEach((card, cI) => {
        card.classList.toggle('font-card--selected', cI === sel)
        card.classList.toggle(
          'font-card--focused',
          sI === focusedSection && cI === focusedIndex,
        )
      })
    })
  }

  // Re-apply fonts to the document. The focused section previews the
  // hovered/arrow-targeted card; the non-focused section shows its
  // committed selection. So moving focus across sections doesn't flap
  // the un-focused section's preview.
  function applyFonts(): void {
    sections.forEach((section, sI) => {
      const idx = sI === focusedSection ? focusedIndex : sectionState[sI].selectedIdx
      section.apply(section.fonts[idx]!.id, false)
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
    sectionState[sIdx].selectedIdx = fIdx
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
    sectionState[focusedSection].selectedIdx = focusedIndex
    sections.forEach((section, sI) => {
      const sel = sectionState[sI].selectedIdx
      section.apply(section.fonts[sel]!.id, true)
    })
    close()
  }

  function cancel(): void {
    applyProseFont(originalProse, false)
    applyCodeFont(originalCode, false)
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
    const section = sections[focusedSection]
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focus(focusedSection, (focusedIndex + 1) % section.fonts.length)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focus(
        focusedSection,
        (focusedIndex - 1 + section.fonts.length) % section.fonts.length,
      )
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = focusedIndex + COLS
      if (next < section.fonts.length) {
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
        const upSection = sections[focusedSection - 1]
        focus(focusedSection - 1, upSection.fonts.length - 1)
      }
    }
  }

  closeBtn.addEventListener('click', cancel)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) cancel()
  })
  window.addEventListener('keydown', onKeydown, true)
}
