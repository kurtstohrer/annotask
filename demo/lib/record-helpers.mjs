/**
 * Shared helpers for demo recording scripts (plain ESM — runs with `node`).
 *
 * Cursor: testreel's post-composited cursor can't track real-mouse drags
 * (its standalone moveCursorToPoint feeds a module-global tracker that
 * recordPage never serializes), so we inject a LIVE DOM cursor overlay
 * instead — a dot + click ripple recorded straight into the video. It is
 * driven from script coordinates, so drags and iframe interactions track
 * exactly.
 *
 * DEMO_SMOKE=1 → headless, no video, zero waits, cursor inert.
 */

export const SMOKE = process.env.DEMO_SMOKE === '1'

/** ms helper — collapses to 0 in smoke mode. */
export const W = (ms) => (SMOKE ? 0 : ms)

export async function sleep(page, ms) {
  if (ms > 0) await page.waitForTimeout(ms)
}

// ── Live cursor overlay ──────────────────────────────────────────────────

export async function injectCursor(page) {
  if (SMOKE) return
  await page.evaluate(() => {
    if (document.getElementById('__demoCursor')) return
    const d = document.createElement('div')
    d.id = '__demoCursor'
    Object.assign(d.style, {
      position: 'fixed', left: '-60px', top: '-60px',
      width: '22px', height: '22px', borderRadius: '50%',
      background: 'rgba(59,130,246,0.95)',
      border: '2px solid rgba(255,255,255,0.92)',
      boxShadow: '0 0 14px rgba(59,130,246,0.75)',
      zIndex: '2147483647', pointerEvents: 'none',
      transform: 'translate(-50%,-50%)',
      transition: 'left 0ms linear, top 0ms linear',
    })
    document.body.appendChild(d)
    window.__demoCursor = {
      move(x, y, ms, ease) {
        const e = ease || 'cubic-bezier(.22,.61,.36,1)'
        d.style.transition = `left ${ms}ms ${e}, top ${ms}ms ${e}`
        d.style.left = `${x}px`
        d.style.top = `${y}px`
      },
      ripple() {
        const r = document.createElement('div')
        Object.assign(r.style, {
          position: 'fixed', left: d.style.left, top: d.style.top,
          width: '12px', height: '12px', borderRadius: '50%',
          border: '3px solid rgba(59,130,246,0.8)',
          transform: 'translate(-50%,-50%)',
          zIndex: '2147483646', pointerEvents: 'none',
          transition: 'width 450ms ease-out, height 450ms ease-out, opacity 450ms ease-out',
          opacity: '1',
        })
        document.body.appendChild(r)
        requestAnimationFrame(() => {
          r.style.width = '84px'
          r.style.height = '84px'
          r.style.opacity = '0'
        })
        setTimeout(() => r.remove(), 600)
      },
    }
  })
}

/** Distance-scaled transition time, same curve testreel uses. */
function flightMs(from, to) {
  const d = Math.hypot(to.x - from.x, to.y - from.y)
  return Math.max(120, Math.min(650, (d / 500) * 1000))
}

let lastPoint = { x: 0, y: 0 }

export async function cursorMoveTo(page, x, y, opts = {}) {
  const ms = opts.ms ?? flightMs(lastPoint, { x, y })
  lastPoint = { x, y }
  if (SMOKE) return
  await page.evaluate(([px, py, pms, ease]) => window.__demoCursor?.move(px, py, pms, ease), [x, y, ms, opts.ease ?? null])
  await sleep(page, ms + 60)
}

