// Platform detection with a query-param override.
//
// `?platform=mac|win|linux` forces a specific platform regardless of
// what `navigator.platform` / `userAgentData.platform` reports —
// useful for previewing the Ctrl-key UI on macOS without spinning up
// a Windows VM. The override is read once at module load; URL changes
// after boot don't take effect until reload.

type PlatformKind = 'mac' | 'win' | 'linux'

function readOverride(): PlatformKind | null {
  if (typeof window === 'undefined') return null
  const p = new URLSearchParams(window.location.search).get('platform')
  return p === 'mac' || p === 'win' || p === 'linux' ? p : null
}

const override = readOverride()

function detectFromNavigator(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform =
    (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    ''
  return /(Mac|iPad|iPhone)/i.test(platform)
}

export const IS_MAC: boolean = override ? override === 'mac' : detectFromNavigator()

// Surface the override on <html> so downstream code (or future CSS)
// can react without re-parsing the query string. Empty when no
// override is active.
if (typeof document !== 'undefined' && override) {
  document.documentElement.dataset.platformOverride = override
}
