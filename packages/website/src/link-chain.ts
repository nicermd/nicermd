// Link chaining inside the reader.
//
// When a rendered markdown doc contains an `<a href>` that points at
// another markdown file the URL loader already accepts, an unmodified
// left-click on that link stays inside Nicer.md rather than navigating
// away to raw GitHub. We:
//
//   1. Intercept the click before the browser's default navigation.
//   2. Push a `?url=<encoded-href>` entry into `history` so Back
//      restores the previous doc and the address bar reflects the
//      currently-displayed file (copyable as a share link).
//   3. Call `loadFromUrl` directly — no phishing gate, because the
//      user *chose* this link from a rendered doc whose source they
//      already trust.
//
// Out of scope (deliberately):
//
//   - Anchor links (`#heading`) — defer to default in-doc scroll.
//   - Modifier-key clicks (Cmd/Ctrl/Shift/Alt) — defer to the browser
//     default so Cmd+click still opens in a new tab.
//   - Right-click / middle-click — different event paths; defer.
//   - Non-GitHub URLs — let the browser navigate normally; we have no
//     opinion about external links.
//   - Tiptap editor surface (Write mode) — Tiptap captures clicks for
//     its own link UX; the rendered HTML there isn't ours to chain.
//   - Code mode — there's no rendered link surface, just CodeMirror
//     showing raw markdown.
//
// Chained navigations DON'T strip the `?url=` from the address bar,
// because exposing the source URL is the whole point of "the URL
// makes the current file clear." Refresh behaviour: the boot handler
// (`processBootUrlParam`) reads `history.state.chainKind`, recognises
// this as an internal navigation, and skips the gate that would
// otherwise re-confirm.

import { parseGithubUrl, loadFromUrl } from './url-open'
import type { Harness } from './main'

// Mode 1 (Read) and Mode 3 (Split preview) both render via
// `nicermd-core` into innerHTML. Those are the only surfaces where
// chaining makes sense.
const RENDER_CONTAINERS = '.mode-read, .mode-split__preview'

export interface ChainState {
  chainKind: 'boot' | 'chain'
  url?: string
}

export function setupLinkChaining(harness: Harness, host: HTMLElement): void {
  // Snapshot the boot doc so Back from a chain restores what was
  // showing on first load — without re-running the whole boot path
  // (which would re-trigger autosave-recovery banners, theme picker
  // first-launch flow, etc.).
  const bootDoc = harness.getMarkdown()

  // Mark the boot history entry so popstate can tell "we're back to
  // landing" apart from "we're at another chained URL". If the user
  // arrived via an external `?url=` share-link the boot handler
  // already ran replaceState to strip the param, leaving state = {}.
  // Either way, putting our own marker on the boot entry is safe.
  const initialState = window.history.state as ChainState | null
  if (!initialState || initialState.chainKind !== 'chain') {
    window.history.replaceState({ chainKind: 'boot' } satisfies ChainState, '', window.location.href)
  }

  host.addEventListener('click', (e) => {
    // Modifier-key clicks: defer to browser default (new tab, save
    // link as, etc.). Same for non-primary buttons.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
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

    // Eligibility = exactly the URL shapes the loader accepts. Anything
    // else (external sites, raw non-markdown paths) navigates normally.
    const parseResult = parseGithubUrl(href)
    if (!parseResult.ok) return

    e.preventDefault()

    // Build the `?url=<encoded>` address-bar form. We preserve the
    // raw href as the param so a share-link round-trip resolves
    // identically to the click.
    const dest = new URL(window.location.href)
    dest.search = ''
    dest.searchParams.set('url', href)
    dest.hash = ''

    window.history.pushState(
      { chainKind: 'chain', url: href } satisfies ChainState,
      '',
      dest.toString(),
    )

    void loadFromUrl(harness, href).catch((err) => {
      // The pushState already landed; user can hit Back to undo. We
      // don't roll the history entry back automatically — a failed
      // load is something the user might want to see in the URL bar
      // and retry (refresh would re-attempt without the gate since
      // state.chainKind === 'chain').
      console.error('[link-chain] load failed:', err)
    })
  })

  window.addEventListener('popstate', (e) => {
    const state = e.state as ChainState | null

    if (state?.chainKind === 'chain' && state.url) {
      void loadFromUrl(harness, state.url).catch((err) => {
        console.error('[link-chain] popstate load failed:', err)
      })
      return
    }

    // Boot entry — restore the snapshotted boot doc rather than
    // re-running the whole init flow.
    if (state?.chainKind === 'boot') {
      harness.replaceDoc(bootDoc)
    }
  })
}
