import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parkHtml, unparkHtml } from './park-html.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__tests__', 'fixtures')
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf-8')

describe('parkHtml', () => {
  it('leaves pure markdown unchanged', () => {
    const src = '# Hello\n\nA paragraph.\n'
    expect(parkHtml(src)).toBe(src)
  })

  it('wraps a block-HTML region in a fenced code block with our sentinel', () => {
    const src = '<div align="center"><img src="https://x.test/a.png"></div>\n'
    const out = parkHtml(src)
    expect(out).toContain('```__nicermd_html__')
    expect(out).toContain('<div align="center"><img src="https://x.test/a.png"></div>')
    expect(out).toMatch(/```$/m)
  })

  it('leaves fenced code blocks alone', () => {
    const src = '```js\n<not html>\n```\n'
    expect(parkHtml(src)).toBe(src)
  })

  it('leaves indented code blocks alone', () => {
    const src = '    <not html>\n'
    expect(parkHtml(src)).toBe(src)
  })

  it('parks multiple separate HTML blocks individually', () => {
    const src = '<div>one</div>\n\n<div>two</div>\n'
    const out = parkHtml(src)
    const fenceOpens = (out.match(/```__nicermd_html__/g) ?? []).length
    expect(fenceOpens).toBe(2)
  })
})

describe('parkHtml + unparkHtml round-trip', () => {
  it('returns identity for pure markdown', () => {
    const src = fixture('clean-prose.md')
    expect(unparkHtml(parkHtml(src))).toBe(src)
  })

  it('returns identity for mixed-content markdown', () => {
    const src = fixture('clean-mixed.md')
    expect(unparkHtml(parkHtml(src))).toBe(src)
  })

  it('returns identity for the Tauri fixture (HTML scaffolding)', () => {
    const src = fixture('tauri-snippet.md')
    expect(unparkHtml(parkHtml(src))).toBe(src)
  })

  it('returns identity for the Awesome fixture (HTML scaffolding)', () => {
    const src = fixture('awesome-snippet.md')
    expect(unparkHtml(parkHtml(src))).toBe(src)
  })

  it('round-trips HTML containing backticks via a longer fence', () => {
    const src = '<div>contains ```triple and `single` backticks</div>\n'
    const parked = parkHtml(src)
    // The fence chosen must be longer than the longest internal run (3).
    expect(parked).toMatch(/`{4,}__nicermd_html__/)
    expect(unparkHtml(parked)).toBe(src)
  })
})

describe('unparkHtml', () => {
  it('leaves user-written code blocks with other languages alone', () => {
    const src = '```js\nconst x = 1\n```\n'
    expect(unparkHtml(src)).toBe(src)
  })

  it('leaves a code block whose info string is similar-but-not-ours alone', () => {
    const src = '```nicermd-html\n<not parked>\n```\n'
    expect(unparkHtml(src)).toBe(src)
  })

  it('strips only the parked code block, preserving surrounding text', () => {
    const src = 'before\n\n```__nicermd_html__\n<div>x</div>\n```\n\nafter\n'
    expect(unparkHtml(src)).toBe('before\n\n<div>x</div>\n\nafter\n')
  })
})
