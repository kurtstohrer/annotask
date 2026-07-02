import { describe, it, expect, afterEach } from 'vitest'
import { JSDOM } from 'jsdom'
import { bridgeRegistry } from '../registry'
import { bridgeEvents } from '../events'

/**
 * Native debug-metadata anchors (src/plugin/bridge/registry.ts) and
 * server-fragment stamping (src/plugin/bridge/events.ts) are emitted as
 * vanilla-JS strings into the bridge IIFE. These tests eval those EXACT
 * strings in a jsdom window (the wireframe-walker test approach) and drive
 * the resolver chain / the htmx+Turbo listeners against synthetic DOMs —
 * mechanically checked, not eyeballed.
 *
 * Resolver order under test: data-annotask-* > data-astro-source-* >
 * data-annotask-fragment-url > el.__svelte_meta.loc > React fiber
 * _debugSource. Our own stamps always win.
 */

interface SourceData {
  file: string
  line: string
  component: string
  source_tag: string
  mfe: string
  fragmentUrl?: string
}

const openWindows: JSDOM[] = []
afterEach(() => { while (openWindows.length) openWindows.pop()!.window.close() })

/** Eval the registry fragment alone — resolver-chain tests need no events. */
function makeRegistryWindow(): any {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:5173/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  openWindows.push(dom)
  const win = dom.window as any
  win.eval(bridgeRegistry() + ';window.__t = { getSourceData: getSourceData, findSourceElement: findSourceElement, hasSourceAttr: hasSourceAttr, reactProjectFile: reactProjectFile, getReactDebugSource: getReactDebugSource };')
  return win
}

/** Eval registry + events — the fragment-stamping listeners live in events.
 *  The events fragment's eval-time side effects (style injection, listener
 *  wiring, route poll, color-scheme seed) are all jsdom-safe; the seed's
 *  detectColorScheme call (defined in messages.ts) is wrapped in try/catch. */
function makeEventsWindow(): any {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:5173/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  openWindows.push(dom)
  const win = dom.window as any
  win.eval(bridgeRegistry() + bridgeEvents() + ';window.__t = { getSourceData: getSourceData, findSourceElement: findSourceElement };')
  return win
}

function el(win: any, tag: string, attrs: Record<string, string> = {}, children: any[] = []): any {
  const e = win.document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  for (const c of children) e.appendChild(c)
  return e
}

function resolve(win: any, target: any): SourceData {
  const src = win.__t.findSourceElement(target)
  return win.__t.getSourceData(src.sourceEl)
}

describe('reactProjectFile — absolute fileName → project-usable path', () => {
  const cut = () => makeRegistryWindow().__t.reactProjectFile as (f: string) => string

  it('cuts an absolute path at /src/ keeping src/...', () => {
    expect(cut()('/home/u/proj/src/components/Card.jsx')).toBe('src/components/Card.jsx')
  })

  it('cuts at the LAST /src/ occurrence (monorepo /src/ appearing twice)', () => {
    expect(cut()('/a/src/pkg/src/App.jsx')).toBe('src/App.jsx')
  })

  it('no /src/ segment → honest-empty, never an absolute path', () => {
    expect(cut()('/opt/app/components/Card.jsx')).toBe('')
  })

  it('normalizes Windows backslashes before cutting', () => {
    expect(cut()('C:\\proj\\src\\App.jsx')).toBe('src/App.jsx')
  })

  it('empty/missing fileName → empty', () => {
    expect(cut()('')).toBe('')
    expect(cut()(undefined as any)).toBe('')
  })
})

describe('getSourceData — Svelte __svelte_meta anchors', () => {
  it('resolves file/line from __svelte_meta.loc, component from the basename', () => {
    const win = makeRegistryWindow()
    const node = el(win, 'div')
    node.__svelte_meta = { loc: { file: 'src/lib/Widget.svelte', line: 12, column: 4 } }
    win.document.body.appendChild(node)

    const d = resolve(win, node)
    expect(d.file).toBe('src/lib/Widget.svelte')
    expect(d.line).toBe('12')
    expect(d.component).toBe('Widget')
    expect('fragmentUrl' in d).toBe(false)
  })

  it('our own data-annotask-* stamps win over __svelte_meta', () => {
    const win = makeRegistryWindow()
    const node = el(win, 'div', { 'data-annotask-file': 'src/App.svelte', 'data-annotask-line': '3' })
    node.__svelte_meta = { loc: { file: 'src/Other.svelte', line: 99 } }
    win.document.body.appendChild(node)

    const d = resolve(win, node)
    expect(d.file).toBe('src/App.svelte')
    expect(d.line).toBe('3')
  })

  it('data-astro-source-* wins over __svelte_meta', () => {
    const win = makeRegistryWindow()
    const node = el(win, 'div', { 'data-astro-source-file': '/proj/src/pages/index.astro', 'data-astro-source-loc': '7:2' })
    node.__svelte_meta = { loc: { file: 'src/Other.svelte', line: 99 } }
    win.document.body.appendChild(node)

    const d = resolve(win, node)
    expect(d.file).toBe('src/pages/index.astro')
    expect(d.line).toBe('7')
  })

  it('a stamped ANCESTOR still wins: the walk resolves it before the native fallback runs', () => {
    const win = makeRegistryWindow()
    const inner = el(win, 'span')
    inner.__svelte_meta = { loc: { file: 'src/Inner.svelte', line: 5 } }
    const outer = el(win, 'section', { 'data-annotask-file': 'src/App.svelte', 'data-annotask-line': '10' }, [inner])
    win.document.body.appendChild(outer)

    const d = resolve(win, inner)
    expect(d.file).toBe('src/App.svelte')
    expect(d.line).toBe('10')
  })
})

