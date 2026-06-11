import { test, expect } from '@playwright/test'
import {
  bootDesignShell,
  interceptPlanetsApi,
  skipInitWizard,
  resetWorkspaceState,
  trackReloads,
  enterWireframeMode,
} from './helpers/design-tool'

const ORIGIN = 'http://localhost:5173'

// W1: Wireframe mode freezes the live route into anchored image blocks and
// exits losslessly (the iframe never reloads — it was under the canvas the
// whole time).
test.describe('Vue + Vite wireframe capture (W1)', () => {
  test.beforeEach(async ({ page, request }) => {
    await skipInitWizard(request, ORIGIN)
    await resetWorkspaceState(request, ORIGIN)
    await interceptPlanetsApi(page)
  })

  test.afterEach(async ({ request }) => {
    await resetWorkspaceState(request, ORIGIN)
  })

  test('toggle captures anchored blocks, persists the canvas, and toggling back is lossless', async ({ page, request }) => {
    await bootDesignShell(page)
    const frame = page.frameLocator('.app-iframe')
    await expect(frame.locator('h1.title')).toHaveText('Planets', { timeout: 15_000 })

    const reloads = trackReloads(page)
    await enterWireframeMode(page)

    // ≥3 image blocks (header / toolbar / grid on /planets).
    const imgs = page.locator('.wf-block img')
    expect(await imgs.count()).toBeGreaterThanOrEqual(3)
    // The PNGs actually decoded — not broken sources.
    expect(await imgs.first().evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

    // At least one block is anchored into the page component: click blocks
    // until a chip shows PlanetsPage.vue:<line> (chips render on selection).
    const blocks = page.locator('.wf-block')
    const total = await blocks.count()
    let anchored: string | null = null
    for (let i = 0; i < total && !anchored; i++) {
      await blocks.nth(i).click()
      const chip = page.locator('[data-testid="wf-anchor-chip"]')
      if (await chip.count()) {
        const text = await chip.textContent()
        if (text && /PlanetsPage\.vue:\d+/.test(text)) anchored = text
      }
    }
    expect(anchored, 'no block carried a PlanetsPage.vue file:line anchor').toMatch(/PlanetsPage\.vue:\d+/)

    // The canvas persisted server-side with anchors + snapshot filenames.
    const wf = await (await request.get('/__annotask/api/wireframe')).json()
    const planets = wf.routes.find((r: { route: string }) => r.route === '/planets')
    expect(planets?.canvas?.blocks?.length).toBeGreaterThanOrEqual(3)
    expect(planets.canvas.blocks.some((b: { image?: string }) => b.image)).toBe(true)
    expect(planets.canvas.fullImage).toMatch(/\.png$/)

    // Lossless exit: overlay gone, live app visible, zero reloads end-to-end.
    await page.locator('[data-testid="wf-exit"]').click()
    await expect(page.locator('[data-testid="wireframe-canvas"]')).toHaveCount(0)
    await expect(frame.locator('h1.title')).toHaveText('Planets')
    expect(reloads()).toBe(0)
  })
})
