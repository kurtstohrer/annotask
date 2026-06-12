/**
 * Annotask Hero Demo — "Freeze. Sketch. Real." — recording script.
 *
 * One continuous take on the marketing playground (:5181): freeze the page
 * into the wireframe canvas, move the demo section above "How it works",
 * widen it, note the hero, draw a "What's new" section bound to the REAL
 * /api/marketing/changelog schema, Implement → live claude-local run →
 * review → accept → reveal → byte-exact undo.
 *
 * Run:
 *   bash scripts/demo-reset-hero.sh && just marketing   # stage
 *   node demo/record-hero.mjs                           # real take (headed)
 *   DEMO_SMOKE=1 node demo/record-hero.mjs              # selector smoke, no agent
 *
 * Segment markers land in demo/segments/hero-markers.json for the
 * voiceover/assembly scripts (see demo/transcript-hero.md).
 */

import { chromium } from '@playwright/test'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import {
  SMOKE, W, sleep, injectCursor, cursorMoveTo, cursorClick, cursorHover,
  cursorType, cursorDrag, bootShell, enterWireframeMode, pollJson, getCanvas,
  createMarkers,
} from './lib/record-helpers.mjs'

const ORIGIN = 'http://localhost:5181'
const API = `${ORIGIN}/__annotask/api`

const NOTE_TEXT = 'Mention the new wireframe mode in the lede — sketch on a frozen snapshot of the live page, and the agent builds it.'
const MD_SPEC = `## What's new
A horizontal strip of compact release cards — version badge, date, headline.
Match the pill/card styling of the rest of the page.
Use the existing fetchChangelog() helper in src/api.js (limit 4).
Place this section just above the "Open source" section.`

async function preflight() {
  const status = await (await fetch(`${API}/status`)).json()
  if (status.status !== 'ok') throw new Error('annotask server not ok on :5181')

  const detect = await (await fetch(`${API}/agent/detect`)).json()
  if (!SMOKE && !(detect['claude-local']?.found && detect['claude-local']?.loggedIn)) {
    throw new Error('claude CLI not installed/logged in — the live agent climax cannot run')
  }

  const shape = await (await fetch(
    `${API}/data-source-shape?name=apiMarketingChangelog&kind=fetch&file=playgrounds/simple/marketing/src/api.js`,
  )).json()
  if (shape.shape_source !== 'api-schema') {
    throw new Error(`changelog shape_source is '${shape.shape_source}' (want api-schema) — fully restart the dev server (negative probe cache is module-level)`)
  }

  const changelog = await (await fetch('http://localhost:8888/api/marketing/changelog?limit=1')).json()
  const version = changelog?.[0]?.version
  if (!version) throw new Error('FastAPI changelog endpoint returned nothing')

  const tasks = (await (await fetch(`${API}/tasks`)).json()).tasks ?? []
  if (tasks.length) throw new Error(`stage not clean: ${tasks.length} task(s) present — run pnpm demo:reset:hero`)
  const wf = await getCanvas(ORIGIN, '/')
  if (wf) throw new Error('stage not clean: a wireframe canvas exists — run pnpm demo:reset:hero')

  return { version }
}

/** Content blocks in top-down original order (13 on the marketing page). */
async function contentBlocks() {
  const canvas = await getCanvas(ORIGIN, '/')
  if (!canvas) throw new Error('no canvas after capture')
  return canvas.blocks
    .filter((b) => b.kind === 'captured')
    .sort((a, b) => (a.originalRect?.y ?? a.rect.y) - (b.originalRect?.y ?? b.rect.y))
}

const blockEl = (page, id) => page.locator(`[data-block-id="${id}"]`)

/** Select a block (raw click — overlap expected) and verify ITS toolbar rendered; one retry.
 *  Raw mouse clicks can't reach off-viewport coordinates, so scroll into view first. */
async function selectBlock(page, id) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const el = blockEl(page, id)
    await el.scrollIntoViewIfNeeded()
    await sleep(page, W(450))
    await cursorClick(page, el, { position: { x: 8, y: 8 }, raw: true })
    const header = el.locator('.wf-block-header')
    if (await header.waitFor({ state: 'visible', timeout: 2_500 }).then(() => true, () => false)) return
  }
  throw new Error(`block ${id} did not select (its toolbar never rendered)`)
}

