import { test, expect } from '@playwright/test'
import {
  bootDesignShell,
  interceptPlanetsApi,
  skipInitWizard,
  getDesignSession,
  discardDesignSession,
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

    // ≥3 image blocks (app header / page header / planets-content on /planets).
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

    // Straggler coverage: the playground's bare <Button> sits AFTER <main> as
    // a sibling (App.vue:48) — content outside the content root that isn't
    // semantic chrome must still get a block, not just appear in the
    // full-page "before" image. (anchor.file alone would false-pass: the
    // header chrome block also anchors to App.vue via attribute fallthrough.)
    expect(
      planets.canvas.blocks.some((b: { kind: string; anchor?: { tag?: string } }) =>
        b.kind === 'captured' && b.anchor?.tag === 'button'),
      'the sibling-of-main <Button> must be captured as a block',
    ).toBe(true)

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
    // page header, then the planets-content wrapper (layout + controls rail).
    const initial = await getCanvas()
    const content = initial.blocks
      .filter((b) => b.anchor?.file.includes('PlanetsPage.vue'))
      .sort((a, b) => (a.originalRect?.y ?? 0) - (b.originalRect?.y ?? 0))
    expect(content.length).toBeGreaterThanOrEqual(2)
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
    // string props mount standalone, so generate yields a REAL snapshot (a
    // data-bound component like PlanetCard would honestly degrade to a
    // placeholder render here). The drop opens the GENERATE PANEL (no more
    // blind instant block): generate, then place at the remembered drop point.
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
    await page.locator('[data-testid="gen-panel"]').waitFor({ state: 'visible', timeout: 10_000 })
    await page.locator('[data-testid="gen-generate"]').click()
    await page.locator('[data-testid="gen-preview-img"]').waitFor({ state: 'visible', timeout: 20_000 })
    expect(await page.locator('[data-testid="gen-preview-img"]').evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await page.locator('[data-testid="gen-place-drop"]').click()
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

  // D4: the generate flow binds a REAL data source through the picker's shape
  // tree (the playground ships a discoverable OpenAPI file, so usePlanets
  // resolves 'api-schema' without the FastAPI running), survives a reload,
  // and regenerates in place through the configure button.
  test('generate flow binds a data source and survives reload', async ({ page, request }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1600, height: 900 })
    await bootDesignShell(page)
    const frame = page.frameLocator('.app-iframe')
    await expect(frame.locator('h1.title')).toHaveText('Planets', { timeout: 30_000 })
    await enterWireframeMode(page)

    type Blk = { id: string; kind: string; component?: { componentName?: string }; data?: Record<string, unknown>; image?: string }
    async function getCanvas(): Promise<{ blocks: Blk[] }> {
      const wf = await (await request.get('/__annotask/api/wireframe')).json()
      return wf.routes.find((r: { route: string }) => r.route === '/planets')!.canvas
    }

    // Drop Header → the generate panel opens with the drop point remembered.
    await page.locator('.toolbar button', { hasText: 'Components' }).click()
    await page.locator('.components-list-item[data-component-name="Header"]').first().waitFor({ state: 'visible', timeout: 15_000 })
    const stage = (await page.locator('.wf-stage').boundingBox())!
    await page.evaluate(({ dropX, dropY }) => {
      const item = document.querySelector('.components-list-item[data-component-name="Header"]') as HTMLElement
      const scroll = document.querySelector('.wf-scroll') as HTMLElement
      const dt = new DataTransfer()
      item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      scroll.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: dropX, clientY: dropY }))
      scroll.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: dropX, clientY: dropY }))
    }, { dropX: stage.x + 300, dropY: stage.y + 300 })
    await page.locator('[data-testid="gen-panel"]').waitFor({ state: 'visible', timeout: 10_000 })

    // Bind: pick usePlanets, drill the REAL shape tree to planets[], narrow
    // the fields to name + type.
    await page.locator('[data-testid="gen-bind-open"]').click()
    await page.locator('[data-testid="binding-picker"]').waitFor({ state: 'visible', timeout: 10_000 })
    await page.locator('[data-testid="binding-row-usePlanets"]').click()
    await page.locator('[data-testid="binding-shape-tree"]').waitFor({ state: 'visible', timeout: 15_000 })
    await expect(page.locator('.bp-shape-tag')).toHaveClass(/api-schema/)
    await page.locator('.bp-tree-row .bp-twisty').first().click() // expand (response)
    await page.locator('.bp-tree-row', { hasText: 'planets' }).click() // path = planets[]
    await page.locator('[data-testid="binding-field-name"]').check()
    await page.locator('[data-testid="binding-field-type"]').check()
    await page.locator('[data-testid="binding-confirm"]').click()
    await expect(page.locator('[data-testid="gen-binding-chip"]')).toContainText('usePlanets')

    // Generate on the app-true surface, place at the remembered drop point.
    await page.locator('[data-testid="gen-generate"]').click()
    await page.locator('[data-testid="gen-preview-img"]').waitFor({ state: 'visible', timeout: 20_000 })
    await page.locator('[data-testid="gen-place-drop"]').click()

    let placed: Blk | undefined
    await expect.poll(async () => {
      placed = (await getCanvas()).blocks.find((b) => b.kind === 'palette')
      return placed?.data?.name
    }, { timeout: 15_000 }).toBe('usePlanets')
    expect(placed!.component?.componentName).toBe('Header')
    expect(placed!.data).toMatchObject({
      name: 'usePlanets',
      path: 'planets[]',
      fields: ['name', 'type'],
      shape_source: 'api-schema',
    })

    // F5 — block, binding chip, and snapshot all restore.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.toolbar').waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('[data-testid="wireframe-canvas"]').waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForTimeout(1_000)
    const blockEl = page.locator(`[data-block-id="${placed!.id}"]`)
    await expect(page.locator(`[data-testid="wf-data-chip-${placed!.id}"]`)).toContainText('usePlanets')
    expect(await blockEl.locator('img').evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

    // Reconfigure via the gear button: regenerate in place, binding intact.
    await blockEl.click({ position: { x: 8, y: 8 } })
    await page.locator('[data-testid="wf-configure-btn"]').click()
    await page.locator('[data-testid="gen-panel"]').waitFor({ state: 'visible', timeout: 10_000 })
    await expect(page.locator('[data-testid="gen-binding-chip"]')).toContainText('usePlanets')
    await page.locator('[data-testid="gen-generate"]').click()
    await page.locator('[data-testid="gen-preview-img"]').waitFor({ state: 'visible', timeout: 20_000 })
    await page.locator('[data-testid="gen-apply"]').click()
    await expect(page.locator('[data-testid="gen-panel"]')).toHaveCount(0)
    await expect(page.locator(`[data-testid="wf-data-chip-${placed!.id}"]`)).toContainText('usePlanets')
    expect(await blockEl.locator('img').evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  })

  // W4: marquee multi-select, group nudge, explode-to-children, viewport label.
  test('multi-select, nudge, and explode refine the sketch', async ({ page, request }) => {
    test.setTimeout(120_000)
    await bootDesignShell(page)
    const frame = page.frameLocator('.app-iframe')
    await expect(frame.locator('h1.title')).toHaveText('Planets', { timeout: 30_000 })
    await enterWireframeMode(page)

    await expect(page.locator('[data-testid="wf-viewport"]')).toHaveText(/^\d+×\d+ @[\d.]+x$/)

    type Blk = { id: string; rect: { x: number; y: number; width: number; height: number }; originalRect?: { y: number }; anchor?: { file: string; line: number; cssClass?: string } }
    async function getBlocks(): Promise<Blk[]> {
      const wf = await (await request.get('/__annotask/api/wireframe')).json()
      return wf.routes.find((r: { route: string }) => r.route === '/planets')!.canvas.blocks
    }
    const initial = await getBlocks()
    const content = initial
      .filter((b) => b.anchor?.file.includes('PlanetsPage.vue'))
      .sort((a, b) => (a.originalRect?.y ?? 0) - (b.originalRect?.y ?? 0))
    const headerBlk = content[0]
    const gridBlk = content[content.length - 1]

    // MARQUEE over the page header + content wrapper (synthetic events skip
    // hit-testing).
    await page.evaluate(({ x1, y1, x2, y2 }) => {
      const stageEl = document.querySelector('.wf-stage') as HTMLElement
      const r = stageEl.getBoundingClientRect()
      const ev = (type: string, x: number, y: number) =>
        new PointerEvent(type, { bubbles: true, clientX: r.left + x, clientY: r.top + y })
      stageEl.dispatchEvent(ev('pointerdown', x1, y1))
      window.dispatchEvent(ev('pointermove', x2, y2))
      window.dispatchEvent(ev('pointerup', x2, y2))
    }, { x1: 2, y1: headerBlk.rect.y + 2, x2: headerBlk.rect.x + headerBlk.rect.width - 2, y2: gridBlk.rect.y + gridBlk.rect.height - 2 })
    const selected = await page.locator('.wf-block.selected').count()
    expect(selected).toBeGreaterThanOrEqual(2)

    // GROUP NUDGE: Shift+ArrowDown moves every selected block 10px.
    await page.locator('[data-testid="wireframe-canvas"]').press('Shift+ArrowDown')
    await expect.poll(async () => {
      const blocks = await getBlocks()
      return {
        header: blocks.find((b) => b.id === headerBlk.id)!.rect.y,
        grid: blocks.find((b) => b.id === gridBlk.id)!.rect.y,
      }
    }, { timeout: 5_000 }).toEqual({ header: headerBlk.rect.y + 10, grid: gridBlk.rect.y + 10 })

    // EXPLODE: double-click the grid block → per-child blocks with their own
    // anchors, while the grid itself stays as the container-shell backdrop
    // (its background/padding must not vanish — the styling-loss regression).
    const countBefore = (await getBlocks()).length
    await blockEl(gridBlk.id).dblclick()
    await expect.poll(async () => {
      const blocks = await getBlocks()
      const parent = blocks.find((b) => b.id === gridBlk.id) as (Blk & { shell?: boolean; image?: string }) | undefined
      return { shell: parent?.shell, count: blocks.length }
    }, { timeout: 30_000 }).toMatchObject({ shell: true })
    const after = await getBlocks()
    expect(after.length).toBeGreaterThan(countBefore)
    const shellBlk = after.find((b) => b.id === gridBlk.id) as Blk & { image?: string }
    expect(shellBlk.image).toMatch(/-shell\.png$/)
    expect(await blockEl(gridBlk.id).locator('img').evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    // Children carry their OWN source anchors (finer than the grid's line).
    const children = after.filter((b) => b.anchor?.file.includes('PlanetsPage.vue') && b.anchor.line !== gridBlk.anchor!.line && (b.originalRect?.y ?? 0) >= (gridBlk.originalRect?.y ?? 0) - 1)
    expect(children.length).toBeGreaterThanOrEqual(1)

    function blockEl(id: string) { return page.locator(`[data-block-id="${id}"]`) }
  })
})

