import { describe, it, expect, afterEach } from 'vitest'
import { JSDOM } from 'jsdom'
import { bridgeWireframeWalker } from '../wireframe-walker'

/**
 * The wireframe block-discovery walker (src/plugin/bridge/wireframe-walker.ts)
 * is emitted as a vanilla-JS string into the bridge IIFE. These tests eval that
 * EXACT string in a jsdom window (the same approach as bridge-origin) and drive
 * discoverBlocks() against synthetic DOMs — so the MFE-aware descent and the
 * byte-identical legacy fallback are mechanically checked, not eyeballed.
 *
 * jsdom returns zeros from getBoundingClientRect, so each element built via el()
 * carries a __rect the prototype override returns; getComputedStyle, the source
 * resolvers, and getEid are stubbed to mirror registry.ts exactly.
 */

const openWindows: JSDOM[] = []
afterEach(() => { while (openWindows.length) openWindows.pop()!.window.close() })

interface Meta { eid: string; file: string; line: string; component: string; source_tag: string; tag: string; cls: string; role: string; mfe?: string; rect: { x: number; y: number; width: number; height: number }; dataUrl: null }
interface Disc { blocks: Array<{ el: any; meta: Meta }>; truncated: boolean }
type DiscoverFn = (root: any, deps: any, opts?: { mfeDescentEnabled?: boolean }) => Disc

function makeWindow(): any {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:5173/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  openWindows.push(dom)
  const win = dom.window as any
  // jsdom getBoundingClientRect is always zero — return the element's authored
  // __rect so wfQualifies / footprint / height-unwrap logic has real geometry.
  win.Element.prototype.getBoundingClientRect = function () {
    return this.__rect || { x: 0, y: 0, width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 }
  }
  win.eval(bridgeWireframeWalker() + '\n;window.__discoverBlocks = discoverBlocks;')
  return win
}

function makeDeps(): any {
  const eids = new WeakMap<any, string>()
  let n = 0
  return {
    getComputedStyle(el: any) {
      return { display: el.style?.display || 'block', visibility: el.style?.visibility || 'visible' }
    },
    findSourceElement(el: any) {
      let c = el
      while (c) {
        if (c.getAttribute && c.getAttribute('data-annotask-file')) return { sourceEl: c, targetEl: el }
        c = c.parentElement
      }
      return { sourceEl: el, targetEl: el }
    },
    getSourceData(el: any) {
      const g = (k: string) => (el.getAttribute && el.getAttribute(k)) || ''
      return {
        file: g('data-annotask-file'), line: g('data-annotask-line'),
        component: g('data-annotask-component'), source_tag: g('data-annotask-source-tag'),
        mfe: g('data-annotask-mfe'),
      }
    },
    getEid(el: any) {
      let id = eids.get(el)
      if (!id) { id = 'eid-' + (++n); eids.set(el, id) }
      return id
    },
  }
}

interface ElOpts { id?: string; cls?: string; attrs?: Record<string, string>; rect?: [number, number, number, number] }
function el(win: any, tag: string, opts: ElOpts = {}, children: any[] = []): any {
  const e = win.document.createElement(tag)
  if (opts.id) e.id = opts.id
  if (opts.cls) e.className = opts.cls
  for (const [k, v] of Object.entries(opts.attrs || {})) e.setAttribute(k, v)
  const [x, y, w, h] = opts.rect || [0, 0, 400, 300]
  e.__rect = { x, y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h }
  for (const c of children) e.appendChild(c)
  return e
}
/** A stamped MFE element (carries data-annotask-* the way the plugin emits). */
function mfeEl(win: any, tag: string, mfe: string, file: string, line: string, rect: [number, number, number, number], children: any[] = []): any {
  return el(win, tag, { attrs: { 'data-annotask-mfe': mfe, 'data-annotask-file': file, 'data-annotask-line': line, 'data-annotask-component': file.split('/').pop()!.replace(/\.\w+$/, '') }, rect }, children)
}
function mount(win: any, root: any): void { win.document.body.appendChild(root) }

