// Link chaining inside the reader.
//
// A click on a rendered <a href> that points at a markdown URL the
// loader already accepts (raw / blob+.md / tree / bare-repo / gist)
// stays inside Nicer.md instead of navigating away. Modifier-key
// clicks (Cmd / Ctrl / Shift) open the chained doc in a new Nicer.md
// tab; plain clicks chain in the current tab. Alt+click and right /
// middle clicks defer to the browser default.
//
// History model:
//
//   - Plain click       → pushState({chainKind: 'chain', url}, '?url=X')
//                         and call loadFromUrl directly (no gate). Back
//                         restores the prior doc.
//   - Modifier click    → window.open('?url=X', '_blank'). The new tab
//                         boots with window.opener pointing back at us;
//                         processBootUrlParam treats a same-origin
//                         opener as the trust signal and skips the
//                         gate. Refresh in the new tab keeps working
//                         because the boot handler upgrades the entry
//                         to history.state.chainKind === 'chain' on
//                         first load.
//
// Safety: the `?url=` phishing gate only fires for "external arrivals"
// (no trusted opener, no chain-state in history). External share
// links from third-party sites still see the gate — they have a
// different-origin opener or no opener at all.

import { parseGithubUrl, loadFromUrl } from './url-open'
import { confirmDiscard, isDirty } from './doc-source'
import { openUrlInNewWindow } from './tauri-bridge'
import type { Harness } from './main'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// Mode 1 (Read) and Mode 3 (Split preview) render via `nicermd-core`
// into innerHTML. Those are the only surfaces where chaining makes
// sense — Tiptap (Mode 2) handles links itself, Code (Mode 4) shows
// raw markdown without rendered links.
const RENDER_CONTAINERS = '.mode-read, .mode-split__preview'

export interface ChainState {
  chainKind: 'boot' | 'chain'
  url?: string
}

export function setupLinkChaining(harness: Harness, host: HTMLElement): void {
  // Snapshot the boot doc so Back from a chain restores what was
  // showing on first load — avoids re-running the whole boot path
  // (autosave-recovery banner, theme-picker first-launch flow, etc.).
  const bootDoc = harness.getMarkdown()

  // Mark the boot history entry so popstate can tell "we're back to
  // landing" apart from "we're at another chained URL". The boot
  // handler may have already replaced state to strip a `?url=` param,
  // leaving state = {}; either way, our marker is what popstate reads.
  const initialState = window.history.state as ChainState | null
  if (!initialState || initialState.chainKind !== 'chain') {
    window.history.replaceState({ chainKind: 'boot' } satisfies ChainState, '', window.location.href)
  }

  host.addEventListener('click', (e) => {
    // Right / middle clicks: different event paths; defer.
    if (e.button !== 0) return

    if (!(e.target instanceof Element)) return
    const anchor = e.target.closest('a')
    if (!anchor) return

    // Only chain links that live inside a render surface we own.
    if (!anchor.closest(RENDER_CONTAINERS)) return

    const href = anchor.getAttribute('href')
    if (!href) return

    // In-doc anchors stay default (browser scrolls to the heading).
    if (href.startsWith('#')) return

    // Alt+click = "save link as" in browsers; defer so the user can
    // still download a markdown file if they want the raw bytes.
    if (e.altKey) return

    // Eligibility = exactly the URL shapes the loader accepts.
    // - `not-github`: leave the default browser nav alone (the link
    //   simply isn't ours to handle).
    // - `unsupported-file`: the link IS a GitHub URL we'd otherwise
    //   chain, but its file type (e.g. Makefile, .rb, .go) isn't
    //   supported yet. Suppress the navigation and surface a discreet
    //   banner so the user knows why we didn't render it inline.
    const parseResult = parseGithubUrl(href)
    if (!parseResult.ok) {
      if (parseResult.reasonCode === 'unsupported-file') {
        e.preventDefault()
        const basename = new URL(href, window.location.href).pathname.split('/').pop() || href
        showNoticeBanner(`${basename} isn't a supported file type yet`)
      }
      return
    }

    e.preventDefault()

    // Build the `?url=<encoded>` form of the chained address. Same shape
    // as the share-link URL — copy-paste round-trips identically.
    const dest = new URL(window.location.href)
    dest.search = ''
    dest.searchParams.set('url', href)
    dest.hash = ''
    const destStr = dest.toString()

    // Modifier keys (Cmd, Ctrl, Shift) → open in a new Nicer.md
    // surface. Two runtimes, two surfaces:
    //   - Web: window.open('?url=…', '_blank') opens a new tab. We
    //     intentionally DON'T pass 'noopener' so the new tab's
    //     window.opener points back at us; processBootUrlParam there
    //     treats that as the trust signal to skip the phishing gate.
    //     Both tabs are same-origin so the cross-tab reference is safe.
    //   - Tauri: window.open is a no-op (WKWebView can't spawn a
    //     browser tab from inside the app), so route through the
    //     openUrlInNewWindow helper that uses the same Rust command
    //     File → Duplicate Window and the right-click context menu
    //     use. Loads directly via loadFromUrl in the new window — the
    //     click happened inside a trusted in-app doc, no gate needed.
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      if (isTauri()) {
        void openUrlInNewWindow(href)
      } else {
        window.open(destStr, '_blank')
      }
      return
    }

    // Plain click → same-tab chain. Dirty-edit guard if there are
    // unsaved changes in Write / Split / Code — same prompt as
    // File → New uses.
    void chainSameTab(harness, href, destStr)
  })

  window.addEventListener('popstate', (e) => {
    const state = e.state as ChainState | null

    if (state?.chainKind === 'chain' && state.url) {
      void loadFromUrl(harness, state.url).catch((err) => {
        showChainError(err, state.url ?? '(unknown)')
      })
      return
    }

    // Boot entry — restore the snapshotted doc rather than re-running
    // init. Keeps autosave-recovery / theme-picker first-launch flows
    // from re-triggering on every Back.
    if (state?.chainKind === 'boot') {
      harness.replaceDoc(bootDoc)
    }
  })
}

