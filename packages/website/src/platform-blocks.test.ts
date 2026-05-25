import { describe, it, expect } from 'vitest'
import { stripPlatformBlocks } from './platform-blocks'

describe('stripPlatformBlocks', () => {
  it('keeps content matching the current platform', () => {
    const md = '<!-- :platform mac -->\nmac content\n<!-- :end -->'
    expect(stripPlatformBlocks(md, 'mac')).toContain('mac content')
  })

  it('strips content not matching the current platform', () => {
    const md = '<!-- :platform mac -->\nmac content\n<!-- :end -->'
    expect(stripPlatformBlocks(md, 'win')).not.toContain('mac content')
    expect(stripPlatformBlocks(md, 'linux')).not.toContain('mac content')
  })

  it('supports multi-platform markers', () => {
    const md = '<!-- :platform win linux -->\nnon-mac content\n<!-- :end -->'
    expect(stripPlatformBlocks(md, 'win')).toContain('non-mac content')
    expect(stripPlatformBlocks(md, 'linux')).toContain('non-mac content')
    expect(stripPlatformBlocks(md, 'mac')).not.toContain('non-mac content')
  })

  it('removes both markers from kept content', () => {
    const md = '<!-- :platform mac -->X<!-- :end -->'
    const result = stripPlatformBlocks(md, 'mac')
    expect(result).not.toContain(':platform')
    expect(result).not.toContain(':end')
    expect(result.trim()).toBe('X')
  })

  it('handles multiple blocks independently', () => {
    const md = `<!-- :platform mac -->A<!-- :end -->
<!-- :platform win -->B<!-- :end -->
<!-- :platform linux -->C<!-- :end -->`
    const mac = stripPlatformBlocks(md, 'mac')
    expect(mac).toContain('A')
    expect(mac).not.toContain('B')
    expect(mac).not.toContain('C')
    const win = stripPlatformBlocks(md, 'win')
    expect(win).not.toContain('A')
    expect(win).toContain('B')
    expect(win).not.toContain('C')
  })

  it('preserves content outside blocks unchanged', () => {
    const md = `intro
<!-- :platform mac -->
mac
<!-- :end -->
outro`
    expect(stripPlatformBlocks(md, 'mac')).toContain('intro')
    expect(stripPlatformBlocks(md, 'mac')).toContain('outro')
    expect(stripPlatformBlocks(md, 'linux')).toContain('intro')
    expect(stripPlatformBlocks(md, 'linux')).toContain('outro')
  })

  it('leaves markdown without markers untouched', () => {
    const md = '# Hello\n\nworld'
    expect(stripPlatformBlocks(md, 'mac')).toBe(md)
  })

  it('handles whitespace variations in markers', () => {
    const md = '<!--   :platform   mac   linux  -->\nstuff\n<!--  :end  -->'
    expect(stripPlatformBlocks(md, 'mac')).toContain('stuff')
    expect(stripPlatformBlocks(md, 'linux')).toContain('stuff')
    expect(stripPlatformBlocks(md, 'win')).not.toContain('stuff')
  })

  it('preserves multi-line body content including code fences', () => {
    const md = `<!-- :platform mac -->
\`\`\`sh
brew install something
\`\`\`
<!-- :end -->`
    const result = stripPlatformBlocks(md, 'mac')
    expect(result).toContain('```sh')
    expect(result).toContain('brew install something')
  })
})
