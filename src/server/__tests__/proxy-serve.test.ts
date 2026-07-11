import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { injectBridge, decode, rewriteResponseHeaders } from '../proxy-serve'
import { bridgeClientScript } from '../../plugin/bridge-client'

// The proxy's three pure response transforms — bridge injection, content
// decoding, and header rewriting — carry the whole risk of `annotask serve
// --target`. The request plumbing (piping, overflow, WS tunnel) is exercised
// manually / by the wireframe e2e; these lock down the logic that has actually
// bitten before (the $&/$' String.replace corruption class) and the header
// contract the shell iframe depends on.

describe('proxy-serve: injectBridge', () => {
  it('injects the bridge <script> immediately before </body>', () => {
    const out = injectBridge('<html><body><h1>hi</h1></body></html>')
    expect(out).toContain('__ANNOTASK_BRIDGE__')
    // Injected after the page content, right before the closing body tag.
    expect(out.indexOf('<script>')).toBeGreaterThan(out.indexOf('<h1>'))
    expect(out).toMatch(/<script>[\s\S]*<\/script>\s*<\/body>/)
  })

  it('appends the bridge when the document has no </body>', () => {
    const out = injectBridge('<div>no body tag</div>')
    expect(out.startsWith('<div>no body tag</div>')).toBe(true)
    expect(out).toContain('__ANNOTASK_BRIDGE__')
  })

  it('is idempotent — never double-injects (dedup on the marker)', () => {
    const once = injectBridge('<body></body>')
    const twice = injectBridge(once)
    expect(twice).toBe(once)
    expect(once.match(/__ANNOTASK_BRIDGE__ = true/g) ?? []).toHaveLength(1)
  })

  it('does not corrupt the bridge source via $&/$\' replace-pattern expansion', () => {
    // The bridge source literally contains `$&`, `$'`, and `__reactFiber$`.
    // A plain string replacement would expand those special patterns and
    // mangle the injected script; the function replacer keeps every `$`
    // verbatim. Containing the full script proves no expansion happened.
    const script = bridgeClientScript()
    expect(script).toContain('__reactFiber$') // guard the fixture assumption
    const out = injectBridge('<body></body>')
    expect(out).toContain(script)
    expect(out).toContain('__reactFiber$')
  })
})

describe('proxy-serve: decode', () => {
  const body = Buffer.from('<body>hello</body>', 'utf-8')

  it('round-trips gzip / deflate / br / identity / empty encoding', () => {
    expect(decode(zlib.gzipSync(body), 'gzip')?.toString()).toBe('<body>hello</body>')
    expect(decode(zlib.deflateSync(body), 'deflate')?.toString()).toBe('<body>hello</body>')
    expect(decode(zlib.brotliCompressSync(body), 'br')?.toString()).toBe('<body>hello</body>')
    expect(decode(body, 'identity')?.toString()).toBe('<body>hello</body>')
    expect(decode(body, '')?.toString()).toBe('<body>hello</body>')
  })

  it('returns null for an undecodable encoding so the caller passes it through raw', () => {
    expect(decode(body, 'zstd')).toBeNull() // unknown codec
    expect(decode(Buffer.from('not-actually-gzip'), 'gzip')).toBeNull() // corrupt stream
  })
})

describe('proxy-serve: rewriteResponseHeaders', () => {
  const origin = 'https://app.example.com'

  it('strips CSP / CSP-report-only / X-Frame-Options and hop-by-hop headers', () => {
    const out = rewriteResponseHeaders({
      'content-type': 'text/html',
      'content-security-policy': "default-src 'self'",
      'content-security-policy-report-only': "default-src 'self'",
      'x-frame-options': 'DENY',
      connection: 'keep-alive',
      'transfer-encoding': 'chunked',
    }, origin)
    expect(out['content-type']).toBe('text/html')
    expect(out['content-security-policy']).toBeUndefined()
    expect(out['content-security-policy-report-only']).toBeUndefined()
    expect(out['x-frame-options']).toBeUndefined()
    expect(out.connection).toBeUndefined()
    expect(out['transfer-encoding']).toBeUndefined()
  })

  it('rewrites an absolute same-origin redirect Location back onto the proxy', () => {
    expect(rewriteResponseHeaders({ location: `${origin}/dashboard` }, origin).location).toBe('/dashboard')
  })

  it('rewrites a bare same-origin Location to /', () => {
    expect(rewriteResponseHeaders({ location: origin }, origin).location).toBe('/')
  })

  it('leaves a cross-origin Location untouched', () => {
    const loc = 'https://other.example.com/x'
    expect(rewriteResponseHeaders({ location: loc }, origin).location).toBe(loc)
  })
})
