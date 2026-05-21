// Right-click context menu for in-doc links (Tauri only).
//
// Default WKWebView behaviour on macOS treats "Open Link in New Window"
// as "open in Safari", which sends the user out of the app — fine for
// arbitrary links, frustrating for markdown URLs the reader could
// render. We intercept right-click on loader-eligible anchors and
// pop up a NATIVE Tauri menu (`@tauri-apps/api/menu`) offering an
// "Open Link in New Window" entry that spawns another Nicer.md window
// pointed at the same URL.
//
// Why a native popup instead of a custom div: a styled CSS menu
// inevitably looks different from the system right-click menu the
// user gets everywhere else (selected text → Copy, plain link →
// system menu, etc.). The visual mismatch reads as broken even when
// the affordance works. The Tauri `Menu.popup()` API renders through
// the native AppKit menu machinery so our one extra entry looks
// indistinguishable from the platform default.
//
// Scope: only intercepts when the right-click hits an anchor whose
// effective target is loader-eligible (raw / blob+.md / tree / repo /
// gist). Anchors using the `?url=` share-link form have their inner
// URL extracted before validation. Everything else falls through to
// the system context menu so users can still copy / save-link-as /
// open-in-browser as usual.

import { resolveLinkTarget } from './url-open'
import { openUrlInNewWindow } from './tauri-bridge'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function setupLinkContextMenu(): void {
  if (!isTauri()) return

  document.addEventListener('contextmenu', (e) => {
    if (!(e.target instanceof Element)) return
    const anchor = e.target.closest('a[href]') as HTMLAnchorElement | null
    if (!anchor) return
    const target = resolveLinkTarget(anchor)
    if (!target) return
    // Suppress the WKWebView default menu and pop ours up at the
    // cursor. preventDefault must run synchronously; the menu build
    // is async (Tauri IPC) but races resolve before the cursor moves
    // meaningfully — and even if the cursor drifts a few pixels,
    // popup() without an explicit position uses the cursor's
    // location at the time of the call, which still feels right
    // (the menu appears under the pointer, not the click point).
    e.preventDefault()
    void showNativeMenu(target)
  })
}

async function showNativeMenu(target: string): Promise<void> {
  const { Menu, MenuItem } = await import('@tauri-apps/api/menu')
  const item = await MenuItem.new({
    text: 'Open Link in New Window',
    action: () => {
      void openUrlInNewWindow(target)
    },
  })
  const menu = await Menu.new({ items: [item] })
  await menu.popup()
}
