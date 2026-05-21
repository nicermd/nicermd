// Nicer.md Chrome extension — background service worker.
//
// Ways to send content to Nicer.md:
//
//   1. Toolbar icon — click sends the current page URL to
//      https://nicer.md (or use Alt+Shift+N shortcut).
//   2. Right-click "Nicer.md" submenu (consistent on every page):
//        ├─ Open in browser   → page URL (or link URL if on a link)
//        │                      to https://nicer.md
//        ├─ Open in desktop   → same URL via `nicermd://` scheme
//        │                      to the macOS app (if installed)
//        └─ Render selection  → selected text/HTML to a scratch doc
//                               at https://nicer.md
//
//      All three submenu items always appear, regardless of whether
//      anything is selected. Render-selection is a silent no-op when
//      nothing's selected (Chrome doesn't expose selection state to
//      permissionless extensions until click time, so we can't grey
//      out the item passively). Smart URL: Open-in-browser /
//      Open-in-desktop use the link URL when the click landed on
//      a link, otherwise the page URL.
//
//   Desktop arrivals via `nicermd://` show the standard browser
//   "Open Nicer.md?" confirmation the first time per origin.
//
// Permissions:
//   - contextMenus: required to register the right-click items.
//   - activeTab: granted only at the moment the user invokes the
//     extension (click / shortcut). Lets us read the active tab's
//     URL just then. We never read URLs unprompted; no host
//     permissions, no content scripts, no storage, no telemetry.
//   - scripting: gates the chrome.scripting namespace itself. Only
//     used in the render-selection click handler, scoped to the
//     active tab (which activeTab grants), to read the live
//     selection as HTML for fidelity (preserves bold / links /
//     lists when rendering web-styled text in Nicer.md).
//
// Web flows use a one-time "pickup" token (random UUID per click)
// rather than putting the GitHub URL straight in the address bar.
// The new tab opens at `https://nicer.md/?ext-pickup=<token>`; the
// page then messages this background worker to retrieve the URL by
// token. Effect: nicer.md can recognise extension-originated loads
// and skip its phishing gate (which exists to defend against share-
// link arrivals), while a forged or pasted token simply matches no
// pending request and falls through to the normal boot doc.
//
// The page → extension message channel is restricted by
// `externally_connectable.matches` to `https://nicer.md/*`; tokens
// expire after 30 seconds; each token is consumed on first
// successful retrieval.
//
// Desktop flows go through the `nicermd://` URL scheme directly —
// the Tauri app's deep-link handler does the routing, no token
// needed (the OS already shows its own "Open Nicer.md?" prompt).

const NICER_WEB_BASE = 'https://nicer.md/?ext-pickup='
const NICER_DESKTOP_BASE = 'nicermd://?url='
const PICKUP_TTL_MS = 30_000

// Pending pickup payloads keyed by random-UUID token.
// Two kinds:
//   - { kind: 'url', value: 'https://...', expiresAt }: the existing
//     URL-pickup flow (toolbar click, right-click on link / page).
//   - { kind: 'text', value: '...', expiresAt }: the render-selection
//     flow — user highlighted text on any page and chose
//     "Render selection in Nicer.md" from the right-click menu. The
//     selection text is held in the worker's memory just long enough
//     for the new tab to retrieve it. No host permissions; no
//     content scripts — `contexts: ['selection']` gives us
//     info.selectionText directly via activeTab.
const pendingByToken = new Map() // token -> { kind, value, expiresAt }

function gcExpired() {
  const now = Date.now()
  for (const [token, { expiresAt }] of pendingByToken) {
    if (expiresAt <= now) pendingByToken.delete(token)
  }
}

function openWeb(url) {
  if (!url) return
  const token = crypto.randomUUID()
  pendingByToken.set(token, {
    kind: 'url',
    value: url,
    expiresAt: Date.now() + PICKUP_TTL_MS,
  })
  gcExpired()
  chrome.tabs.create({ url: NICER_WEB_BASE + encodeURIComponent(token) })
}

// Open a new Nicer.md tab seeded with the given text as a scratch
// markdown doc. Mirrors openWeb's pickup-token mechanism so the text
// never lands in the URL bar (which would be ugly + length-limited
// + leak content via referer headers downstream).
function openWebText(text) {
  if (!text) return
  const token = crypto.randomUUID()
  pendingByToken.set(token, {
    kind: 'text',
    value: text,
    expiresAt: Date.now() + PICKUP_TTL_MS,
  })
  gcExpired()
  chrome.tabs.create({ url: NICER_WEB_BASE + encodeURIComponent(token) })
}

function openDesktop(url) {
  if (!url) return
  // Navigating to `nicermd://…` triggers the OS protocol handler.
  // Browsers show a one-time confirmation per origin before
  // launching the app; subsequent invocations on the same origin
  // can be remembered ("always allow"). If Nicer.md desktop isn't
  // installed, the browser surfaces "No app to handle this link".
  chrome.tabs.create({ url: NICER_DESKTOP_BASE + encodeURIComponent(url) })
}

