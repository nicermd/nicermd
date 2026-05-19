// Regression tests for the URL loader's parser. The parser is the
// single gate keeping every fetch on a GitHub allowlist host — SSRF
// probes, scheme tricks, and content-type spoofing all have to fail
// at parse time, before any network call. These tests pin that
// boundary.

import { describe, expect, it } from 'vitest'
import { parseGithubUrl } from './url-open'

function reject(input: string): void {
  const r = parseGithubUrl(input)
  expect(r.ok).toBe(false)
}

function accept(input: string): Extract<ReturnType<typeof parseGithubUrl>, { ok: true }> {
  const r = parseGithubUrl(input)
  expect(r.ok).toBe(true)
  return r as Extract<ReturnType<typeof parseGithubUrl>, { ok: true }>
}

// --- Scheme rejection ----------------------------------------------------

describe('Scheme rejection', () => {
  it('rejects http:// (only https allowed)', () => {
    reject('http://github.com/u/r/blob/main/x.md')
    reject('http://raw.githubusercontent.com/u/r/main/x.md')
  })
  it('rejects file://', () => {
    reject('file:///etc/passwd')
    reject('file:///Users/x/secrets.md')
  })
  it('rejects javascript:', () => {
    reject('javascript:alert(1)')
  })
  it('rejects data:', () => {
    reject('data:text/markdown,# hello')
  })
  it('rejects ftp:, gopher:, vbscript:', () => {
    reject('ftp://github.com/u/r/x.md')
    reject('gopher://github.com/u/r/x.md')
    reject('vbscript:msgbox(1)')
  })
})

// --- Host allowlist (SSRF defence) ---------------------------------------

describe('Host allowlist', () => {
  it('rejects localhost and loopbacks', () => {
    reject('https://localhost/x.md')
    reject('https://localhost:3000/x.md')
    reject('https://127.0.0.1/x.md')
    reject('https://[::1]/x.md')
  })
  it('rejects link-local / metadata services', () => {
    reject('https://169.254.169.254/latest/meta-data/x.md')
    reject('https://169.254.169.254/x.md')
  })
  it('rejects internal hostnames', () => {
    reject('https://internal.intra/x.md')
    reject('https://corp.local/x.md')
    reject('https://nicer.md/x.md')
  })
  it('rejects look-alike hosts (must be exact match)', () => {
    reject('https://github.com.attacker.test/u/r/x.md')
    reject('https://attacker.test/github.com/u/r/x.md')
    reject('https://raw-githubusercontent.com/u/r/main/x.md')
    reject('https://rawgithubusercontent.com/u/r/main/x.md')
  })
})

// --- Path / extension filter ---------------------------------------------

describe('Path extension filter', () => {
  it('accepts .md, .markdown, .mdx (case-insensitive)', () => {
    const md = accept('https://raw.githubusercontent.com/u/r/main/x.md')
    expect(md.parsed).toMatchObject({ kind: 'direct', content: { kind: 'markdown' } })
    accept('https://raw.githubusercontent.com/u/r/main/x.MD')
    accept('https://raw.githubusercontent.com/u/r/main/x.markdown')
    accept('https://raw.githubusercontent.com/u/r/main/x.mdx')
  })
  it('accepts plain-text doc basenames without extension', () => {
    const lic = accept('https://github.com/u/r/blob/main/LICENSE')
    expect(lic.parsed).toMatchObject({ kind: 'direct', content: { kind: 'plain' } })
    accept('https://github.com/u/r/blob/main/COPYING')
    accept('https://github.com/u/r/blob/main/CHANGELOG')
    accept('https://github.com/u/r/blob/main/README')
    accept('https://github.com/u/r/blob/main/AUTHORS')
    accept('https://github.com/u/r/blob/main/NOTICE')
  })
  it('accepts .txt as plain text', () => {
    const r = accept('https://raw.githubusercontent.com/u/r/main/notes.txt')
    expect(r.parsed).toMatchObject({ kind: 'direct', content: { kind: 'plain' } })
  })
  it('accepts source files with the right hljs language', () => {
    const ts = accept('https://raw.githubusercontent.com/u/r/main/src/main.ts')
    expect(ts.parsed).toMatchObject({ kind: 'direct', content: { kind: 'source', language: 'typescript' } })
    const py = accept('https://github.com/u/r/blob/main/run.py')
    expect(py.parsed).toMatchObject({ kind: 'direct', content: { kind: 'source', language: 'python' } })
    const html = accept('https://raw.githubusercontent.com/u/r/main/index.html')
    expect(html.parsed).toMatchObject({ kind: 'direct', content: { kind: 'source', language: 'html' } })
    accept('https://raw.githubusercontent.com/u/r/main/style.css')
    accept('https://raw.githubusercontent.com/u/r/main/data.json')
    accept('https://raw.githubusercontent.com/u/r/main/run.sh')
  })
  it('rejects unsupported file types', () => {
    reject('https://github.com/u/r/blob/main/photo.png')
    reject('https://github.com/u/r/blob/main/archive.zip')
    reject('https://github.com/u/r/blob/main/binary.exe')
    reject('https://raw.githubusercontent.com/u/r/main/movie.mp4')
  })
  it('rejects extensionless basenames that are not known plain-text docs', () => {
    reject('https://github.com/u/r/blob/main/Makefile')
    reject('https://github.com/u/r/blob/main/.gitignore')
  })
  it('strips query/fragment before checking extension', () => {
    accept('https://raw.githubusercontent.com/u/r/main/x.md?token=abc')
    accept('https://raw.githubusercontent.com/u/r/main/x.md#section')
  })
})