async function resolvePoint(target, position) {
  const box = await target.boundingBox()
  if (!box) throw new Error('cursor target has no bounding box')
  return position
    ? { x: box.x + position.x, y: box.y + position.y }
    : { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * Click with cursor flight + ripple. `target` is a Locator.
 *
 * Default: Playwright's locator.click() — actionability-checked, retries
 * while the element settles (a raw coordinate click can land on a stale
 * bounding box mid-render and silently hit the wrong thing).
 * opts.raw: raw mouse click at the resolved point — for canvas blocks,
 * where overlap is expected and actionability checks would refuse.
 */
export async function cursorClick(page, target, opts = {}) {
  await target.waitFor({ state: 'visible', timeout: opts.timeout ?? 10_000 })
  const p = await resolvePoint(target, opts.position)
  await cursorMoveTo(page, p.x, p.y)
  if (!SMOKE) {
    await page.evaluate(() => window.__demoCursor?.ripple())
    await sleep(page, 90)
  }
  if (opts.raw) {
    await page.mouse.click(p.x, p.y)
  } else {
    await target.click({ ...(opts.position ? { position: opts.position } : {}), timeout: opts.timeout ?? 10_000 })
  }
  await sleep(page, W(opts.settle ?? 350))
}

/** Hover with cursor flight. */
export async function cursorHover(page, target, opts = {}) {
  await target.waitFor({ state: 'visible', timeout: opts.timeout ?? 10_000 })
  const p = await resolvePoint(target, opts.position)
  await cursorMoveTo(page, p.x, p.y)
  await page.mouse.move(p.x, p.y)
  await sleep(page, W(opts.settle ?? 250))
}

/** Click then type character-by-character. */
export async function cursorType(page, target, text, opts = {}) {
  await cursorClick(page, target, opts)
  await page.keyboard.type(text, { delay: SMOKE ? 0 : (opts.delay ?? 45) })
  await sleep(page, W(250))
}

/**
 * Real-mouse drag with the cursor dot tracking every step.
 * from/to are viewport points.
 */
export async function cursorDrag(page, from, to, opts = {}) {
  const steps = opts.steps ?? 18
  const stepMs = SMOKE ? 0 : (opts.stepMs ?? 40)
  await cursorMoveTo(page, from.x, from.y)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await sleep(page, W(120))
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps
    const y = from.y + ((to.y - from.y) * i) / steps
    await page.mouse.move(x, y, { steps: 2 })
    if (!SMOKE) await page.evaluate(([px, py, pms]) => window.__demoCursor?.move(px, py, pms, 'linear'), [x, y, stepMs])
    await sleep(page, stepMs)
  }
  lastPoint = { ...to }
  await sleep(page, W(150))
  await page.mouse.up()
  await sleep(page, W(opts.settle ?? 400))
}

// ── Shell boot / wireframe entry (ported from e2e/helpers/design-tool.ts) ──

export async function bootShell(page, origin, opts = {}) {
  await page.addInitScript(({ route, providerSeed }) => {
    localStorage.setItem('annotask:shellView', 'design')
    localStorage.setItem('annotask:designSection', 'inspector')
    localStorage.setItem('annotask:lastRoute', route)
    localStorage.setItem('annotask:activePanel', 'tasks')
    localStorage.setItem('annotask:mode', 'select')
    if (providerSeed) localStorage.setItem('annotask:ai:providerSettings', JSON.stringify(providerSeed))
  }, { route: opts.route ?? '/', providerSeed: opts.providerSeed ?? null })
  // networkidle never fires (shell WebSocket) — domcontentloaded + settle.
  await page.goto(`${origin}/__annotask/`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.locator('.toolbar').waitFor({ state: 'visible', timeout: 15_000 })
  await sleep(page, SMOKE ? 800 : 1500)
}

export async function enterWireframeMode(page) {
  await cursorClick(page, page.locator('[data-testid="tool-wireframe"]'))
  await page.locator('[data-testid="wireframe-canvas"]').waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator('.wf-block').first().waitFor({ state: 'visible', timeout: 60_000 })
  await sleep(page, 500)
}

// ── API polling gates ────────────────────────────────────────────────────

export async function pollJson(url, predicate, { timeout = 15_000, interval = 500, label = url } = {}) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      last = await res.json()
      const v = predicate(last)
      if (v) return v === true ? last : v
    } catch { /* server hiccup — retry */ }
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`pollJson timeout: ${label}\nlast: ${JSON.stringify(last)?.slice(0, 800)}`)
}

export async function getCanvas(origin, route = '/') {
  const wf = await (await fetch(`${origin}/__annotask/api/wireframe`)).json()
  return wf.routes?.find((r) => r.route === route)?.canvas ?? null
}

// ── Segment markers ──────────────────────────────────────────────────────

export function createMarkers() {
  const t0 = Date.now()
  const list = []
  return {
    mark(name) {
      const t = (Date.now() - t0) / 1000
      list.push({ name, t: Math.round(t * 10) / 10 })
      console.log(`▸ [${t.toFixed(1).padStart(6)}s] ${name}`)
    },
    list: () => list,
  }
}
