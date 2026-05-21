import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  persistMode,
  readPersistedMode,
  persistSource,
  readPersistedSource,
  type PersistedSource,
} from './per-window-state'

// In-memory localStorage shim so tests don't depend on browser
// environment. Mirrors the Storage interface tightly enough for our
// usage (getItem / setItem / removeItem).
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  clear(): void {
    this.map.clear()
  }
  get length(): number {
    return this.map.size
  }
  key(idx: number): string | null {
    return Array.from(this.map.keys())[idx] ?? null
  }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
  ;(globalThis as { window?: unknown }).window = globalThis
  // Default: no Tauri internals -> label resolves to 'main'
  delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
})

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
})

function setLabel(label: string): void {
  ;(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label } },
  }
}

describe('per-window-state mode', () => {
  it('persists and reads back a mode', () => {
    persistMode(4)
    expect(readPersistedMode()).toBe(4)
  })

  it('returns null when no mode is persisted', () => {
    expect(readPersistedMode()).toBeNull()
  })

  it('rejects out-of-range values', () => {
    localStorage.setItem('nicermd:mode:main', '99')
    expect(readPersistedMode()).toBeNull()
    localStorage.setItem('nicermd:mode:main', '0')
    expect(readPersistedMode()).toBeNull()
    localStorage.setItem('nicermd:mode:main', 'not-a-number')
    expect(readPersistedMode()).toBeNull()
  })

  it('keys mode per window label', () => {
    setLabel('window-2')
    persistMode(3)
    setLabel('window-3')
    persistMode(4)
    setLabel('window-2')
    expect(readPersistedMode()).toBe(3)
    setLabel('window-3')
    expect(readPersistedMode()).toBe(4)
  })
})

describe('per-window-state source (Tauri context)', () => {
  // All source-persistence tests run in Tauri context. The web-only
  // behaviour is covered in the 'Tauri vs web' block further down.
  beforeEach(() => {
    setLabel('main')
  })

  const TAURI_PATH_SOURCE: PersistedSource = {
    kind: 'tauri-path',
    value: '/path/to/file.md',
    name: 'file.md',
    contentKind: { kind: 'markdown' },
  }

  it('persists and reads back a tauri-path source', () => {
    persistSource(TAURI_PATH_SOURCE)
    expect(readPersistedSource()).toEqual(TAURI_PATH_SOURCE)
  })

  it('persists and reads back a URL source', () => {
    const urlSource: PersistedSource = {
      kind: 'url',
      value: 'https://example.com/readme.md',
      name: 'readme.md',
      contentKind: { kind: 'markdown' },
    }
    persistSource(urlSource)
    expect(readPersistedSource()).toEqual(urlSource)
  })

  it('clears the slot when persistSource(null) is called', () => {
    persistSource(TAURI_PATH_SOURCE)
    expect(readPersistedSource()).not.toBeNull()
    persistSource(null)
    expect(readPersistedSource()).toBeNull()
  })

  it('returns null when no source is persisted', () => {
    expect(readPersistedSource()).toBeNull()
  })

  it('rejects malformed persisted values', () => {
    localStorage.setItem('nicermd:source:main', 'not json')
    expect(readPersistedSource()).toBeNull()
    localStorage.setItem('nicermd:source:main', JSON.stringify({ kind: 'fsa' }))
    expect(readPersistedSource()).toBeNull()
    localStorage.setItem('nicermd:source:main', JSON.stringify({ kind: 'url' }))
    expect(readPersistedSource()).toBeNull()
    localStorage.setItem(
      'nicermd:source:main',
      JSON.stringify({ kind: 'url', value: '' }),
    )
    expect(readPersistedSource()).toBeNull()
  })

  it('keys source per window label so windows do not clobber each other', () => {
    setLabel('window-2')
    persistSource(TAURI_PATH_SOURCE)
    setLabel('window-3')
    persistSource({
      kind: 'url',
      value: 'https://example.com/b.md',
      name: 'b',
      contentKind: { kind: 'markdown' },
    })
    setLabel('window-2')
    expect(readPersistedSource()?.value).toBe('/path/to/file.md')
    setLabel('window-3')
    expect(readPersistedSource()?.value).toBe('https://example.com/b.md')
  })

  it('regression: snapshot survives a follow-up persistSource(null)', () => {
    // Mirrors the boot scenario where boot()'s setDocState fires with
    // null source AFTER the user's actual source was persisted in a
    // previous session. If a caller snapshots readPersistedSource()
    // BEFORE the null write, that snapshot must still hold the
    // pre-null value.
    setLabel('main') // Need Tauri context for source persistence
    persistSource(TAURI_PATH_SOURCE)
    const snapshot = readPersistedSource()
    persistSource(null)
    expect(readPersistedSource()).toBeNull()
    expect(snapshot).toEqual(TAURI_PATH_SOURCE)
  })
})

describe('per-window-state source: Tauri vs web', () => {
  const TAURI_PATH_SOURCE: PersistedSource = {
    kind: 'tauri-path',
    value: '/path/to/file.md',
    name: 'file.md',
    contentKind: { kind: 'markdown' },
  }

  it('persistSource writes to localStorage when running in Tauri', () => {
    ;(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
    }
    persistSource(TAURI_PATH_SOURCE)
    expect(localStorage.getItem('nicermd:source:main')).toBeTruthy()
  })

  it('persistSource is a no-op in web (no __TAURI_INTERNALS__)', () => {
    // beforeEach already deletes __TAURI_INTERNALS__, simulating web.
    persistSource(TAURI_PATH_SOURCE)
    expect(localStorage.getItem('nicermd:source:main')).toBeNull()
  })

  it('readPersistedSource returns null in web even if localStorage has a value', () => {
    // Simulate a stale entry written by an older Tauri-on-web build:
    localStorage.setItem(
      'nicermd:source:main',
      JSON.stringify(TAURI_PATH_SOURCE),
    )
    // No __TAURI_INTERNALS__ → web context.
    expect(readPersistedSource()).toBeNull()
  })

  it('readPersistedSource returns the value in Tauri', () => {
    ;(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
    }
    persistSource(TAURI_PATH_SOURCE)
    expect(readPersistedSource()).toEqual(TAURI_PATH_SOURCE)
  })

  it('regression: in web, two extension pickups in a row do not see each other (cross-pickup race)', () => {
    // The original bug: a previous extension URL pickup persisted
    // source = pageUrl, then the NEXT pickup tab read that source
    // and overrode the in-flight selection text. In web we explicitly
    // never persist, so a setDocState({kind: 'url'}) followed by
    // readPersistedSource() — emulating the next tab's boot — sees
    // nothing left over.
    // Step 1: pickup-1 sets a URL source.
    persistSource({
      kind: 'url',
      value: 'https://example.com/a.md',
      name: 'a.md',
      contentKind: { kind: 'markdown' },
    })
    // Step 2: pickup-2 boots in a NEW tab. Same web context. Reads
    // localStorage. Must be null (otherwise the race re-emerges).
    expect(readPersistedSource()).toBeNull()
  })
})
