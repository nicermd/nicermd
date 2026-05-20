// Tests for the autosave upgrade-path migration. Pre-multi-window
// builds wrote snapshots to the bare `nicermd:autosave` key; the
// multi-window build (0.1.6+) writes to a labelled slot
// `nicermd:autosave:<window-label>`. Without migration, users who
// upgrade mid-edit lose their recovery banner.

import { beforeEach, describe, expect, it } from 'vitest'
import { migrateLegacyAutosaveKey } from './autosave'

function makeStorage(): {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  data: Map<string, string>
} {
  const data = new Map<string, string>()
  return {
    data,
    storage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value)
      },
      removeItem: (key) => {
        data.delete(key)
      },
    },
  }
}

const BASE = 'nicermd:autosave'
const SNAPSHOT = JSON.stringify({ text: 'hello world', name: 'doc.md', savedAt: 1 })

describe('migrateLegacyAutosaveKey', () => {
  let s: ReturnType<typeof makeStorage>
  beforeEach(() => {
    s = makeStorage()
  })

  it('migrates a bare snapshot into the main-labelled slot', () => {
    s.data.set(BASE, SNAPSHOT)
    migrateLegacyAutosaveKey(s.storage, BASE, 'main')
    expect(s.data.get(`${BASE}:main`)).toBe(SNAPSHOT)
    expect(s.data.has(BASE)).toBe(false)
  })

  it('leaves the labelled snapshot alone if it already exists', () => {
    const newer = JSON.stringify({ text: 'newer', name: null, savedAt: 99 })
    s.data.set(BASE, SNAPSHOT)
    s.data.set(`${BASE}:main`, newer)
    migrateLegacyAutosaveKey(s.storage, BASE, 'main')
    expect(s.data.get(`${BASE}:main`)).toBe(newer)
    // Bare still removed so the migration check doesn't keep firing
    // on subsequent launches.
    expect(s.data.has(BASE)).toBe(false)
  })

  it('is a no-op when no bare snapshot exists', () => {
    migrateLegacyAutosaveKey(s.storage, BASE, 'main')
    expect(s.data.size).toBe(0)
  })

  it('does not migrate for non-main windows', () => {
    s.data.set(BASE, SNAPSHOT)
    migrateLegacyAutosaveKey(s.storage, BASE, 'window-2')
    // Bare stays; we don't want a new window-N grabbing a previous-
    // session main snapshot. The main window owns the migration.
    expect(s.data.get(BASE)).toBe(SNAPSHOT)
    expect(s.data.has(`${BASE}:window-2`)).toBe(false)
  })

  it('is idempotent — second call after migration is a no-op', () => {
    s.data.set(BASE, SNAPSHOT)
    migrateLegacyAutosaveKey(s.storage, BASE, 'main')
    const after = new Map(s.data)
    migrateLegacyAutosaveKey(s.storage, BASE, 'main')
    expect(s.data).toEqual(after)
  })
})
