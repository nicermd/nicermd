// Platform detection with a query-param override.
//
// `?platform=mac|win|linux` forces a specific platform regardless of
// what `navigator.platform` / `userAgentData.platform` reports —
// useful for previewing the Ctrl-key UI on macOS without spinning up
// a Windows VM. The override is read once at module load; URL changes
// after boot don't take effect until reload.

export type PlatformKind = 'mac' | 'win' | 'linux'

function readOverride(): PlatformKind | null {
  if (typeof window === 'undefined') return null
  const p = new URLSearchParams(window.location.search).get('platform')
  return p === 'mac' || p === 'win' || p === 'linux' ? p : null
}

const override = readOverride()

function detectFromNavigator(): PlatformKind {
  if (typeof navigator === 'undefined') return 'mac'
  const raw = (
    (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    ''
  ).toLowerCase()
  if (/mac|ipad|iphone/.test(raw)) return 'mac'
  if (/win/.test(raw)) return 'win'
  return 'linux'
}

export const PLATFORM: PlatformKind = override ?? detectFromNavigator()
export const IS_MAC: boolean = PLATFORM === 'mac'

// Surface the active platform + override (if any) on <html> so CSS
// and downstream code can react without re-detecting / re-parsing.
if (typeof document !== 'undefined') {
  document.documentElement.dataset.platform = PLATFORM
  if (override) document.documentElement.dataset.platformOverride = override
}
