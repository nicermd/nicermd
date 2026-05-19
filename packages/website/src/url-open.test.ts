// Regression tests for the URL loader's parser. The parser is the
// single gate keeping every fetch on a GitHub allowlist host — SSRF
// probes, scheme tricks, and content-type spoofing all have to fail
// at parse time, before any network call. These tests pin that
// boundary.

import { describe, expect, it } from 'vitest'
import { parseGithubUrl, readBodyWithCap } from './url-open'

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

// --- Streaming body cap --------------------------------------------------
// readBodyWithCap streams the response, aborting as soon as cumulative
// bytes exceed the cap. Previous implementation buffered the whole body
// and only checked length after — meaning an attacker-controlled server
// could ship up to (cap-1) bytes "for free". These tests pin that the
// streaming variant terminates early and never accumulates past the cap.

describe('Streaming body cap', () => {
  // Build a Response whose body is a stream emitting `chunks` of size
  // `chunkSize`. Total bytes = chunks * chunkSize. Useful for testing
  // the cap without allocating the full payload in test setup.
  function streamingResponse(chunks: number, chunkSize: number): Response {
    let emitted = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted >= chunks) {
          controller.close()
          return
        }
        controller.enqueue(new Uint8Array(chunkSize).fill(0x61)) // 'a'
        emitted++
      },
    })
    return new Response(stream)
  }

  it('returns text when total bytes are under the cap', async () => {
    // 4 chunks × 256 KiB = 1 MiB total, well under the 5 MiB cap.
    const resp = streamingResponse(4, 256 * 1024)
    const out = await readBodyWithCap(resp, 5 * 1024 * 1024)
    expect(out.length).toBe(4 * 256 * 1024)
  })

  it('aborts mid-stream once cumulative bytes exceed the cap', async () => {
    // Cap = 1 MiB; chunks emit 4 × 256 KiB then would keep going. If
    // the cap check fires on the chunk that pushes the cumulative size
    // past cap, we abort after at most 5 chunks (≈ 1.25 MiB read).
    const cap = 1024 * 1024 // 1 MiB for fast test
    const resp = streamingResponse(20, 256 * 1024) // would be 5 MiB total
    await expect(readBodyWithCap(resp, cap)).rejects.toThrow(/too large/)
  })

  it('aborts as soon as a single oversized chunk lands', async () => {
    // One chunk larger than the cap — must reject without buffering.
    const cap = 1024 // 1 KiB
    const resp = streamingResponse(1, 4 * 1024) // single 4 KiB chunk
    await expect(readBodyWithCap(resp, cap)).rejects.toThrow(/too large/)
  })

  it('decodes UTF-8 across chunk boundaries correctly', async () => {
    // The em dash (—, U+2014) is 3 UTF-8 bytes: 0xE2 0x80 0x94. Split
    // it across two chunks to verify TextDecoder stream-mode stitches
    // it back together instead of emitting replacement characters.
    const chunk1 = new Uint8Array([0xe2, 0x80])
    const chunk2 = new Uint8Array([0x94])
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk1)
        controller.enqueue(chunk2)
        controller.close()
      },
    })
    const out = await readBodyWithCap(new Response(stream), 1024)
    expect(out).toBe('—')
  })
})