chrome.runtime.onInstalled.addListener(() => {
  // Single "Nicer.md" submenu, three always-visible children. The
  // earlier flat layout (separate page/link/selection contexts) gave
  // users an inconsistent right-click — they'd see 2 items on a
  // background, 2 on a link, 3 with text selected. Consolidating
  // under one parent + always showing all three actions makes the
  // affordance predictable: same shape on every right-click,
  // grouped under the Nicer.md brand.
  //
  // The "Open in browser" / "Open in desktop" children use a
  // smart-URL convention: if the click was on a link, use the link
  // URL; otherwise use the page URL. Render-selection always shows
  // but is a silent no-op when there's no text — Chrome's
  // contextMenus API doesn't surface selection state until click
  // time, so passive grey-out would require continuous tab/selection
  // monitoring (i.e. host permissions + content script) which we
  // deliberately don't ship.
  chrome.contextMenus.create({
    id: 'nicermd-parent',
    title: 'Nicer.md',
    contexts: ['all'],
  })
  chrome.contextMenus.create({
    id: 'nicermd-open-web',
    parentId: 'nicermd-parent',
    title: 'Open in browser',
    contexts: ['all'],
  })
  chrome.contextMenus.create({
    id: 'nicermd-open-desktop',
    parentId: 'nicermd-parent',
    title: 'Open in desktop',
    contexts: ['all'],
  })
  chrome.contextMenus.create({
    id: 'nicermd-render-selection',
    parentId: 'nicermd-parent',
    title: 'Render selection',
    contexts: ['all'],
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case 'nicermd-open-web':
      // Smart URL: if the right-click was on a link, open the link's
      // target; otherwise open the page itself. Same convention for
      // the desktop variant.
      openWeb(info.linkUrl || info.pageUrl)
      return
    case 'nicermd-open-desktop':
      openDesktop(info.linkUrl || info.pageUrl)
      return
    case 'nicermd-render-selection': {
      // Silent no-op when nothing's selected. The menu item is
      // always visible (we can't passively grey it out without
      // continuous selection tracking, which would require host
      // permissions across all sites).
      if (!info.selectionText) return
      // info.selectionText is plain text — Chrome strips all the
      // web styling. To preserve formatting (bold, links, lists,
      // headings) we run a tiny scripting injection on the active
      // tab to serialise the live selection to HTML. activeTab
      // (granted to us by the right-click invocation) covers the
      // permission; `scripting` is declared in the manifest as the
      // API namespace gate. Falls back to plain text if the
      // injection fails (e.g. on chrome:// / about: / blocked-CSP
      // pages where executeScript can't run).
      const payload = await getSelectionHtml(tab?.id) ?? info.selectionText
      openWebText(payload)
      return
    }
  }
})

async function getSelectionHtml(tabId) {
  if (typeof tabId !== 'number') return null
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0) return null
        const range = sel.getRangeAt(0)
        const container = document.createElement('div')
        container.appendChild(range.cloneContents())
        return container.innerHTML
      },
    })
    const html = results?.[0]?.result
    return typeof html === 'string' && html.length > 0 ? html : null
  } catch (err) {
    console.warn('[nicermd-ext] selection-as-html failed:', err)
    return null
  }
}

// Both a toolbar click and the user-assigned keyboard shortcut
// (via the manifest's `_execute_action` command) fire this event
// with the active tab. activeTab permission lets us read tab.url
// from inside this handler. Toolbar always opens the web flow —
// desktop is opt-in via the explicit right-click item.
chrome.action.onClicked.addListener((tab) => {
  openWeb(tab.url)
})

// Pickup channel — the only thing nicer.md can ever ask this
// extension to do. Restricted to nicer.md by externally_connectable
// in the manifest; defence-in-depth re-check on sender.url. Tokens
// are one-time: once retrieved, immediately removed from the map.
//
// Response shape:
//   { kind: 'url' | 'text', value: string }
//
// The legacy `{ url: string }` shape is preserved when kind='url' so
// older nicer.md builds that only know about URL pickups still work
// (they read response.url; the new field is ignored). New builds
// read kind+value to also handle the text-pickup flow.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!sender?.url?.startsWith('https://nicer.md/')) {
    sendResponse({ url: null, kind: null, value: null, error: 'forbidden' })
    return false
  }
  if (message?.type !== 'pickup-load' || typeof message.token !== 'string') {
    sendResponse({ url: null, kind: null, value: null, error: 'bad-request' })
    return false
  }
  gcExpired()
  const entry = pendingByToken.get(message.token)
  if (!entry) {
    sendResponse({ url: null, kind: null, value: null })
    return false
  }
  pendingByToken.delete(message.token)
  sendResponse({
    kind: entry.kind,
    value: entry.value,
    // Backward compat for the 0.3.0 web protocol that only handled URLs.
    url: entry.kind === 'url' ? entry.value : null,
  })
  return false
})
