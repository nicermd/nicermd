// Nicer.md Chrome extension — background service worker.
//
// Ways to send a URL to Nicer.md:
//
//   Web (https://nicer.md):
//     1. Toolbar icon (action) — click sends the current page URL.
//     2. Right-click menu — "Open in Nicer.md" on links or anywhere
//        on the page; sends the link URL or the page URL respectively.
//     3. Keyboard shortcut — Alt+Shift+N (Option+Shift+N on macOS) by
//        default; rebind at chrome://extensions/shortcuts under
//        "Open this page in Nicer.md" if your hands prefer a
//        different chord. Fires the toolbar action — same outcome
//        as a click.
//
//   Desktop (Nicer.md macOS app, if installed):
//     4. Right-click menu — "Open in Nicer.md desktop" on links or
//        pages. Navigates the browser to `nicermd://?url=<encoded>`;
//        the OS routes that to the installed app, which loads the
//        markdown in its own window. The browser shows a one-time
//        "Open Nicer.md?" confirmation the first time per origin.
//
// Permissions:
//   - contextMenus: required to register the right-click items.
//   - activeTab: granted only at the moment the user invokes the
//     extension (click / shortcut). Lets us read the active tab's
//     URL just then. We never read URLs unprompted; no host
//     permissions, no content scripts, no storage, no telemetry.
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

const pendingByToken = new Map() // token -> { url, expiresAt }

function gcExpired() {
  const now = Date.now()
  for (const [token, { expiresAt }] of pendingByToken) {
    if (expiresAt <= now) pendingByToken.delete(token)
  }
}

function openWeb(url) {
  if (!url) return
  const token = crypto.randomUUID()
  pendingByToken.set(token, { url, expiresAt: Date.now() + PICKUP_TTL_MS })
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
  chrome.contextMenus.create({
    id: 'open-in-nicermd-link',
    title: 'Open in Nicer.md',
    contexts: ['link'],
  })
  chrome.contextMenus.create({
    id: 'open-in-nicermd-page',
    title: 'Open in Nicer.md',
    contexts: ['page'],
  })
  chrome.contextMenus.create({
    id: 'open-in-nicermd-desktop-link',
    title: 'Open in Nicer.md desktop',
    contexts: ['link'],
  })
  chrome.contextMenus.create({
    id: 'open-in-nicermd-desktop-page',
    title: 'Open in Nicer.md desktop',
    contexts: ['page'],
  })
})

chrome.contextMenus.onClicked.addListener((info) => {
  switch (info.menuItemId) {
    case 'open-in-nicermd-link':
      openWeb(info.linkUrl)
      return
    case 'open-in-nicermd-page':
      openWeb(info.pageUrl)
      return
    case 'open-in-nicermd-desktop-link':
      openDesktop(info.linkUrl)
      return
    case 'open-in-nicermd-desktop-page':
      openDesktop(info.pageUrl)
      return
  }
})

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
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!sender?.url?.startsWith('https://nicer.md/')) {
    sendResponse({ url: null, error: 'forbidden' })
    return false
  }
  if (message?.type !== 'pickup-load' || typeof message.token !== 'string') {
    sendResponse({ url: null, error: 'bad-request' })
    return false
  }
  gcExpired()
  const entry = pendingByToken.get(message.token)
  if (!entry) {
    sendResponse({ url: null })
    return false
  }
  pendingByToken.delete(message.token)
  sendResponse({ url: entry.url })
  return false
})
