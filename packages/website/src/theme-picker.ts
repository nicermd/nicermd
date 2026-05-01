// Theme picker modal. Opens centred over the app, dims the backdrop,
// and shows a grid of theme cards with mini-previews.
//
// Selection is decoupled from application: arrow keys move the
// highlighted card visually but the live page theme stays fixed
// until commit. Click a card or press Enter on the selected one to
// commit; Esc / backdrop / × just closes. Avoids the previous
// behaviour where every arrow tap repainted the entire app — the
// flashing across 14+ themes felt like a strobe.
//
// Each card sets `data-theme` on itself so the theme's CSS variables
// cascade ONLY to that card's content — same vars file, no duplication.
// Selected indicator is a fixed-colour outline so it reads regardless
// of which theme is currently active in the page.

import { THEMES, applyTheme, getActiveTheme, type Theme } from './themes'

const GRID_COLS = 4

let isOpen = false

export function openThemePicker(): void {
  if (isOpen) return
  isOpen = true

  let selectedIdx = Math.max(
    0,
    THEMES.findIndex((t) => t.slug === getActiveTheme().slug),
  )

  const backdrop = document.createElement('div')
  backdrop.className = 'theme-picker-backdrop'

  const modal = document.createElement('div')
  modal.className = 'theme-picker'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-label', 'Choose a theme')

  // Header
  const header = document.createElement('div')
  header.className = 'theme-picker__header'
  const title = document.createElement('h2')
  title.className = 'theme-picker__title'
  title.textContent = 'Choose a theme'
  const closeBtn = document.createElement('button')
  closeBtn.className = 'theme-picker__close'
  closeBtn.setAttribute('aria-label', 'Close picker')
  closeBtn.type = 'button'
  closeBtn.textContent = '×'
  header.append(title, closeBtn)

  const grid = document.createElement('div')
  grid.className = 'theme-picker__grid'
  const cards: HTMLElement[] = THEMES.map((theme, idx) => {
    const card = createThemeCard(theme, idx === selectedIdx)
    card.addEventListener('click', () => {
      commit(theme)
    })
    grid.appendChild(card)
    return card
  })

  modal.append(header, grid)
  backdrop.appendChild(modal)
  document.body.appendChild(backdrop)

  function selectIndex(next: number): void {
    let idx = next
    if (idx < 0) idx = THEMES.length - 1
    if (idx >= THEMES.length) idx = 0
    selectedIdx = idx
    cards.forEach((card, i) => card.classList.toggle('theme-card--selected', i === idx))
  }

  function commit(theme: Theme): void {
    applyTheme(theme.slug, true)
    close()
  }

  function close(): void {
    if (!isOpen) return
    isOpen = false
    window.removeEventListener('keydown', keyHandler, true)
    backdrop.remove()
  }

  const keyHandler = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const theme = THEMES[selectedIdx]
      if (theme) commit(theme)
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      selectIndex(selectedIdx + 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      selectIndex(selectedIdx - 1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      selectIndex(selectedIdx + GRID_COLS)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      selectIndex(selectedIdx - GRID_COLS)
    }
  }

  closeBtn.addEventListener('click', close)
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close()
  })
  window.addEventListener('keydown', keyHandler, true)
}

function createThemeCard(theme: Theme, selected: boolean): HTMLElement {
  const card = document.createElement('div')
  card.className = 'theme-card' + (selected ? ' theme-card--selected' : '')
  card.dataset.theme = theme.slug
  card.tabIndex = 0
  card.setAttribute('role', 'button')
  card.setAttribute('aria-label', theme.name)

  const preview = document.createElement('div')
  preview.className = 'theme-card__preview'
  const heading = document.createElement('div')
  heading.className = 'theme-card__sample-heading'
  heading.textContent = '# Heading'
  const body = document.createElement('div')
  body.className = 'theme-card__sample-body'
  const bodyText = document.createTextNode('Body with ')
  const strong = document.createElement('strong')
  strong.textContent = 'bold'
  const linkBefore = document.createTextNode(' and ')
  const link = document.createElement('span')
  link.className = 'theme-card__sample-link'
  link.textContent = 'link'
  const period = document.createTextNode('.')
  body.append(bodyText, strong, linkBefore, link, period)
  const code = document.createElement('div')
  code.className = 'theme-card__sample-code'
  code.textContent = '`code`'
  preview.append(heading, body, code)

  const footer = document.createElement('div')
  footer.className = 'theme-card__footer'
  const name = document.createElement('span')
  name.className = 'theme-card__name'
  name.textContent = theme.name
  footer.append(name)
  if (theme.inspiredBy) {
    const sub = document.createElement('span')
    sub.className = 'theme-card__inspired'
    sub.textContent = `Inspired by ${theme.inspiredBy}`
    sub.title = sub.textContent
    footer.append(sub)
  }

  card.append(preview, footer)
  return card
}

