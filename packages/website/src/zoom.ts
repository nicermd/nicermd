// Tauri-only browser-style zoom. The Tauri WebView doesn't honour
// Cmd+/Cmd-/Cmd+0 by default — those are app-level (browser) shortcuts
// outside Tauri's wrapper. Wire them ourselves via Tauri's webview API.
//
// Browsers don't go through this module — they handle the same keys
// natively, and main.ts only calls these helpers under an isTauri()
// guard so the native browser zoom is never preventDefaulted.

const STORAGE_KEY = 'nicermd:zoom'
const MIN_ZOOM = 0.5
const MAX_ZOOM = 3.0
const STEP = 0.1

let currentZoom = 1.0

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function clamp(v: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v))
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(currentZoom))
  } catch {
    // localStorage may be unavailable; in-memory only for this session.
  }
}

async function apply(): Promise<void> {
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  await getCurrentWebview().setZoom(currentZoom)
}

export async function setupZoom(): Promise<void> {
  if (!isTauri()) return
  try {
    const stored = parseFloat(localStorage.getItem(STORAGE_KEY) ?? '')
    if (Number.isFinite(stored)) currentZoom = clamp(stored)
  } catch {
    // Use default 1.0 if storage unreadable.
  }
  await apply()
}

export async function zoomIn(): Promise<void> {
  if (!isTauri()) return
  currentZoom = clamp(currentZoom + STEP)
  await apply()
  persist()
}

export async function zoomOut(): Promise<void> {
  if (!isTauri()) return
  currentZoom = clamp(currentZoom - STEP)
  await apply()
  persist()
}

export async function zoomReset(): Promise<void> {
  if (!isTauri()) return
  currentZoom = 1.0
  await apply()
  persist()
}
