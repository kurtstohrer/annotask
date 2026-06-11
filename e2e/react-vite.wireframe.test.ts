import { test, expect } from '@playwright/test'
import {
  bootDesignShell,
  interceptPlanetsApi,
  skipInitWizard,
  resetWorkspaceState,
  enterWireframeMode,
} from './helpers/design-tool'

const ORIGIN = 'http://localhost:5174'

// React parity: capture anchors come from rendered host elements, which React
// DOES stamp — the usage-site limitation that killed live prop editing does
// not apply to snapshot wireframing.
test.describe('React + Vite wireframe capture (W1/W2 parity)', () => {
  test.beforeEach(async ({ page, request }) => {
    await skipInitWizard(request, ORIGIN)
    await resetWorkspaceState(request, ORIGIN)
    await interceptPlanetsApi(page)
  })

  test.afterEach(async ({ request }) => {
    await resetWorkspaceState(request, ORIGIN)
  })

  test('captures anchored blocks, persists a drag, and restores after F5', async ({ page, request }) => {
    await bootDesignShell(page)
    const frame = page.frameLocator('.app-iframe')
    await expect(frame.locator('h1.title')).toHaveText('Planets', { timeout: 15_000 })
    await enterWireframeMode(page)

    // Blocks render and at least one carries a Planets.tsx anchor.
    expect(await page.locator('.wf-block img').count()).toBeGreaterThanOrEqual(2)
    const wf = await (await request.get('/__annotask/api/wireframe')).json()
    const canvas = wf.routes.find((r: { route: string }) => r.route === '/planets')!.canvas
    type Blk = { id: string; rect: { x: number; y: number }; anchor?: { file: string; line: number } }
    const anchored = (canvas.blocks as Blk[]).filter((b) => b.anchor?.file.includes('Planets.tsx') && b.anchor.line > 0)
    expect(anchored.length).toBeGreaterThanOrEqual(1)

    // One drag persists.
    const target = anchored[0]
    const el = page.locator(`[data-block-id="${target.id}"]`)
    const box = (await el.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(40, box.height / 2))
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + Math.min(40, box.height / 2) + 90, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => {
      const after = await (await request.get('/__annotask/api/wireframe')).json()
      const c = after.routes.find((r: { route: string }) => r.route === '/planets')!.canvas
      const b = (c.blocks as Blk[]).find((x) => x.id === target.id)!
      return b.rect.x > target.rect.x + 80 && b.rect.y > target.rect.y + 60
    }, { timeout: 5_000 }).toBe(true)

    // F5 restores the canvas as left.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.toolbar').waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('[data-testid="wireframe-canvas"]').waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForTimeout(1_000)
    expect(await page.locator(`[data-block-id="${target.id}"]`).count()).toBe(1)
    expect(await page.locator(`[data-block-id="${target.id}"] img`).evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  })
})
