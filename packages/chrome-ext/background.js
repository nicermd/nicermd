// Nicer.md Chrome extension — background service worker.
//
// Three ways to send a URL to Nicer.md:
//
//   1. Toolbar icon (action) — click sends the current page URL.
//   2. Right-click menu — "Open in Nicer.md" on links or anywhere
//      on the page; sends the link URL or the page URL respectively.
//   3. Keyboard shortcut — unassigned by default to avoid colliding
//      with the user's existing bindings. Assign at
//      chrome://extensions/shortcuts (the entry is "Open this page
//      in Nicer.md"). Once set, the shortcut fires the toolbar
//      action — same outcome as a click.
//
// Permissions:
//   - contextMenus: required to register the right-click items.
//   - activeTab: granted only at the moment the user invokes the
//     extension (click / shortcut). Lets us read the active tab's
//     URL just then. We never read URLs unprompted; no host
//     permissions, no content scripts, no storage, no telemetry.
//
// All three paths open a new tab at nicer.md/?url=<encoded-target>.
// nicer.md (packages/website/src/url-open.ts) handles validation
// (GitHub family only), the phishing-gate confirmation on first
// arrival, and rendering.

const NICER_BASE = 'https://nicer.md/?url='

function openInNicerMd(url) {
  if (!url) return
  chrome.tabs.create({ url: NICER_BASE + encodeURIComponent(url) })
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
})

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'open-in-nicermd-link') {
    openInNicerMd(info.linkUrl)
  } else if (info.menuItemId === 'open-in-nicermd-page') {
    openInNicerMd(info.pageUrl)
  }
})

// Both a toolbar click and the user-assigned keyboard shortcut
// (via the manifest's `_execute_action` command) fire this event
// with the active tab. activeTab permission lets us read tab.url
// from inside this handler.
chrome.action.onClicked.addListener((tab) => {
  openInNicerMd(tab.url)
})