describe('wireframe walker — legacy (non-MFE) path', () => {
  it('descent ON === descent OFF when there are no MFE regions (byte-identical block set)', () => {
    const win = makeWindow()
    const discover: DiscoverFn = win.__discoverBlocks
    const deps = makeDeps()
    const page = el(win, 'main', { rect: [0, 0, 800, 900] }, [
      el(win, 'section', { cls: 'hero', attrs: { 'data-annotask-file': 'src/App.vue', 'data-annotask-line': '3' }, rect: [0, 0, 800, 300] }),
      el(win, 'section', { cls: 'body', attrs: { 'data-annotask-file': 'src/App.vue', 'data-annotask-line': '9' }, rect: [0, 300, 800, 300] }),
      el(win, 'section', { cls: 'foot', attrs: { 'data-annotask-file': 'src/App.vue', 'data-annotask-line': '15' }, rect: [0, 600, 800, 300] }),
    ])
    mount(win, page)

    const on = discover(win.document.body, deps, { mfeDescentEnabled: true })
    const off = discover(win.document.body, deps, { mfeDescentEnabled: false })

    expect(on.blocks.length).toBe(3)
    const norm = (d: Disc) => d.blocks.map((b) => ({ eid: b.meta.eid, file: b.meta.file, line: b.meta.line, role: b.meta.role, hasMfe: 'mfe' in b.meta }))
    expect(norm(on)).toEqual(norm(off))
    // No mfe field leaks onto a non-MFE page.
    expect(on.blocks.every((b) => !('mfe' in b.meta))).toBe(true)
  })
})

describe('wireframe walker — single-spa MFE descent', () => {
  // Two sibling MFE mounts in a flex row — the real single-spa layout, and the
  // case the legacy walker can't crack: the row is a MULTI-child level so the
  // content-root unwrap stops there and each mount becomes one opaque block.
  function singleSpaPage(win: any) {
    const mountA = el(win, 'div', {
      id: 'single-spa-application:@stress/react-workflows',
      attrs: { 'data-annotask-file': 'src/App.vue', 'data-annotask-line': '40', 'data-annotask-component': 'App' }, // HOST glue
      rect: [0, 0, 400, 900],
    }, [
      mfeEl(win, 'div', 'react-workflows', 'src/App.tsx', '1', [0, 0, 400, 900], [
        mfeEl(win, 'section', 'react-workflows', 'src/Board.tsx', '5', [0, 0, 400, 300]),
        mfeEl(win, 'section', 'react-workflows', 'src/Queue.tsx', '5', [0, 300, 400, 300]),
        mfeEl(win, 'section', 'react-workflows', 'src/Detail.tsx', '5', [0, 600, 400, 300]),
      ]),
    ])
    const mountB = el(win, 'div', {
      id: 'single-spa-application:@stress/vue-data-lab',
      attrs: { 'data-annotask-file': 'src/App.vue', 'data-annotask-line': '41', 'data-annotask-component': 'App' }, // HOST glue
      rect: [400, 0, 400, 900],
    }, [
      mfeEl(win, 'div', 'vue-data-lab', 'src/Main.vue', '1', [400, 0, 400, 900], [
        mfeEl(win, 'section', 'vue-data-lab', 'src/Chart.vue', '5', [400, 0, 400, 450]),
        mfeEl(win, 'section', 'vue-data-lab', 'src/Table.vue', '5', [400, 450, 400, 450]),
      ]),
    ])
    return el(win, 'main', { rect: [0, 0, 800, 900] }, [el(win, 'div', { cls: 'row', rect: [0, 0, 800, 900] }, [mountA, mountB])])
  }

  it('descends each sibling mount into per-section blocks anchored to its own MFE source', () => {
    const win = makeWindow(); const discover: DiscoverFn = win.__discoverBlocks; const deps = makeDeps()
    mount(win, singleSpaPage(win))

    const r = discover(win.document.body, deps, { mfeDescentEnabled: true })
    const files = r.blocks.map((b) => b.meta.file)
    expect(files).toEqual(expect.arrayContaining(['src/Board.tsx', 'src/Queue.tsx', 'src/Detail.tsx', 'src/Chart.vue', 'src/Table.vue']))
    // Each block anchors to its OWN MFE, never the host shell file.
    expect(r.blocks.every((b) => b.meta.file !== 'src/App.vue')).toBe(true)
    expect(r.blocks.filter((b) => b.meta.mfe === 'react-workflows').length).toBe(3)
    expect(r.blocks.filter((b) => b.meta.mfe === 'vue-data-lab').length).toBe(2)
    expect(r.blocks.length).toBe(5)
  })

  it('descent OFF collapses each mount to one opaque host-anchored block (the bug)', () => {
    const win = makeWindow(); const discover: DiscoverFn = win.__discoverBlocks; const deps = makeDeps()
    mount(win, singleSpaPage(win))

    const r = discover(win.document.body, deps, { mfeDescentEnabled: false })
    expect(r.blocks.length).toBe(2)
    expect(r.blocks.every((b) => b.meta.file === 'src/App.vue')).toBe(true) // host glue anchor
    expect(r.blocks.every((b) => !('mfe' in b.meta))).toBe(true)
  })
})

