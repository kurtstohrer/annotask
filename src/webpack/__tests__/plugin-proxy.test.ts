import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AnnotaskWebpackPlugin } from '../plugin.js'

// The plugin starts the standalone server from a compile hook — mock it so
// invoking the tapped callback in tests never binds a real port.
vi.mock('../../server/standalone.js', () => ({
  startStandaloneServer: vi.fn(async () => ({ port: 24678, close: async () => {} })),
}))
vi.mock('../../server/discovery.js', () => ({
  writeMfeServerInfo: vi.fn(),
}))

import { startStandaloneServer } from '../../server/standalone.js'

interface FakeCompiler {
  context: string
  options: any
  hooks: {
    beforeCompile: { tapPromise: (name: string, fn: () => Promise<void>) => void }
    compilation: { tap: (name: string, fn: (compilation: any) => void) => void }
  }
}

/** Minimal compiler stub covering everything apply() touches. */
function fakeCompiler(devServer?: any): FakeCompiler & { beforeCompileTaps: Array<() => Promise<void>> } {
  const beforeCompileTaps: Array<() => Promise<void>> = []
  return {
    context: '/tmp/fake-project',
    options: {
      mode: 'development',
      module: { rules: [] },
      plugins: [],
      ...(devServer !== undefined ? { devServer } : {}),
    },
    hooks: {
      beforeCompile: { tapPromise: (_name, fn) => { beforeCompileTaps.push(fn) } },
      compilation: { tap: () => {} },
    },
    beforeCompileTaps,
  }
}

const ANNOTASK_RULE = { context: ['/__annotask'], target: 'http://127.0.0.1:24678', ws: true }

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(startStandaloneServer).mockResolvedValue({ port: 24678, close: async () => {} })
})

describe('AnnotaskWebpackPlugin devServer proxy injection', () => {
  it('injects the proxy synchronously during apply() when devServer is undefined', () => {
    const compiler = fakeCompiler()
    new AnnotaskWebpackPlugin().apply(compiler)

    // Must be set before any compile hook runs — webpack-cli snapshots
    // devServer options right after createCompiler.
    expect(compiler.options.devServer.proxy).toEqual([ANNOTASK_RULE])
  })

  it('prepends to an existing user proxy array (v5 form), preserving user entries', () => {
    const userRule = { context: ['/api'], target: 'http://localhost:9000' }
    const compiler = fakeCompiler({ port: 8090, proxy: [userRule] })
    new AnnotaskWebpackPlugin().apply(compiler)

    expect(compiler.options.devServer.proxy).toEqual([ANNOTASK_RULE, userRule])
    expect(compiler.options.devServer.port).toBe(8090)
  })

  it('adds a keyed entry to the v4 legacy object form without converting it', () => {
    const compiler = fakeCompiler({ proxy: { '/api': { target: 'http://localhost:9000' } } })
    new AnnotaskWebpackPlugin().apply(compiler)

    const proxy = compiler.options.devServer.proxy
    expect(Array.isArray(proxy)).toBe(false)
    expect(proxy['/api']).toEqual({ target: 'http://localhost:9000' })
    expect(proxy['/__annotask']).toEqual({ target: 'http://127.0.0.1:24678', ws: true })
  })

  it('uses the configured port in the proxy target', () => {
    const compiler = fakeCompiler()
    new AnnotaskWebpackPlugin({ port: 30001 }).apply(compiler)

    expect(compiler.options.devServer.proxy).toEqual([
      { context: ['/__annotask'], target: 'http://127.0.0.1:30001', ws: true },
    ])
  })

  it('does not duplicate the rule when one already covers /__annotask', () => {
    const compiler = fakeCompiler({ proxy: [ANNOTASK_RULE] })
    new AnnotaskWebpackPlugin().apply(compiler)

    expect(compiler.options.devServer.proxy).toEqual([ANNOTASK_RULE])
  })

  it('does nothing outside development mode', () => {
    const compiler = fakeCompiler()
    compiler.options.mode = 'production'
    new AnnotaskWebpackPlugin().apply(compiler)

    expect(compiler.options.devServer).toBeUndefined()
  })

  it('does not inject a proxy when the remote server option is set', () => {
    const compiler = fakeCompiler()
    new AnnotaskWebpackPlugin({ server: 'http://localhost:5173' }).apply(compiler)

    expect(compiler.options.devServer).toBeUndefined()
  })

  it('warns with the manual proxy block when devServer options are frozen', () => {
    const compiler = fakeCompiler(Object.freeze({ port: 8090 }))
    new AnnotaskWebpackPlugin().apply(compiler)

    expect(compiler.options.devServer.proxy).toBeUndefined()
    const warning = vi.mocked(console.warn).mock.calls.map(args => args.join(' ')).join('\n')
    expect(warning).toContain('Could not auto-inject the /__annotask proxy')
    expect(warning).toContain("context: ['/__annotask']")
    expect(warning).toContain('http://127.0.0.1:24678')
  })

  it('re-points the proxy in place when the server falls back to another port', async () => {
    vi.mocked(startStandaloneServer).mockResolvedValue({ port: 51234, close: async () => {} })
    const compiler = fakeCompiler()
    new AnnotaskWebpackPlugin().apply(compiler)

    // Proxy target is the expected port at apply() time (server hasn't bound yet)…
    expect(compiler.options.devServer.proxy).toEqual([ANNOTASK_RULE])

    // …then the server lands elsewhere (EADDRINUSE fallback). The rule object
    // reference survives devServer's apply()-time shallow snapshot, so we
    // mutate its `target` in place to the actual bound port (findings P0-6:
    // the webpack proxy target was frozen at apply()-time).
    expect(compiler.beforeCompileTaps).toHaveLength(1)
    await compiler.beforeCompileTaps[0]()

    expect(compiler.options.devServer.proxy[0].target).toBe('http://127.0.0.1:51234')

    const warning = vi.mocked(console.warn).mock.calls.map(args => args.join(' ')).join('\n')
    expect(warning).toContain('24678')
    expect(warning).toContain('51234')
  })

  it('does not warn when the server starts on the expected port', async () => {
    const compiler = fakeCompiler()
    new AnnotaskWebpackPlugin().apply(compiler)
    await compiler.beforeCompileTaps[0]()

    expect(console.warn).not.toHaveBeenCalled()
    expect(compiler.options.devServer.proxy).toEqual([ANNOTASK_RULE])
  })
})
