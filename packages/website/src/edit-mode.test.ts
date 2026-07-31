import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  readEditFlavour,
  rememberEditFlavour,
  isEditMode,
  getFlavour,
  EDIT_FLAVOURS,
} from './edit-mode'

// In-memory localStorage shim — same pattern as per-window-state.test.ts.
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
})

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('edit flavour preference', () => {
  it('round-trips a remembered flavour', () => {
    rememberEditFlavour(3)
    expect(readEditFlavour()).toBe(3)
  })

  it('returns null when nothing is remembered', () => {
    expect(readEditFlavour()).toBeNull()
  })

  it('last write wins', () => {
    rememberEditFlavour(2)
    rememberEditFlavour(4)
    expect(readEditFlavour()).toBe(4)
  })

  it('refuses to remember non-edit modes', () => {
    rememberEditFlavour(1) // Read is not an edit flavour
    expect(readEditFlavour()).toBeNull()
    rememberEditFlavour(99)
    expect(readEditFlavour()).toBeNull()
  })

  it('rejects corrupted stored values on read', () => {
    localStorage.setItem('nicermd:edit-flavour', 'garbage')
    expect(readEditFlavour()).toBeNull()
    localStorage.setItem('nicermd:edit-flavour', '1') // valid int, not an edit mode
    expect(readEditFlavour()).toBeNull()
  })

  it('survives localStorage being unavailable', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    expect(() => rememberEditFlavour(2)).not.toThrow()
    expect(readEditFlavour()).toBeNull()
  })
})

describe('flavour registry', () => {
  it('modes 2..4 are edit modes; 1 is not', () => {
    expect(isEditMode(1)).toBe(false)
    expect(isEditMode(2)).toBe(true)
    expect(isEditMode(3)).toBe(true)
    expect(isEditMode(4)).toBe(true)
  })

  it('exactly one flavour survives for non-markdown docs (Code)', () => {
    const nonMarkdown = EDIT_FLAVOURS.filter((f) => !f.markdownOnly)
    expect(nonMarkdown.map((f) => f.key)).toEqual([5])
  })

  it('flavours run in closeness-to-Read order', () => {
    expect(EDIT_FLAVOURS.map((f) => `${f.key}:${f.name}`)).toEqual([
      '2:Live',
      '3:Write',
      '4:Split',
      '5:Code',
    ])
  })

  it('getFlavour resolves keys and rejects unknowns', () => {
    expect(getFlavour(3)?.name).toBe('Write')
    expect(getFlavour(7)).toBeNull()
  })
})
