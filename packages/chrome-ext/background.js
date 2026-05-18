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
// Web flows open a new tab at nicer.md/?url=<encoded-target>; the
// page handles validation (GitHub family only), the phishing-gate
// confirmation on first arrival, and rendering. Desktop flows go
// through the `nicermd://` URL scheme — the Tauri app's deep-link
// handler does the same routing.

const NICER_WEB_BASE = 'https://nicer.md/?url='
const NICER_DESKTOP_BASE = 'nicermd://?url='

function openWeb(url) {
  if (!url) return
  chrome.tabs.create({ url: NICER_WEB_BASE + encodeURIComponent(url) })
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