async function chainSameTab(harness: Harness, href: string, destStr: string): Promise<void> {
  if (isDirty()) {
    const confirmed = await confirmDiscard()
    if (!confirmed) return
  }

  window.history.pushState(
    { chainKind: 'chain', url: href } satisfies ChainState,
    '',
    destStr,
  )

  try {
    await loadFromUrl(harness, href)
  } catch (err) {
    // History entry already landed; user can hit Back. Surface the
    // failure so it isn't silent in DevTools-only.
    showChainError(err, href)
  }
}

// --- Failure banner ------------------------------------------------------
// Surface chain-load failures as a dismissible banner (matching the
// recovery-banner pattern). Auto-removes after 8s; clicking Dismiss
// removes immediately. Only one banner visible at a time — a second
// failure replaces the first.

let activeBanner: HTMLElement | null = null

function showChainError(err: unknown, attemptedUrl: string): void {
  const message = err instanceof Error ? err.message : String(err)
  console.error('[link-chain] load failed:', attemptedUrl, err)
  showNoticeBanner(`Couldn't load: ${message}`)
}

// Discreet, dismissible banner used for chain-load failures AND for
// surfacing parser rejections like "Makefile isn't a supported file
// type yet" (per the surface-limits-discreetly feedback rule). One
// banner visible at a time — a second message replaces the first.
// Auto-dismisses after 8s; clicking Dismiss / pressing Esc or Return
// removes immediately (keyboard parity for the "I see it, move on"
// dismissal — no need to mouse to the button).
export function showNoticeBanner(message: string): void {
  if (activeBanner) {
    activeBanner.remove()
    activeBanner = null
  }

  const banner = document.createElement('div')
  banner.className = 'chain-error-banner'
  banner.setAttribute('role', 'status')

  const text = document.createElement('span')
  text.className = 'chain-error-banner__text'
  text.textContent = message

  const dismissBtn = document.createElement('button')
  dismissBtn.type = 'button'
  dismissBtn.className = 'chain-error-banner__btn'
  dismissBtn.textContent = 'Dismiss'

  let onKey: ((ev: KeyboardEvent) => void) | null = null
  const dismiss = (): void => {
    if (activeBanner === banner) activeBanner = null
    if (onKey) {
      window.removeEventListener('keydown', onKey, true)
      onKey = null
    }
    banner.remove()
  }
  dismissBtn.addEventListener('click', dismiss)

  // Keyboard dismissal — capture-phase listener so an open command
  // palette or modal doesn't swallow the key before us. We only
  // intercept Esc/Return that haven't already been consumed by an
  // input/textarea/contenteditable (so typing 'Return' in the URL
  // prompt while a banner is visible doesn't kill the prompt's submit).
  onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape' && ev.key !== 'Enter') return
    const target = ev.target as HTMLElement | null
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      return
    }
    ev.preventDefault()
    ev.stopPropagation()
    dismiss()
  }
  window.addEventListener('keydown', onKey, true)

  banner.append(text, dismissBtn)
  document.body.appendChild(banner)
  activeBanner = banner

  window.setTimeout(dismiss, 8000)
}