describe('getSourceData — React fiber anchors', () => {
  it('resolves _debugSource fileName/lineNumber (React <=18), component from the fiber type', () => {
    const win = makeRegistryWindow()
    const node = el(win, 'div')
    function Card() {}
    node['__reactFiber$k3xyz'] = { type: Card, _debugSource: { fileName: '/home/u/proj/src/components/Card.jsx', lineNumber: 7 } }
    win.document.body.appendChild(node)

    const d = resolve(win, node)
    expect(d.file).toBe('src/components/Card.jsx')
    expect(d.line).toBe('7')
    expect(d.component).toBe('Card')
  })

  it('host fiber (string type) names its component via _debugOwner', () => {
    const win = makeRegistryWindow()
    const node = el(win, 'div')
    function Panel() {}
    node['__reactFiber$abc'] = { type: 'div', _debugOwner: { type: Panel }, _debugSource: { fileName: '/x/src/Panel.tsx', lineNumber: 3 } }
    win.document.body.appendChild(node)

    const d = resolve(win, node)
    expect(d.file).toBe('src/Panel.tsx')
    expect(d.component).toBe('Panel')
  })

  it('fileName without /src/ → honest-empty file; component still reported', () => {
    const win = makeRegistryWindow()
    const node = el(win, 'div')
    function Card() {}
    node['__reactFiber$abc'] = { type: Card, _debugSource: { fileName: '/opt/app/components/Card.jsx', lineNumber: 7 } }
    win.document.body.appendChild(node)

    const d = resolve(win, node)
    expect(d.file).toBe('')
    expect(d.line).toBe('')
    expect(d.component).toBe('Card')
  })

  it('React 19 (no _debugSource): no fabricated file, display name only', () => {
    const win = makeRegistryWindow()
    const node = el(win, 'div')
    const Memoish = { displayName: 'FancyList' }
    node['__reactFiber$r19'] = { type: Memoish }
    win.document.body.appendChild(node)

    const d = resolve(win, node)
    expect(d.file).toBe('')
    expect(d.component).toBe('FancyList')
  })

  it('__svelte_meta beats the React fiber (chain order)', () => {
    const win = makeRegistryWindow()
    const node = el(win, 'div')
    node.__svelte_meta = { loc: { file: 'src/Widget.svelte', line: 2 } }
    function Card() {}
    node['__reactFiber$abc'] = { type: Card, _debugSource: { fileName: '/x/src/Card.jsx', lineNumber: 9 } }
    win.document.body.appendChild(node)

    expect(resolve(win, node).file).toBe('src/Widget.svelte')
  })

  it('no metadata anywhere → unchanged empty shape (no fragmentUrl key)', () => {
    const win = makeRegistryWindow()
    const node = el(win, 'div')
    win.document.body.appendChild(node)

    const d = resolve(win, node)
    expect(d).toEqual({ file: '', line: '', component: '', source_tag: '', mfe: '' })
  })
})

