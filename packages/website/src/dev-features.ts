// Dev-only aids — loaded lazily and ONLY when
// `import.meta.env.DEV && ?dev=1`. Production builds tree-shake this
// module out entirely (the call site is `if (false && ...) await import(...)`,
// which Rollup eliminates), so stress.md and the dev DOM never ship.
//
// What lives here:
//   - stress.md as the boot doc (so devs see every feature)
//   - mode label pill in the corner
//   - cross-tab BroadcastChannel sync of the current markdown text
//   - ?freeze=1 to lock a tab to its boot state (for before/after compares)

import type { Harness } from './main'
import stress from './samples/stress.md?raw'

export const bootDoc = stress

export function setupDev(harness: Harness, root: HTMLElement): void {
  const frozen = new URLSearchParams(window.location.search).get('freeze') === '1'

  // --- Mode label pill ----------------------------------------------------
  const label = document.createElement('div')
  label.className = 'mode-label'
  root.appendChild(label)

  const updateLabel = (key: number, name: string): void => {
    label.textContent = `Mode ${key} · ${name}${frozen ? ' · frozen' : ''}`
  }

  // Initialise label with current mode (harness is constructed but not yet
  // switched; reflect the default first, then react to changes).
  const initial = harness.getCurrentMode()
  updateLabel(initial.key, initial.label)
  harness.onModeChange(updateLabel)

  // --- Cross-tab sync -----------------------------------------------------
  const channel = new BroadcastChannel('nicermd-dev')
  const tabId =
    typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Math.random())

  if (!frozen) {
    channel.addEventListener('message', (event) => {
      const data = event.data as { tabId: string; markdown: string } | undefined
      if (!data || data.tabId === tabId) return
      harness.setMarkdown(data.markdown)
    })
  }

  harness.onLocalChange((md) => {
    channel.postMessage({ tabId, markdown: md })
  })
}