/** Scroll the canvas and WAIT for it to actually settle (smooth scroll races bbox reads). */
async function scrollCanvas(page, top) {
  const el = page.locator('.wf-scroll')
  await el.evaluate((node, t) => node.scrollTo({ top: t, behavior: 'smooth' }), top)
  let prev = -1
  for (let i = 0; i < 40; i++) {
    await sleep(page, 80)
    const cur = await el.evaluate((node) => node.scrollTop)
    if (cur === prev) break
    prev = cur
  }
  await sleep(page, W(250))
}

async function scrollIframe(page, top) {
  await page.frameLocator('.app-iframe').locator('body')
    .evaluate((_b, t) => window.scrollTo({ top: t, behavior: 'smooth' }), top)
  await sleep(page, SMOKE ? 250 : 1600)
}

/** Synthetic pointer draw on .wf-stage (e2e-proven: skips hit-testing) with the cursor dot tracing it. */
async function drawSection(page, from, to) {
  await cursorMoveTo(page, from.x, from.y)
  const steps = SMOKE ? 2 : 10
  await page.evaluate(({ sx, sy }) => {
    const stageEl = document.querySelector('.wf-stage')
    stageEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: sx, clientY: sy }))
  }, { sx: from.x, sy: from.y })
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps
    const y = from.y + ((to.y - from.y) * i) / steps
    await page.evaluate(({ px, py }) => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: px, clientY: py }))
    }, { px: x, py: y })
    if (!SMOKE) await page.evaluate(([px, py]) => window.__demoCursor?.move(px, py, 50, 'linear'), [x, y])
    await sleep(page, W(50))
  }
  await page.evaluate(({ px, py }) => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: px, clientY: py }))
  }, { px: to.x, py: to.y })
  await sleep(page, W(300))
}

async function tryAction(label, fn) {
  try { await fn() } catch (err) {
    console.warn(`  ⚠ skipped "${label}": ${String(err.message ?? err).split('\n')[0]}`)
  }
}