// --- Parsed shape correctness --------------------------------------------

describe('Parsed shape', () => {
  it('parses bare-repo URLs as { kind: repo }', () => {
    const r = accept('https://github.com/sindresorhus/awesome')
    expect(r.parsed).toMatchObject({ kind: 'repo', user: 'sindresorhus', repo: 'awesome' })
  })
  it('parses tree URLs as { kind: tree }', () => {
    const r = accept('https://github.com/u/r/tree/dev/docs')
    expect(r.parsed).toMatchObject({ kind: 'tree', user: 'u', repo: 'r', branch: 'dev', dir: 'docs' })
  })
  it('parses tree URL with no dir', () => {
    const r = accept('https://github.com/u/r/tree/main')
    expect(r.parsed).toMatchObject({ kind: 'tree', user: 'u', repo: 'r', branch: 'main' })
  })
  it('parses blob/raw URLs to direct rawUrl', () => {
    const r = accept('https://github.com/u/r/blob/main/path/x.md')
    expect(r.parsed).toMatchObject({
      kind: 'direct',
      rawUrl: 'https://raw.githubusercontent.com/u/r/main/path/x.md',
    })
  })
  it('parses gist URLs', () => {
    const r = accept('https://gist.github.com/octocat/abc123def456')
    expect(r.parsed).toMatchObject({ kind: 'gist', user: 'octocat', id: 'abc123def456' })
  })
  it('passes raw.githubusercontent.com through', () => {
    const r = accept('https://raw.githubusercontent.com/u/r/main/x.md')
    expect(r.parsed).toMatchObject({
      kind: 'direct',
      rawUrl: 'https://raw.githubusercontent.com/u/r/main/x.md',
    })
  })
})

// --- Protocol-less tolerance (only for accepted hosts) -------------------

describe('Protocol-less inputs', () => {
  it('accepts github.com/u/r without scheme', () => {
    const r = accept('github.com/sindresorhus/awesome')
    expect(r.parsed.kind).toBe('repo')
  })
  it('accepts www.github.com/u/r without scheme', () => {
    accept('www.github.com/u/r')
  })
  it('accepts raw.githubusercontent.com/u/r/main/x.md without scheme', () => {
    accept('raw.githubusercontent.com/u/r/main/x.md')
  })
  it('rejects unknown hosts without scheme (no allowlist widening)', () => {
    // The auto-prepend only fires for known hosts. attacker.com gets
    // no scheme prepended, so URL parsing fails or it gets rejected
    // downstream by the protocol check.
    reject('attacker.com/u/r/x.md')
    reject('evil.test/github.com/u/r/x.md')
  })
})

// --- Malformed inputs ----------------------------------------------------

describe('Malformed inputs', () => {
  it('rejects empty string', () => {
    reject('')
  })
  it('rejects whitespace-only', () => {
    reject('   ')
  })
  it('rejects garbage', () => {
    reject('not a url at all')
    reject('🦊')
  })
  it('rejects github.com root', () => {
    reject('https://github.com')
    reject('https://github.com/')
  })
  it('rejects github.com/user (no repo)', () => {
    reject('https://github.com/octocat')
  })
  it('rejects github.com with too-deep tree but no /tree/ prefix', () => {
    reject('https://github.com/u/r/issues')
    reject('https://github.com/u/r/pulls/1')
  })
})