// Lives in this FILE deliberately: Playwright distributes separate spec files
// across parallel workers, and these suites share one dev server's wireframe
// document — same-file tests are the serialization boundary.
// W3 UI half of "Implement this wireframe" (no provider configured in e2e, so
// the minted task waits for an agent — the full live loop is covered by
// src/server/__tests__/apply-session-matrix.test.ts with real CLIs).
test.describe('Vue + Vite wireframe implement (W3 UI)', () => {
  test.beforeEach(async ({ page, request }) => {
    await skipInitWizard(request, ORIGIN)
    await discardDesignSession(request, ORIGIN)
    await resetWorkspaceState(request, ORIGIN)
    await interceptPlanetsApi(page)
  })

  test.afterEach(async ({ request }) => {
    await resetWorkspaceState(request, ORIGIN)
    await discardDesignSession(request, ORIGIN)
  })

  test('Implement mints ONE direction task with a composite screenshot; deleting it unlocks the sketch', async ({ page, request }) => {
    test.setTimeout(120_000)
    await bootDesignShell(page)
    const frame = page.frameLocator('.app-iframe')
    await expect(frame.locator('h1.title')).toHaveText('Planets', { timeout: 30_000 })
    await enterWireframeMode(page)

    type Blk = { id: string; kind: string; rect: { x: number; y: number; width: number; height: number }; originalRect?: { y: number }; anchor?: { file: string } }
    async function getCanvas(): Promise<{ status?: string; taskId?: string; blocks: Blk[] }> {
      const wf = await (await request.get('/__annotask/api/wireframe')).json()
      return wf.routes.find((r: { route: string }) => r.route === '/planets')!.canvas
    }

    const initial = await getCanvas()
    const content = initial.blocks
      .filter((b) => b.anchor?.file.includes('PlanetsPage.vue'))
      .sort((a, b) => (a.originalRect?.y ?? 0) - (b.originalRect?.y ?? 0))
    expect(content.length).toBeGreaterThanOrEqual(2)
    const toolbarBlk = content[content.length - 2]
    const gridBlk = content[content.length - 1]

    // MOVE the grid above the filters toolbar (real mouse drag, bottom grab).
    const gridBox = (await page.locator(`[data-block-id="${gridBlk.id}"]`).boundingBox())!
    const grabY = gridBox.y + gridBox.height - 12
    const upBy = gridBlk.rect.y - toolbarBlk.rect.y + 24
    await page.mouse.move(gridBox.x + gridBox.width / 2, grabY)
    await page.mouse.down()
    await page.mouse.move(gridBox.x + gridBox.width / 2, grabY - upBy, { steps: 10 })
    await page.mouse.up()

    // PLACEHOLDER in the vacated strip (synthetic events skip hit-testing).
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

    // IMPLEMENT: directions + composite + ONE wireframe_apply task.
    await page.locator('[data-testid="wf-implement"]').click()
    await expect(page.locator('[data-testid="wf-building"]')).toBeVisible({ timeout: 30_000 })

    const session = await getDesignSession(request)
    const directions = session.entries.filter((e) => (e.change as { type: string }).type === 'wireframe_direction')
    expect(directions.length).toBeGreaterThanOrEqual(2) // move + add (other blocks may have jittered)
    expect(directions.every((e) => (e.live as { status: string }).status === 'applying')).toBe(true)
    const taskId = String(directions[0].taskId)

    const tasks = (await (await request.get('/__annotask/api/tasks')).json()).tasks as Array<Record<string, unknown>>
    const wireframeTasks = tasks.filter((t) => t.type === 'wireframe_apply')
    expect(wireframeTasks).toHaveLength(1)
    const task = wireframeTasks[0]
    expect(task.id).toBe(taskId)
    expect(String(task.description)).toContain('Implement the wireframe sketch on /planets')
    // The composite screenshot rode along and is fetchable.
    expect(String(task.screenshot)).toMatch(/\.png$/)
    const shot = await request.get(`/__annotask/screenshots/${task.screenshot}`)
    expect(shot.status()).toBe(200)

    // The canvas locked to the task; snapshot batch exists.
    const locked = await getCanvas()
    expect(locked.status).toBe('building')
    expect(locked.taskId).toBe(taskId)
    const snapshots = await (await request.get('/__annotask/api/design-session/snapshots')).json() as { batches: Array<{ taskId: string }> }
    expect(snapshots.batches[0]?.taskId).toBe(taskId)

    // No agent ran: deleting the task releases the directions and unlocks the
    // sketch for tweak-and-re-implement.
    await request.delete(`/__annotask/api/tasks/${taskId}`, { headers: { Origin: ORIGIN } })
    await expect.poll(async () => {
      const after = await getDesignSession(request)
      const dirs = after.entries.filter((e) => (e.change as { type: string }).type === 'wireframe_direction')
      return dirs.map((e) => (e.live as { status: string }).status)
    }, { timeout: 5_000 }).toEqual(directions.map(() => 'pending'))
    await expect.poll(async () => (await getCanvas()).status ?? 'sketch', { timeout: 5_000 }).toBe('sketch')
    await expect(page.locator('[data-testid="wf-implement"]')).toBeVisible({ timeout: 10_000 })
  })

  // D6: a drawn SECTION (md spec + data binding) survives F5 and rides the
  // implement task's add direction with VERBATIM added.md/.data.
  test('a section with md + binding implements into ONE task carrying both verbatim', async ({ page, request }) => {
    test.setTimeout(120_000)
    await bootDesignShell(page)
    const frame = page.frameLocator('.app-iframe')
    await expect(frame.locator('h1.title')).toHaveText('Planets', { timeout: 30_000 })
    await enterWireframeMode(page)

    type Blk = { id: string; kind: string; label?: string; md?: string; data?: Record<string, unknown> }
    async function getCanvas(): Promise<{ blocks: Blk[] }> {
      const wf = await (await request.get('/__annotask/api/wireframe')).json()
      return wf.routes.find((r: { route: string }) => r.route === '/planets')!.canvas
    }

    // Draw the section in free space below the content.
    const stage = (await page.locator('.wf-stage').boundingBox())!
    await page.locator('[data-testid="wf-draw-placeholder"]').click()
    await page.evaluate(({ sx, sy }) => {
      const stageEl = document.querySelector('.wf-stage') as HTMLElement
      const ev = (type: string, x: number, y: number) =>
        new PointerEvent(type, { bubbles: true, clientX: sx + x, clientY: sy + y })
      stageEl.dispatchEvent(ev('pointerdown', 60, 460))
      window.dispatchEvent(ev('pointermove', 420, 580))
      window.dispatchEvent(ev('pointerup', 420, 580))
    }, { sx: stage.x, sy: stage.y })
    await page.locator('[data-testid="wf-placeholder-label"]').fill('related planets')
    await page.locator('[data-testid="wf-placeholder-label"]').press('Enter')
    let secId = ''
    await expect.poll(async () => {
      const ph = (await getCanvas()).blocks.find((b) => b.kind === 'placeholder')
      secId = ph?.id ?? ''
      return ph?.label
    }, { timeout: 5_000 }).toBe('related planets')

    // Markdown spec.
    const md = '## Related planets\n- name and type for each'
    await page.locator(`[data-block-id="${secId}"]`).click({ position: { x: 8, y: 8 } })
    await page.locator('[data-testid="wf-md-btn"]').click()
    await page.locator('[data-testid="wf-md-input"]').fill(md)
    await page.locator('[data-testid="wf-md-save"]').click()

    // Binding through the picker's REAL shape tree (the playground's OpenAPI
    // file resolves usePlanets to 'api-schema' without the FastAPI running).
    await page.locator(`[data-block-id="${secId}"]`).click({ position: { x: 8, y: 8 } })
    await page.locator('[data-testid="wf-data-btn"]').click()
    await page.locator('[data-testid="binding-row-usePlanets"]').click()
    await page.locator('[data-testid="binding-shape-tree"]').waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('.bp-tree-row .bp-twisty').first().click()
    await page.locator('.bp-tree-row', { hasText: 'planets' }).click()
    await page.locator('[data-testid="binding-field-name"]').check()
    await page.locator('[data-testid="binding-field-type"]').check()
    await page.locator('[data-testid="binding-confirm"]').click()
    await expect.poll(async () => (await getCanvas()).blocks.find((b) => b.id === secId)?.data?.name,
      { timeout: 5_000 }).toBe('usePlanets')

    // F5 — md + binding restore before implementing.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="wireframe-canvas"]').waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForTimeout(1_000)
    const restored = (await getCanvas()).blocks.find((b) => b.id === secId)!
    expect(restored.md).toBe(md)
    expect(restored.data).toMatchObject({ name: 'usePlanets', path: 'planets[]', shape_source: 'api-schema' })

    // IMPLEMENT — ONE task; the add direction carries md + data VERBATIM.
    await page.locator('[data-testid="wf-implement"]').click()
    await expect(page.locator('[data-testid="wf-building"]')).toBeVisible({ timeout: 30_000 })

    const session = await getDesignSession(request)
    type AddChange = { type: string; op?: string; description?: string; added?: { md?: string; data?: Record<string, unknown> } }
    const add = session.entries.find((e) => {
      const c = e.change as AddChange
      return c.type === 'wireframe_direction' && c.op === 'add'
    })!
    const change = add.change as AddChange
    expect(change.added!.md).toBe(md)
    expect(change.added!.data).toMatchObject({
      kind: 'composable',
      name: 'usePlanets',
      path: 'planets[]',
      fields: ['name', 'type'],
      shape_source: 'api-schema',
    })
    expect(String(change.description)).toContain('first line: "Related planets"')
    expect(String(change.description)).toContain('bind to the composable usePlanets')

    const tasks = (await (await request.get('/__annotask/api/tasks')).json()).tasks as Array<Record<string, unknown>>
    const wireframeTasks = tasks.filter((t) => t.type === 'wireframe_apply')
    expect(wireframeTasks).toHaveLength(1)

    // No agent in e2e: delete to unlock (the live loop is the matrix test's job).
    await request.delete(`/__annotask/api/tasks/${wireframeTasks[0].id}`, { headers: { Origin: ORIGIN } })
    await expect(page.locator('[data-testid="wf-implement"]')).toBeVisible({ timeout: 10_000 })
  })
})
