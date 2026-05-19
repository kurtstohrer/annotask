/**
 * Automated demo recording — captures each segment as a video clip.
 *
 * Run:
 *   pnpm demo:reset && pnpm dev:marketing
 *   npx playwright test --config e2e/demo-record.config.ts
 *
 * Produces: demo/segments/*.webm
 *
 * NOTE: Segments that require iframe tool interactions (pins, arrows,
 * sections) are best recorded manually. This script captures the
 * segments that Playwright can automate reliably: shell loading, tab
 * views, a11y scan, token inspector, and the result scroll.
 */
import { test, expect, type Page, type FrameLocator } from '@playwright/test'
import { mkdirSync, renameSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SEGMENTS_DIR = join(__dirname, '..', 'demo', 'segments')
const RAW_DIR = join(SEGMENTS_DIR, '_raw')
mkdirSync(RAW_DIR, { recursive: true })

/* ── Helpers ─────────────────────────────────────────────────────── */

async function waitForShell(page: Page): Promise<FrameLocator> {
  await page.goto('/__annotask/')
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('.toolbar')).toBeVisible({ timeout: 15_000 })

  try {
    await page.locator('.init-modal-close').click({ timeout: 3000 })
    await page.waitForTimeout(500)
  } catch { /* no wizard */ }

  const frame = page.frameLocator('.app-iframe')
  await frame.locator('body').waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForTimeout(1500)
  return frame
}

async function saveVideo(page: Page, name: string) {
  const video = page.video()
  if (video) {
    await page.close()
    const src = await video.path()
    if (src && existsSync(src)) {
      const dest = join(SEGMENTS_DIR, `${name}.webm`)
      renameSync(src, dest)
      console.log(`  → ${name}.webm`)
    }
  }
}

/* ── Segments ────────────────────────────────────────────────────── */

test.describe('Demo recording', () => {
  test.describe.configure({ mode: 'serial' })

  // Segment 1: Cold open — before page scroll
  test('segment-01-before-scroll', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: RAW_DIR, size: { width: 1920, height: 1080 } },
    })
    const page = await ctx.newPage()

    await page.goto('http://localhost:5181/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1500)

    // Smooth scroll down the "before" page
    await page.evaluate(async () => {
      const total = document.body.scrollHeight - window.innerHeight
      const dur = 6000
      const t0 = performance.now()
      return new Promise<void>(resolve => {
        (function step(ts: number) {
          const p = Math.min((ts - t0) / dur, 1)
          const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2
          window.scrollTo(0, total * e)
          p < 1 ? requestAnimationFrame(step) : resolve()
        })(t0)
      })
    })
    await page.waitForTimeout(2000)

    await saveVideo(page, 'segment-01-before-scroll')
    await ctx.close()
  })

  // Segment 2: Setup — load shell
  test('segment-02-setup', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: RAW_DIR, size: { width: 1920, height: 1080 } },
    })
    const page = await ctx.newPage()

    await page.goto('http://localhost:5181/')
    await page.waitForTimeout(2000)

    await page.goto('http://localhost:5181/__annotask/')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.toolbar')).toBeVisible({ timeout: 15_000 })

    try {
      await page.locator('.init-modal-close').click({ timeout: 3000 })
      await page.waitForTimeout(500)
    } catch { /* no wizard */ }

    await page.waitForTimeout(3000)

    await saveVideo(page, 'segment-02-setup')
    await ctx.close()
  })

  // Segment 6: Style editor — Design > Inspector view
  test('segment-06-style-editor', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: RAW_DIR, size: { width: 1920, height: 1080 } },
    })
    const page = await ctx.newPage()
    await waitForShell(page)

    await page.locator('[data-testid="tab-design"]').click()
    await page.waitForTimeout(500)
    await page.locator('[data-testid="design-inspector"]').click()
    await page.waitForTimeout(3000)

    await saveVideo(page, 'segment-06-style-editor')
    await ctx.close()
  })

  // Segment 7: A11y scan — run scan and show results
  test('segment-07-a11y-scan', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: RAW_DIR, size: { width: 1920, height: 1080 } },
    })
    const page = await ctx.newPage()
    await waitForShell(page)

    await page.locator('[data-testid="tab-audit"]').click()
    await page.waitForTimeout(300)
    await page.locator('[data-testid="audit-a11y"]').click()
    await page.waitForTimeout(1000)

    // Run the scan
    try {
      const scanBtn = page.locator('button:has-text("Scan"), button:has-text("Run")').first()
      await scanBtn.click({ timeout: 3000 })
      await page.waitForTimeout(8000)
    } catch {
      await page.waitForTimeout(2000)
    }

    // Hold on results
    await page.waitForTimeout(3000)

    await saveVideo(page, 'segment-07-a11y-scan')
    await ctx.close()
  })

  // Segment 9: Token editor — Design > Tokens view
  test('segment-09-token-editor', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: RAW_DIR, size: { width: 1920, height: 1080 } },
    })
    const page = await ctx.newPage()
    await waitForShell(page)

    await page.locator('[data-testid="tab-design"]').click()
    await page.waitForTimeout(500)
    await page.locator('[data-testid="design-tokens"]').click()
    await page.waitForTimeout(4000)

    await saveVideo(page, 'segment-09-token-editor')
    await ctx.close()
  })

  // Segment 12: Result — polished page scroll (restore first)
  test('segment-12-result-scroll', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: RAW_DIR, size: { width: 1920, height: 1080 } },
    })
    const page = await ctx.newPage()

    // NOTE: This test expects the polished "after" state.
    // Run `pnpm demo:restore` before this segment if the page is still degraded.
    await page.goto('http://localhost:5181/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    // Smooth scroll top to bottom
    await page.evaluate(async () => {
      const total = document.body.scrollHeight - window.innerHeight
      const dur = 8000
      const t0 = performance.now()
      return new Promise<void>(resolve => {
        (function step(ts: number) {
          const p = Math.min((ts - t0) / dur, 1)
          const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2
          window.scrollTo(0, total * e)
          p < 1 ? requestAnimationFrame(step) : resolve()
        })(t0)
      })
    })
    await page.waitForTimeout(2000)

    // Scroll back to hero
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    await page.waitForTimeout(3000)

    await saveVideo(page, 'segment-12-result-scroll')
    await ctx.close()
  })
})