describe('wireframe walker — anchoring edge cases', () => {
  it('resolves DOWN past an uninstrumented wrapper to the MFE-stamped descendant', () => {
    const win = makeWindow(); const discover: DiscoverFn = win.__discoverBlocks; const deps = makeDeps()
    const mountDiv = el(win, 'div', {
      id: 'single-spa-application:@x/lab',
      attrs: { 'data-annotask-file': 'host/Shell.vue', 'data-annotask-line': '1' }, // HOST glue
      rect: [0, 0, 600, 800],
    }, [
      // Two uninstrumented wrappers, then the stamped MFE content.
      el(win, 'div', { rect: [0, 0, 600, 800] }, [
        el(win, 'div', { cls: 'card', rect: [0, 0, 600, 300] }, [
          mfeEl(win, 'h2', 'lab', 'src/Card.tsx', '12', [0, 0, 600, 300]),
        ]),
        el(win, 'div', { cls: 'card', rect: [0, 300, 600, 300] }, [
          mfeEl(win, 'h2', 'lab', 'src/Card.tsx', '40', [0, 300, 600, 300]),
        ]),
      ]),
    ])
    mount(win, el(win, 'main', { rect: [0, 0, 600, 800] }, [mountDiv]))

    const r = discover(win.document.body, deps, { mfeDescentEnabled: true })
    expect(r.blocks.length).toBeGreaterThanOrEqual(2)
    // The block elements are the uninstrumented .card wrappers — anchor must
    // resolve DOWN to the stamped <h2>, never up to the host Shell.vue.
    expect(r.blocks.every((b) => b.meta.file === 'src/Card.tsx')).toBe(true)
    expect(r.blocks.every((b) => b.meta.mfe === 'lab')).toBe(true)
    expect(r.blocks.some((b) => b.meta.file === 'host/Shell.vue')).toBe(false)
  })

  it('pending region (framework mount, no stamped descendant yet) → one honest unanchored block, never the host file', () => {
    const win = makeWindow(); const discover: DiscoverFn = win.__discoverBlocks; const deps = makeDeps()
    const mountDiv = el(win, 'div', {
      id: 'single-spa-application:@x/loading',
      attrs: { 'data-annotask-file': 'host/Shell.vue', 'data-annotask-line': '1' },
      rect: [0, 0, 600, 400],
    }, [ el(win, 'div', { cls: 'spinner', rect: [0, 0, 600, 400] }) ]) // no data-annotask-mfe anywhere inside
    mount(win, el(win, 'main', { rect: [0, 0, 600, 400] }, [mountDiv]))

    const r = discover(win.document.body, deps, { mfeDescentEnabled: true })
    expect(r.blocks.length).toBe(1)
    expect(r.blocks[0].meta.file).toBe('')           // honest unanchored
    expect('mfe' in r.blocks[0].meta).toBe(false)     // region.mfe '' → omitted
  })

  it('an EMPTY inactive mount (no content, host-stamped) emits NO block and is never host-anchored', () => {
    const win = makeWindow(); const discover: DiscoverFn = win.__discoverBlocks; const deps = makeDeps()
    // An inactive single-spa route leaves its mount div in the DOM, empty.
    const emptyMount = el(win, 'div', { id: 'single-spa-application:@x/inactive', attrs: { 'data-annotask-file': 'src/App.vue', 'data-annotask-line': '50' }, rect: [600, 0, 200, 400] })
    const active = el(win, 'section', { attrs: { 'data-annotask-file': 'src/Home.vue', 'data-annotask-line': '4' }, rect: [0, 0, 600, 400] })
    mount(win, el(win, 'main', { rect: [0, 0, 800, 400] }, [active, emptyMount]))

    const r = discover(win.document.body, deps, { mfeDescentEnabled: true })
    // The empty mount is detected (so the page pass can't anchor it to the host
    // src/App.vue) but emits no noise block; only the real page section remains.
    expect(r.blocks.some((b) => b.el === emptyMount)).toBe(false)
    expect(r.blocks.some((b) => b.meta.file === 'src/App.vue')).toBe(false)
    expect(r.blocks.map((b) => b.meta.file)).toEqual(['src/Home.vue'])
  })
})

