// Theme picker modal. Opens centred over the app, dims the backdrop,
// shows a grid of theme cards with live mini-previews, plus a "Coming
// soon" row of placeholder themes and a (scaffold-only for spike) Custom
// theme URL input.
//
// Live preview: arrow keys move selection AND apply the highlighted
// theme to the whole app immediately. Enter / click commits and persists.
// Esc cancels and reverts to whatever was active when the picker opened.
//
// Each card sets `data-theme` on itself so the theme's CSS variables
// cascade ONLY to that card's content — same vars file, no duplication.
// Selected indicator is a fixed-colour outline so it reads regardless of
// which theme is currently being previewed.

import { THEMES, applyTheme, getActiveTheme, type Theme, type ThemeMode } from './themes'

interface PlaceholderTheme {
  slug: string
  name: string
  mode: ThemeMode
}

const PLACEHOLDERS: PlaceholderTheme[] = [
  { slug: 'solarized-light', name: 'Solarized Light', mode: 'light' },
  { slug: 'solarized-dark', name: 'Solarized Dark', mode: 'dark' },
  { slug: 'slate', name: 'Slate', mode: 'dark' },
]

const GRID_COLS = 3

let isOpen = false

export function openThemePicker(): void {
  if (isOpen) return
  isOpen = true

  const original = getActiveTheme()
  let selectedIdx = Math.max(
    0,
    THEMES.findIndex((t) => t.slug === original.slug),
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

  // Real-themes grid
  const grid = document.createElement('div')
  grid.className = 'theme-picker__grid'
  const cards: HTMLElement[] = THEMES.map((theme, idx) => {
    const card = createThemeCard(theme, idx === selectedIdx)
    card.addEventListener('click', () => {
      commit(theme)
    })
    card.addEventListener('mouseenter', () => {
      selectIndex(idx)
    })
    grid.appendChild(card)
    return card
  })

  // Placeholder section
  const placeholderTitle = document.createElement('h3')
  placeholderTitle.className = 'theme-picker__subtitle'
  placeholderTitle.textContent = 'Coming soon'
  const placeholderGrid = document.createElement('div')
  placeholderGrid.className = 'theme-picker__grid'
  PLACEHOLDERS.forEach((p) => placeholderGrid.appendChild(createPlaceholderCard(p)))

  // Custom URL row (scaffold-only)
  const custom = document.createElement('div')
  custom.className = 'theme-picker__custom'
  const customLabel = document.createElement('label')
  customLabel.className = 'theme-picker__custom-label'
  customLabel.textContent = 'Custom theme URL'
  const customRow = document.createElement('div')
  customRow.className = 'theme-picker__custom-row'
  const customInput = document.createElement('input')
  customInput.type = 'url'
  customInput.placeholder = 'https://gist.github.com/.../theme.json'
  customInput.className = 'theme-picker__custom-input'
  const customApply = document.createElement('button')
  customApply.type = 'button'
  customApply.textContent = 'Apply'
  customApply.className = 'theme-picker__custom-apply'
  customApply.addEventListener('click', () => {
    console.log('[theme-picker] custom URL (scaffold; fetch deferred):', customInput.value)
  })
  customRow.append(customInput, customApply)
  custom.append(customLabel, customRow)

  modal.append(header, grid, placeholderTitle, placeholderGrid, custom)
  backdrop.appendChild(modal)
  document.body.appendChild(backdrop)

  function selectIndex(next: number): void {
    let idx = next
    if (idx < 0) idx = THEMES.length - 1
    if (idx >= THEMES.length) idx = 0
    selectedIdx = idx
    cards.forEach((card, i) => card.classList.toggle('theme-card--selected', i === idx))
    // Live preview: apply but don't persist yet — Esc reverts.
    applyTheme(THEMES[idx]!.slug, false)
  }

  function commit(theme: Theme): void {
    applyTheme(theme.slug, true)
    close()
  }

  function cancel(): void {
    applyTheme(original.slug, false)
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
      cancel()
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

  closeBtn.addEventListener('click', cancel)
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) cancel()
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
  const badge = document.createElement('span')
  badge.className = 'theme-card__badge theme-card__badge--' + theme.mode
  badge.textContent = theme.mode
  footer.append(name, badge)

  card.append(preview, footer)
  return card
}

function createPlaceholderCard(p: PlaceholderTheme): HTMLElement {
  const card = document.createElement('div')
  card.className = 'theme-card theme-card--placeholder'
  card.tabIndex = -1

  const preview = document.createElement('div')
  preview.className = 'theme-card__preview theme-card__preview--placeholder'
  const text = document.createElement('div')
  text.className = 'theme-card__placeholder-text'
  text.textContent = 'Coming soon'
  preview.appendChild(text)

  const footer = document.createElement('div')
  footer.className = 'theme-card__footer'
  const name = document.createElement('span')
  name.className = 'theme-card__name'
  name.textContent = p.name
  const badge = document.createElement('span')
  badge.className = 'theme-card__badge theme-card__badge--' + p.mode
  badge.textContent = p.mode
  footer.append(name, badge)

  card.append(preview, footer)
  return card
}