describe('getSourceData — fragment-url anchors (registry side)', () => {
  it('fragment root found BEFORE a file-bearing ancestor → empty-file shape PLUS fragmentUrl', () => {
    const win = makeRegistryWindow()
    const child = el(win, 'span')
    const fragRoot = el(win, 'div', { 'data-annotask-fragment-url': 'POST /search' }, [child])
    const page = el(win, 'main', { 'data-annotask-file': 'index.html', 'data-annotask-line': '20' }, [fragRoot])
    win.document.body.appendChild(page)

    expect(win.__t.hasSourceAttr(fragRoot)).toBe(true)
    const src = win.__t.findSourceElement(child)
    expect(src.sourceEl).toBe(fragRoot) // walk stops at the swap root, not index.html
    const d = win.__t.getSourceData(src.sourceEl)
    expect(d.file).toBe('')
    expect(d.line).toBe('')
    expect(d.component).toBe('')
    expect(d.fragmentUrl).toBe('POST /search')
  })

  it('a file-bearing anchor BELOW the fragment root wins (found first on the walk up)', () => {
    const win = makeRegistryWindow()
    const child = el(win, 'span')
    const stamped = el(win, 'div', { 'data-annotask-file': 'src/Row.vue', 'data-annotask-line': '4' }, [child])
    const fragRoot = el(win, 'div', { 'data-annotask-fragment-url': 'GET /rows' }, [stamped])
    win.document.body.appendChild(fragRoot)

    const d = resolve(win, child)
    expect(d.file).toBe('src/Row.vue')
    expect('fragmentUrl' in d).toBe(false)
  })

  it('same element carrying both file and fragment-url: the file anchor wins', () => {
    const win = makeRegistryWindow()
    const node = el(win, 'div', { 'data-annotask-file': 'src/List.vue', 'data-annotask-line': '2', 'data-annotask-fragment-url': 'GET /list' })
    win.document.body.appendChild(node)

    const d = resolve(win, node)
    expect(d.file).toBe('src/List.vue')
    expect('fragmentUrl' in d).toBe(false)
  })

  it('fragment root suppresses the native fallbacks (server markup has no framework meta)', () => {
    const win = makeRegistryWindow()
    const node = el(win, 'div', { 'data-annotask-fragment-url': 'POST /search' })
    node.__svelte_meta = { loc: { file: 'src/Wrong.svelte', line: 1 } } // pathological — must not win
    win.document.body.appendChild(node)

    const d = resolve(win, node)
    expect(d.file).toBe('')
    expect(d.fragmentUrl).toBe('POST /search')
  })
})

describe('events — htmx/Turbo fragment stamping', () => {
  function dispatch(win: any, type: string, target: any, detail?: any): void {
    target.dispatchEvent(new win.CustomEvent(type, { detail, bubbles: true }))
  }

  it('htmx:afterSwap stamps detail.target with the uppercased verb + requestPath pathname (query dropped)', () => {
    const win = makeEventsWindow()
    const target = el(win, 'div')
    win.document.body.appendChild(target)

    dispatch(win, 'htmx:afterSwap', win.document, {
      target,
      pathInfo: { requestPath: '/search?q=x' },
      requestConfig: { verb: 'post' },
    })
    expect(target.getAttribute('data-annotask-fragment-url')).toBe('POST /search')
  })

  it('falls back to xhr.responseURL pathname and to GET when no verb', () => {
    const win = makeEventsWindow()
    const target = el(win, 'div')
    win.document.body.appendChild(target)

    dispatch(win, 'htmx:afterSwap', win.document, {
      target,
      xhr: { responseURL: 'http://localhost:5173/items/2?tab=a' },
    })
    expect(target.getAttribute('data-annotask-fragment-url')).toBe('GET /items/2')
  })

  it('uses event.target when detail carries no target (event bubbles from the swap root)', () => {
    const win = makeEventsWindow()
    const target = el(win, 'div')
    win.document.body.appendChild(target)

    dispatch(win, 'htmx:afterSwap', target, { pathInfo: { requestPath: '/frag' } })
    expect(target.getAttribute('data-annotask-fragment-url')).toBe('GET /frag')
  })

  it('no resolvable path → nothing stamped', () => {
    const win = makeEventsWindow()
    const target = el(win, 'div')
    win.document.body.appendChild(target)

    dispatch(win, 'htmx:afterSwap', win.document, { target })
    expect(target.hasAttribute('data-annotask-fragment-url')).toBe(false)
  })

  it("turbo:frame-render stamps the frame with GET + its src pathname", () => {
    const win = makeEventsWindow()
    const frame = el(win, 'turbo-frame', { src: '/messages?page=2' })
    win.document.body.appendChild(frame)

    dispatch(win, 'turbo:frame-render', frame)
    expect(frame.getAttribute('data-annotask-fragment-url')).toBe('GET /messages')
  })

  it('turbo frame without src → nothing stamped', () => {
    const win = makeEventsWindow()
    const frame = el(win, 'turbo-frame')
    win.document.body.appendChild(frame)

    dispatch(win, 'turbo:frame-render', frame)
    expect(frame.hasAttribute('data-annotask-fragment-url')).toBe(false)
  })

  it('end-to-end: a click target inside the swapped subtree resolves to the fragmentUrl', () => {
    const win = makeEventsWindow()
    const child = el(win, 'button')
    const target = el(win, 'div', {}, [child])
    const page = el(win, 'main', { 'data-annotask-file': 'index.html', 'data-annotask-line': '8' }, [target])
    win.document.body.appendChild(page)

    dispatch(win, 'htmx:afterSwap', win.document, {
      target,
      pathInfo: { requestPath: '/search' },
      requestConfig: { verb: 'POST' },
    })
    const d = resolve(win, child)
    expect(d.file).toBe('')
    expect(d.fragmentUrl).toBe('POST /search')
  })
})