describe('wireframe walker — chrome vs region', () => {
  it('an <aside> that is an MFE mount decomposes into sub-blocks instead of one opaque chrome block', () => {
    const win = makeWindow(); const discover: DiscoverFn = win.__discoverBlocks; const deps = makeDeps()
    const nav = el(win, 'nav', { attrs: { 'data-annotask-file': 'src/Nav.vue', 'data-annotask-line': '2' }, rect: [0, 0, 800, 60] })
    const main = el(win, 'main', { rect: [0, 60, 600, 800] }, [
      el(win, 'section', { attrs: { 'data-annotask-file': 'src/Home.vue', 'data-annotask-line': '4' }, rect: [0, 60, 600, 800] }),
    ])
    const sidebar = el(win, 'aside', {
      id: 'single-spa-application:@stress/react-sidebar',
      attrs: { 'data-annotask-file': 'src/App.vue', 'data-annotask-line': '70' }, // host glue
      rect: [600, 60, 200, 800],
    }, [
      mfeEl(win, 'div', 'react-sidebar', 'src/Sidebar.tsx', '1', [600, 60, 200, 800], [
        mfeEl(win, 'div', 'react-sidebar', 'src/Widget.tsx', '3', [600, 60, 200, 380]),
        mfeEl(win, 'div', 'react-sidebar', 'src/Widget.tsx', '9', [600, 440, 200, 380]),
      ]),
    ])
    mount(win, el(win, 'div', { rect: [0, 0, 800, 860] }, [nav, main, sidebar]))

    const r = discover(win.document.body, deps, { mfeDescentEnabled: true })
    const sidebarBlocks = r.blocks.filter((b) => b.meta.mfe === 'react-sidebar')
    expect(sidebarBlocks.length).toBe(2)
    expect(sidebarBlocks.every((b) => b.meta.file === 'src/Widget.tsx')).toBe(true)
    // The aside is NOT emitted as one opaque chrome block anchored to the host.
    expect(r.blocks.some((b) => b.el === sidebar)).toBe(false)
    // Nav (non-region chrome) and the page section survive as page blocks.
    expect(r.blocks.some((b) => b.meta.file === 'src/Nav.vue')).toBe(true)
    expect(r.blocks.some((b) => b.meta.file === 'src/Home.vue')).toBe(true)
  })
})

