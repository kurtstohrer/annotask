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

  // W2: rearrange the sketch (resize/duplicate/note/move/palette drop/
  // placeholder), then F5 — everything must come back as left. Blocks may
  // legitimately overlap after a move (z-order decides), so all toolbar-block
  // interactions happen BEFORE the big grid is dragged on top of it.
  test('manipulation persists across a reload', async ({ page, request }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1600, height: 900 })
    await bootDesignShell(page)
    const frame = page.frameLocator('.app-iframe')
    await expect(frame.locator('h1.title')).toHaveText('Planets', { timeout: 30_000 })
    await enterWireframeMode(page)

    type Blk = { id: string; kind: string; rect: { x: number; y: number; width: number; height: number }; originalRect?: { y: number }; anchor?: { file: string }; note?: string; duplicateOf?: string; label?: string; component?: { componentName?: string }; image?: string }
    async function getCanvas(): Promise<{ blocks: Blk[] }> {
      const wf = await (await request.get('/__annotask/api/wireframe')).json()
      return wf.routes.find((r: { route: string }) => r.route === '/planets')!.canvas
    }

    // Content blocks anchored in PlanetsPage.vue, in original top-down order:
    // page header, filters toolbar, planet grid.
    const initial = await getCanvas()
    const content = initial.blocks
      .filter((b) => b.anchor?.file.includes('PlanetsPage.vue'))
      .sort((a, b) => (a.originalRect?.y ?? 0) - (b.originalRect?.y ?? 0))
    expect(content.length).toBeGreaterThanOrEqual(3)
    const toolbarBlk = content[content.length - 2]
    const gridBlk = content[content.length - 1]

    const blockEl = (id: string) => page.locator(`[data-block-id="${id}"]`)
    // Top-left corner click: dodges the +16/+16 duplicate that appears later.
    const selectBlock = (id: string) => blockEl(id).click({ position: { x: 8, y: 8 } })

    // RESIZE: select the toolbar block, drag its SE handle.
    await selectBlock(toolbarBlk.id)
    const handle = (await page.locator('[data-testid="wf-resize-se"]').boundingBox())!
    await page.mouse.move(handle.x + 5, handle.y + 5)
    await page.mouse.down()
    await page.mouse.move(handle.x + 85, handle.y + 45, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => (await getCanvas()).blocks.find((b) => b.id === toolbarBlk.id)!.rect.width,
      { timeout: 5_000 }).toBeGreaterThan(toolbarBlk.rect.width + 50)

    // DUPLICATE first, then NOTE — a duplicate deep-copies the block, so the
    // note must land after the copy exists or both blocks would carry it.
    await selectBlock(toolbarBlk.id)
    await page.locator('[data-testid="wf-duplicate-btn"]').click()
    await selectBlock(toolbarBlk.id)
    await page.locator('[data-testid="wf-note-btn"]').click()
    await page.locator('[data-testid="wf-note-input"]').fill('make this a carousel')
    await page.locator('[data-testid="wf-note-input"]').press('Enter')
    await expect.poll(async () => {
      const c = await getCanvas()
      return {
        dup: c.blocks.some((b) => b.duplicateOf === toolbarBlk.id),
        note: c.blocks.find((b) => b.id === toolbarBlk.id)?.note,
        copyNote: c.blocks.find((b) => b.duplicateOf === toolbarBlk.id)?.note,
      }
    }, { timeout: 5_000 }).toEqual({ dup: true, note: 'make this a carousel', copyNote: undefined })

    // MOVE: drag the grid block above the filters toolbar (it will cover it —
    // that's a sketch, overlaps are fine). Grab the grid by its BOTTOM strip:
    // the z-topped duplicate from the previous step overlaps its upper half.
    const gridBox = (await blockEl(gridBlk.id).boundingBox())!
    const grabY = gridBox.y + gridBox.height - 12
    const upBy = gridBlk.rect.y - toolbarBlk.rect.y + 24
    await page.mouse.move(gridBox.x + gridBox.width / 2, grabY)
    await page.mouse.down()
    await page.mouse.move(gridBox.x + gridBox.width / 2, grabY - upBy, { steps: 10 })
    await page.mouse.up()
    await expect.poll(async () => {
      const c = await getCanvas()
      const grid = c.blocks.find((b) => b.id === gridBlk.id)!
      const toolbar = c.blocks.find((b) => b.id === toolbarBlk.id)!
      return grid.rect.y < toolbar.rect.y
    }, { timeout: 5_000 }).toBe(true)

    // PLACEHOLDER: draw a labeled box in the strip the grid vacated when it
    // moved up (the stage is exactly as wide as the iframe — there is no free
    // margin to the right). Synthetic pointer events: dispatched events skip
    // hit-testing, so overlapping panels/scroll position can't flake this.
    const stage = (await page.locator('.wf-stage').boundingBox())!
    const gridOrigBottom = gridBlk.rect.y + gridBlk.rect.height
    await page.locator('[data-testid="wf-draw-placeholder"]').click()
    await page.evaluate(({ sx, sy, x1, y1, x2, y2 }) => {
      const stageEl = document.querySelector('.wf-stage') as HTMLElement
      const ev = (type: string, x: number, y: number) =>
        new PointerEvent(type, { bubbles: true, clientX: sx + x, clientY: sy + y })
      stageEl.dispatchEvent(ev('pointerdown', x1, y1))
      window.dispatchEvent(ev('pointermove', x2, y2))
      window.dispatchEvent(ev('pointerup', x2, y2))
    }, { sx: stage.x, sy: stage.y, x1: 80, y1: gridOrigBottom - 70, x2: 420, y2: gridOrigBottom - 10 })
    await page.locator('[data-testid="wf-placeholder-label"]').fill('pagination here')
    await page.locator('[data-testid="wf-placeholder-label"]').press('Enter')
    await expect.poll(async () => (await getCanvas()).blocks.find((b) => b.kind === 'placeholder')?.label,
      { timeout: 5_000 }).toBe('pagination here')

    // PALETTE DROP: synthetic HTML5 drag of the Header project component —
    // string props mount standalone, so the drop yields a REAL snapshot (a
    // data-bound component like PlanetCard would honestly degrade to a
    // placeholder render here).
    // onto the canvas (drag item state rides usePaletteDrag via dragstart).
    await page.locator('.toolbar button', { hasText: 'Components' }).click()
    const paletteItem = page.locator('.components-list-item[data-component-name="Header"]').first()
    await paletteItem.waitFor({ state: 'visible', timeout: 15_000 })
    await page.evaluate(({ dropX, dropY }) => {
      const item = document.querySelector('.components-list-item[data-component-name="Header"]') as HTMLElement
      const scroll = document.querySelector('.wf-scroll') as HTMLElement
      const dt = new DataTransfer()
      item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      scroll.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: dropX, clientY: dropY }))
      scroll.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: dropX, clientY: dropY }))
    }, { dropX: stage.x + 500, dropY: stage.y + gridOrigBottom - 50 })
    await expect.poll(async () => {
      const b = (await getCanvas()).blocks.find((x) => x.kind === 'palette')
      return b?.component?.componentName
    }, { timeout: 15_000 }).toBe('Header')

    // F5 — the sketch must come back exactly as left.
    const before = await getCanvas()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.toolbar').waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('[data-testid="wireframe-canvas"]').waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForTimeout(1_000)

    const visible = before.blocks.filter((b) => !(b as { deleted?: boolean }).deleted)
    expect(await page.locator('.wf-block').count()).toBe(visible.length)
    // Moved grid is rendered at its persisted (moved) position.
    const gridAfter = (await getCanvas()).blocks.find((b) => b.id === gridBlk.id)!
    const domTop = await blockEl(gridBlk.id).evaluate((el) => parseInt((el as HTMLElement).style.top, 10))
    expect(domTop).toBe(Math.round(gridAfter.rect.y))
    // The palette snapshot reloads from its sidecar PNG.
    const paletteBlk = before.blocks.find((b) => b.kind === 'palette')!
    expect(paletteBlk.image, 'Header must produce a real snapshot file').toMatch(/\.png$/)
    expect(await blockEl(paletteBlk.id).locator('img').evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    // Placeholder + note chip survived.
    await expect(page.locator('.wf-placeholder-label')).toHaveText('pagination here')
    await expect(page.locator('.wf-note-chip')).toHaveCount(1)
  })
})