async function main() {
  console.log(`${SMOKE ? '[SMOKE] ' : ''}hero take starting…`)
  const { version } = await preflight()
  console.log(`  latest changelog version (reveal gate): ${version}`)

  const browser = await chromium.launch({ headless: SMOKE })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
    ...(SMOKE ? {} : {
      recordVideo: { dir: 'demo/segments/_raw', size: { width: 1920, height: 1080 } },
    }),
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  const markers = createMarkers()

  // ── Boot ────────────────────────────────────────────────────────────────
  await bootShell(page, ORIGIN, {
    route: '/',
    providerSeed: {
      activeProvider: 'claude-local',
      embeddedAgentEnabled: true,
      agentMode: 'auto',
      onboardingDismissed: true,
    },
  })
  await injectCursor(page)

  // Stats strip must be live (not "—") before any capture.
  const frame = page.frameLocator('.app-iframe')
  await pollJson(`${API}/status`, () => true, { timeout: 5_000 }) // server warm
  const statDeadline = Date.now() + 20_000
  for (;;) {
    const txt = await frame.locator('.stat-value').first().textContent().catch(() => null)
    if (txt && txt.trim() !== '—') break
    if (Date.now() > statDeadline) throw new Error('stats strip never loaded live values')
    await sleep(page, 400)
  }

  // ── S2: setup / before-state footage ───────────────────────────────────
  markers.mark('s2-setup')
  await sleep(page, W(1500))
  await scrollIframe(page, 2600)
  await scrollIframe(page, 5600)
  await scrollIframe(page, 0)
  await sleep(page, W(800))

  // ── S3: freeze ──────────────────────────────────────────────────────────
  markers.mark('s3-freeze')
  await enterWireframeMode(page)
  await pollJson(`${API}/wireframe`, (wf) => {
    const c = wf.routes?.find((r) => r.route === '/')?.canvas
    return !!(c && c.blocks?.length >= 10 && /\.png$/.test(c.fullImage ?? ''))
  }, { timeout: 30_000, label: 'canvas persisted with ≥10 blocks' })
  const firstImgW = await page.locator('.wf-block img').first().evaluate((el) => el.naturalWidth)
  if (!(firstImgW > 0)) throw new Error('first block PNG did not decode')

  const blocks = await contentBlocks()
  if (blocks.length < 12) throw new Error(`expected ~13 content blocks, got ${blocks.length}`)
  const [, hero, how, demo] = blocks
  const dogfood = blocks[blocks.length - 3]
  const openSource = blocks[blocks.length - 2]
  const footer = blocks[blocks.length - 1]

  // Anchor-chip tour: hero, then demo.
  await selectBlock(page, hero.id)
  await page.locator('[data-testid="wf-anchor-chip"]').waitFor({ state: 'visible', timeout: 5_000 })
  const heroChip = await page.locator('[data-testid="wf-anchor-chip"]').textContent()
  if (!/index\.html:\d+/.test(heroChip ?? '')) throw new Error(`hero anchor chip wrong: ${heroChip}`)
  await sleep(page, W(1800))
  await selectBlock(page, demo.id)
  await sleep(page, W(1500))

  // ── S4: rearrange ───────────────────────────────────────────────────────
  markers.mark('s4-rearrange')

  // Position the canvas so "How it works" tops the view and the demo block's
  // grab strip is visible at the bottom — the whole MOVE fits one gesture.
  {
    const scrollBox = await page.locator('.wf-scroll').boundingBox()
    const scrollTop = await page.locator('.wf-scroll').evaluate((el) => el.scrollTop)
    let howBox = await blockEl(page, how.id).boundingBox()
    await scrollCanvas(page, scrollTop + (howBox.y - scrollBox.y) - 90)
    howBox = await blockEl(page, how.id).boundingBox()
    const demoBox = await blockEl(page, demo.id).boundingBox()
    const grab = { x: demoBox.x + demoBox.width / 2, y: demoBox.y + 10 }
    const drop = { x: grab.x, y: Math.max(scrollBox.y + 40, howBox.y - 20) }
    await cursorDrag(page, grab, drop, { steps: 22, stepMs: 45 })
  }
  await pollJson(`${API}/wireframe`, (wf) => {
    const c = wf.routes?.find((r) => r.route === '/')?.canvas
    const d = c?.blocks.find((b) => b.id === demo.id)
    const h = c?.blocks.find((b) => b.id === how.id)
    return !!(d && h && d.rect.y < h.rect.y)
  }, { timeout: 8_000, label: 'demo block persisted above how-it-works' })
  await sleep(page, W(900))

  // RESIZE: widen the (now z-top) demo block via its SE handle.
  {
    const before = (await contentBlocks()).find((b) => b.id === demo.id).rect.width
    await selectBlock(page, demo.id)
    const handle = await page.locator('[data-testid="wf-resize-se"]').boundingBox()
    if (!handle) throw new Error('SE resize handle not visible')
    const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
    await cursorDrag(page, start, { x: start.x + 330, y: start.y + 20 }, { steps: 16, stepMs: 40 })
    await pollJson(`${API}/wireframe`, (wf) => {
      const c = wf.routes?.find((r) => r.route === '/')?.canvas
      const d = c?.blocks.find((b) => b.id === demo.id)
      return !!(d && d.rect.width > before + 220)
    }, { timeout: 8_000, label: `demo block widened (was ${before})` })
  }
  await sleep(page, W(700))

  // NOTE on the hero block.
  await scrollCanvas(page, 0)
  await selectBlock(page, hero.id)
  await cursorClick(page, page.locator('[data-testid="wf-note-btn"]'))
  await cursorType(page, page.locator('[data-testid="wf-note-input"]'), NOTE_TEXT, { delay: 18 })
  await page.keyboard.press('Enter')
  await pollJson(`${API}/wireframe`, (wf) => {
    const c = wf.routes?.find((r) => r.route === '/')?.canvas
    return !!c?.blocks.find((b) => b.id === hero.id)?.note?.includes('wireframe mode')
  }, { timeout: 8_000, label: 'hero note persisted' })
  await sleep(page, W(800))

  // ── S5: add with real data ──────────────────────────────────────────────
  markers.mark('s5-add')

  // Scroll to the bottom region and draw the section: in free space below the
  // footer when the stage has room, else overlapping above "Open source"
  // (the markdown spec carries the placement contract either way).
  {
    const bottom = await page.locator('.wf-scroll').evaluate((el) => el.scrollHeight)
    await scrollCanvas(page, bottom)
    const stageBox = await page.locator('.wf-stage').boundingBox()
    const footBox = await blockEl(page, footer.id).boundingBox()
    const openBox = await blockEl(page, openSource.id).boundingBox()
    const spaceBelow = stageBox.y + stageBox.height - (footBox.y + footBox.height)
    const left = openBox.x
    const width = openBox.width
    const top = spaceBelow >= 240
      ? footBox.y + footBox.height + 24
      : openBox.y - 110
    await cursorClick(page, page.locator('[data-testid="wf-draw-placeholder"]'))
    await drawSection(page, { x: left, y: top }, { x: left + width, y: top + 200 })
  }
  await page.locator('[data-testid="wf-placeholder-label"]').waitFor({ state: 'visible', timeout: 8_000 })
  await page.keyboard.type("What's new", { delay: SMOKE ? 0 : 55 })
  await page.keyboard.press('Enter')
  const placeholderId = await pollJson(`${API}/wireframe`, (wf) => {
    const c = wf.routes?.find((r) => r.route === '/')?.canvas
    const ph = c?.blocks.find((b) => b.kind === 'placeholder')
    return ph?.label?.toLowerCase().includes("what's new") ? ph.id : false
  }, { timeout: 8_000, label: 'placeholder persisted' })
  await sleep(page, W(600))

  // Markdown spec (verbatim user contract).
  await selectBlock(page, placeholderId)
  await cursorClick(page, page.locator('[data-testid="wf-md-btn"]'))
  const mdInput = page.locator('[data-testid="wf-md-input"]')
  await mdInput.waitFor({ state: 'visible', timeout: 8_000 })
  await cursorClick(page, mdInput)
  await page.keyboard.type("## What's new", { delay: SMOKE ? 0 : 40 })
  await mdInput.fill(MD_SPEC)
  await sleep(page, W(900))
  await cursorClick(page, page.locator('[data-testid="wf-md-save"]'))
  await pollJson(`${API}/wireframe`, (wf) => {
    const c = wf.routes?.find((r) => r.route === '/')?.canvas
    return !!c?.blocks.find((b) => b.id === placeholderId)?.md?.includes('release cards')
  }, { timeout: 8_000, label: 'markdown spec persisted' })

  // Data binding through the real catalog + OpenAPI shape tree.
  await selectBlock(page, placeholderId)
  await cursorClick(page, page.locator('[data-testid="wf-data-btn"]'))
  await page.locator('[data-testid="binding-picker"]').waitFor({ state: 'visible', timeout: 10_000 })
  const row = page.locator('[data-testid="binding-row-apiMarketingChangelog"]')
  await row.waitFor({ state: 'visible', timeout: 10_000 })
  await sleep(page, W(1200))
  await cursorClick(page, row)
  await page.locator('[data-testid="binding-shape-tree"]').waitFor({ state: 'visible', timeout: 15_000 })
  const tagClass = await page.locator('.bp-shape-tag').first().getAttribute('class')
  if (!tagClass?.includes('api-schema')) throw new Error(`shape honesty tag is not api-schema: ${tagClass}`)
  await sleep(page, W(1500))
  // Expand the root array, then PICK it — field checkboxes render for the picked node.
  await cursorClick(page, page.locator('.bp-tree-row .bp-twisty').first())
  await sleep(page, W(800))
  await cursorClick(page, page.locator('.bp-tree-row').first())
  for (const field of ['version', 'date', 'headline']) {
    const box = page.locator(`[data-testid="binding-field-${field}"]`)
    await box.waitFor({ state: 'visible', timeout: 8_000 })
    await cursorClick(page, box)
    if (!(await box.isChecked().catch(() => true))) await box.check()
    await sleep(page, W(300))
  }
  await cursorClick(page, page.locator('[data-testid="binding-confirm"]'))
  await pollJson(`${API}/wireframe`, (wf) => {
    const c = wf.routes?.find((r) => r.route === '/')?.canvas
    return !!c?.blocks.find((b) => b.id === placeholderId)?.data
  }, { timeout: 8_000, label: 'binding persisted on the section' })
  await sleep(page, W(1200))

  if (SMOKE) {
    markers.mark('smoke-complete')
    console.log('[SMOKE] all selectors and gates green up to Implement — resetting stage.')
    await browser.close()
    execSync('bash scripts/demo-reset-hero.sh', { stdio: 'inherit' })
    return
  }

  // ── S6: implement ───────────────────────────────────────────────────────
  markers.mark('s6-implement')
  await cursorClick(page, page.locator('[data-testid="wf-implement"]'))
  await page.locator('[data-testid="wf-building"]').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
  const task = await pollJson(`${API}/tasks`, (j) => {
    const t = (j.tasks ?? []).find((t) => t.type === 'wireframe_apply')
    return t ?? false
  }, { timeout: 60_000, label: 'wireframe_apply task minted' })
  console.log(`  task ${task.id} minted (status ${task.status})`)
  if (!/\.png$/.test(task.screenshot ?? '')) console.warn('  ⚠ composite screenshot missing on the task')

  // ── S7: the agent runs ──────────────────────────────────────────────────
  markers.mark('s7-agent')
  // The auto-run driver must spawn within 25s or the take is dead — abort loudly.
  await pollJson(`${API}/tasks/${task.id}/messages`, (j) => {
    const arr = Array.isArray(j) ? j : (j.messages ?? [])
    return arr.length > 0
  }, { timeout: 25_000, label: 'conversation stream started (auto-run spawned)' })

  // Open the task card → conversation tab fills the frame while the agent works.
  await cursorClick(page, page.locator(`[data-task-id="${task.id}"]`))
  await tryAction('conversation tab', async () => {
    const tab = page.locator('button', { hasText: 'Conversation' }).first()
    await tab.waitFor({ state: 'visible', timeout: 5_000 })
    await cursorClick(page, tab)
  })
  markers.mark('s7-ramp-start')

  const reviewDeadline = Date.now() + 300_000
  let status = task.status
  for (;;) {
    const j = await (await fetch(`${API}/tasks/${task.id}`)).json()
    status = j.task?.status ?? j.status
    if (status === 'review') break
    if (status === 'blocked' || status === 'needs_info') throw new Error(`agent ended in ${status}: take aborted`)
    if (Date.now() > reviewDeadline) throw new Error('agent did not reach review within 300s — take aborted')
    await tryAction('stream scroll', () => page.evaluate(() => {
      const el = document.querySelector('.conversation-scroll, .conv-messages, .modal-body')
      if (el) el.scrollTop = el.scrollHeight
    }))
    await sleep(page, 4_000)
  }
  markers.mark('s7-review')
  console.log('  agent reached review')

  // Entry verification: nothing pending/applying/failed.
  const session = await (await fetch(`${API}/design-session`)).json()
  const bad = (session.entries ?? []).filter((e) => ['pending', 'applying', 'failed'].includes(e.live?.status))
  if (bad.length) throw new Error(`entries not verified clean: ${bad.map((e) => e.live?.status).join(',')}`)

  // HMR proof BEFORE accept: the live iframe under the canvas already shows the build.
  await frame.getByText(version, { exact: false }).first().waitFor({ state: 'visible', timeout: 60_000 })
  console.log(`  HMR proof: "${version}" is rendering in the live page`)

  // Close the modal.
  await page.keyboard.press('Escape')
  await sleep(page, W(600))

  // ── S9: safety net (PRE-accept — accepting clears the session/batches,
  //        so the undo affordance only exists while reviewing) ─────────────
  markers.mark('s9-safety')
  await tryAction('undo affordance', async () => {
    await cursorClick(page, page.locator('[data-testid="design-components"]').first())
    await page.locator('[data-testid="design-session-panel"]').waitFor({ state: 'visible', timeout: 8_000 })
    await sleep(page, W(800))
    await cursorHover(page, page.locator('.session-undo'))
    await sleep(page, W(2200))
  })
  await cursorClick(page, page.locator('[data-testid="btn-tasks-panel"]').first())
  await sleep(page, W(600))

  // ── S8: accept + reveal ─────────────────────────────────────────────────
  markers.mark('s8-reveal')
  await cursorClick(page, page.locator('[data-testid="btn-accept-task"]').first())
  await page.locator('[data-testid="wireframe-canvas"]').waitFor({ state: 'hidden', timeout: 15_000 })
  await sleep(page, W(1000))

  // Reveal scroll: demo section up top, then the What's new strip near the bottom.
  await scrollIframe(page, 900)
  await sleep(page, W(1200))
  await scrollIframe(page, 6200)
  await tryAction('hover release card', async () => {
    await cursorHover(page, frame.getByText(version, { exact: false }).first())
    await sleep(page, W(1500))
  })
  await scrollIframe(page, 7400)
  await sleep(page, W(2500))

  // ── Finalize ────────────────────────────────────────────────────────────
  markers.mark('end')
  fs.mkdirSync('demo/segments', { recursive: true })
  fs.writeFileSync('demo/segments/hero-markers.json', JSON.stringify(markers.list(), null, 2))
  const video = page.video()
  await context.close()
  if (video) {
    await video.saveAs('demo/segments/hero.webm')
    await video.delete()
    console.log('\n✓ take saved: demo/segments/hero.webm')
  }
  console.log('  markers: demo/segments/hero-markers.json')
  await browser.close()
}

main().catch((err) => {
  console.error('\n✗ take failed:', err.message ?? err)
  process.exit(1)
})