describe('wireframe walker — detection robustness', () => {
  it('children-driven boundary: a plain wrapper (no id convention) with stamped descendants is decomposed (Module Federation)', () => {
    const win = makeWindow(); const discover: DiscoverFn = win.__discoverBlocks; const deps = makeDeps()
    const wrapper = el(win, 'div', { cls: 'mf-remote', rect: [0, 0, 800, 600] }, [
      mfeEl(win, 'div', 'remote-cart', 'src/Cart.tsx', '1', [0, 0, 800, 600], [
        mfeEl(win, 'section', 'remote-cart', 'src/Line.tsx', '2', [0, 0, 800, 300]),
        mfeEl(win, 'section', 'remote-cart', 'src/Total.tsx', '2', [0, 300, 800, 300]),
      ]),
    ])
    mount(win, el(win, 'main', { rect: [0, 0, 800, 600] }, [wrapper]))

    const r = discover(win.document.body, deps, { mfeDescentEnabled: true })
    expect(r.blocks.length).toBe(2)
    expect(r.blocks.every((b) => b.meta.mfe === 'remote-cart')).toBe(true)
  })

  it('an element carrying its OWN data-annotask-mfe is interior, not a boundary (no misfire)', () => {
    const win = makeWindow(); const discover: DiscoverFn = win.__discoverBlocks; const deps = makeDeps()
    // The MFE root itself is stamped; its children are the sections.
    const root = mfeEl(win, 'div', 'app', 'src/App.tsx', '1', [0, 0, 800, 600], [
      mfeEl(win, 'section', 'app', 'src/A.tsx', '2', [0, 0, 800, 300]),
      mfeEl(win, 'section', 'app', 'src/B.tsx', '2', [0, 300, 800, 300]),
    ])
    mount(win, el(win, 'main', { rect: [0, 0, 800, 600] }, [root]))

    const r = discover(win.document.body, deps, { mfeDescentEnabled: true })
    // No double-handling: the sections are the blocks, each correctly anchored.
    expect(r.blocks.length).toBe(2)
    expect(r.blocks.every((b) => b.meta.mfe === 'app')).toBe(true)
    expect(r.blocks.map((b) => b.meta.file).sort()).toEqual(['src/A.tsx', 'src/B.tsx'])
  })

  it('nested MFE: an outer container is not mis-named by an inner MFE stamp', () => {
    const win = makeWindow(); const discover: DiscoverFn = win.__discoverBlocks; const deps = makeDeps()
    const outerMount = el(win, 'div', { id: 'single-spa-application:@x/outer', attrs: { 'data-annotask-file': 'host/S.vue', 'data-annotask-line': '1' }, rect: [0, 0, 800, 800] }, [
      mfeEl(win, 'div', 'outer', 'src/Outer.tsx', '1', [0, 0, 800, 800], [
        mfeEl(win, 'section', 'outer', 'src/OuterA.tsx', '2', [0, 0, 800, 300]),
        // A nested inner MFE mount inside the outer MFE.
        el(win, 'div', { id: 'single-spa-application:@x/inner', attrs: { 'data-annotask-file': 'host/S.vue', 'data-annotask-line': '9' }, rect: [0, 300, 800, 400] }, [
          mfeEl(win, 'div', 'inner', 'src/Inner.tsx', '1', [0, 300, 800, 400]),
        ]),
      ]),
    ])
    mount(win, el(win, 'main', { rect: [0, 0, 800, 800] }, [outerMount]))

    const r = discover(win.document.body, deps, { mfeDescentEnabled: true })
    // The inner stamp must NOT bleed up: the outer container is named 'outer'.
    const outerA = r.blocks.find((b) => b.meta.file === 'src/OuterA.tsx')
    expect(outerA?.meta.mfe).toBe('outer')
    // v1 collects OUTERMOST regions only — the nested inner mount is swept into
    // the outer region as an HONEST unanchored block (file ''), never
    // mis-anchored to the host shell (host/S.vue). Nested decomposition is a
    // documented v1 limitation.
    expect(r.blocks.some((b) => b.meta.file === 'host/S.vue')).toBe(false)
    expect(r.blocks.every((b) => b.meta.mfe !== 'inner' ? true : b.meta.file !== 'host/S.vue')).toBe(true)
  })
})

describe('wireframe walker — per-MFE budget', () => {
  it('splits the block budget so a busy trailing MFE is not dropped by the cap', () => {
    const win = makeWindow(); const discover: DiscoverFn = win.__discoverBlocks; const deps = makeDeps()
    const manySections = (mfe: string, n: number, yBase: number) =>
      Array.from({ length: n }, (_, i) => mfeEl(win, 'section', mfe, `src/${mfe}.tsx`, String(i), [0, yBase + i * 50, 400, 50]))
    const mountA = el(win, 'div', { id: 'single-spa-application:@x/a', attrs: { 'data-annotask-file': 'host/S.vue', 'data-annotask-line': '1' }, rect: [0, 0, 400, 2000] }, [
      mfeEl(win, 'div', 'a', 'src/a.tsx', '0', [0, 0, 400, 2000], manySections('a', 30, 0)),
    ])
    const mountB = el(win, 'div', { id: 'single-spa-application:@x/b', attrs: { 'data-annotask-file': 'host/S.vue', 'data-annotask-line': '2' }, rect: [400, 0, 400, 2000] }, [
      mfeEl(win, 'div', 'b', 'src/b.tsx', '0', [400, 0, 400, 2000], manySections('b', 30, 0)),
    ])
    mount(win, el(win, 'main', { rect: [0, 0, 800, 2000] }, [mountA, mountB]))

    const r = discover(win.document.body, deps, { mfeDescentEnabled: true })
    expect(r.truncated).toBe(true)
    expect(r.blocks.length).toBeLessThanOrEqual(24)
    // Both MFEs represented — neither starved to zero by a flat document slice.
    expect(r.blocks.some((b) => b.meta.mfe === 'a')).toBe(true)
    expect(r.blocks.some((b) => b.meta.mfe === 'b')).toBe(true)
  })
})
