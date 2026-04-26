// localStorage autosave + recovery banner.
//
// On every user edit (debounced 1.5s) writes a snapshot of the current
// doc to localStorage. Cleared on every successful Save / Open / New
// (i.e. whenever isDirty flips back to false). On boot, if a backup
// exists and is younger than 24h and differs from what's currently
// loaded, surfaces a small banner offering to Restore or Discard.
//
// Single-slot — multiple Tauri windows would clobber each other (we
// don't support multi-window yet, so moot for now). FSA handles can't
// be serialised, and Tauri paths would need permission re-confirmation,
// so a recovered doc lands as anonymous (Cmd+S becomes Save-As).

import type { Harness } from './main'
import { isDirty, getCurrentName, setDocState } from './doc-source'

const KEY = 'nicermd:autosave'
const DEBOUNCE_MS = 1500
const RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface Snapshot {
  text: string
  name: string | null
  savedAt: number
}

let debounceTimer: number | null = null
let harnessRef: Harness | null = null

function readSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Snapshot
    if (typeof parsed.text !== 'string' || typeof parsed.savedAt !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function writeSnapshot(snap: Snapshot): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(snap))
  } catch {
    // QuotaExceeded or storage unavailable — silent.
  }
}

function clearSnapshot(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

function flush(): void {
  if (!harnessRef) return
  if (!isDirty()) return
  writeSnapshot({
    text: harnessRef.getMarkdown(),
    name: getCurrentName(),
    savedAt: Date.now(),
  })
}

export function setupAutosave(harness: Harness): void {
  harnessRef = harness

  harness.onLocalChange(() => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(flush, DEBOUNCE_MS)
  })

  // Whenever the source identity changes (open/save/new), the new state
  // resets dirty=false. Drop the backup; if the user starts editing
  // again, autosave begins a fresh snapshot.
  document.addEventListener('nicermd:source-changed', () => {
    if (!isDirty()) clearSnapshot()
  })
}

export function checkRecovery(harness: Harness, currentText: string): void {
  const snap = readSnapshot()
  if (!snap) return
  if (Date.now() - snap.savedAt > RECOVERY_MAX_AGE_MS) {
    clearSnapshot()
    return
  }
  if (snap.text === currentText) {
    clearSnapshot()
    return
  }
  showRecoveryBanner(harness, snap)
}

function showRecoveryBanner(harness: Harness, snap: Snapshot): void {
  const banner = document.createElement('div')
  banner.className = 'recovery-banner'

  const message = document.createElement('span')
  message.className = 'recovery-banner__text'
  const name = snap.name ?? 'Untitled'
  message.textContent = `Unsaved changes from ${formatAge(Date.now() - snap.savedAt)} ago in "${name}". Restore?`

  const restore = document.createElement('button')
  restore.className = 'recovery-banner__btn recovery-banner__btn--primary'
  restore.type = 'button'
  restore.textContent = 'Restore'
  restore.addEventListener('click', () => {
    setDocState(snap.text, snap.name, null)
    harness.replaceDoc(snap.text)
    clearSnapshot()
    banner.remove()
  })

  const discard = document.createElement('button')
  discard.className = 'recovery-banner__btn'
  discard.type = 'button'
  discard.textContent = 'Discard'
  discard.addEventListener('click', () => {
    clearSnapshot()
    banner.remove()
  })

  banner.append(message, restore, discard)
  document.body.appendChild(banner)

  // Auto-dismiss banner if the user starts editing the boot doc — they've
  // implicitly chosen the current state. Backup stays in localStorage
  // until they make their choice or 24h passes.
  const dismissOnEdit = (): void => {
    banner.remove()
    harness.offLocalChange(dismissOnEdit)
  }
  harness.onLocalChange(dismissOnEdit)
}

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'less than a minute'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}
