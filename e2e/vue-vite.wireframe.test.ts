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
    const toolbarBlk = content[content.length - 2]
    const gridBlk = content[content.length - 1]

    // MARQUEE over the page header + toolbar (synthetic events skip hit-testing).
    await page.evaluate(({ x1, y1, x2, y2 }) => {
      const stageEl = document.querySelector('.wf-stage') as HTMLElement
      const r = stageEl.getBoundingClientRect()
      const ev = (type: string, x: number, y: number) =>
        new PointerEvent(type, { bubbles: true, clientX: r.left + x, clientY: r.top + y })
      stageEl.dispatchEvent(ev('pointerdown', x1, y1))
      window.dispatchEvent(ev('pointermove', x2, y2))
      window.dispatchEvent(ev('pointerup', x2, y2))
    }, { x1: 2, y1: headerBlk.rect.y + 2, x2: headerBlk.rect.x + headerBlk.rect.width - 2, y2: toolbarBlk.rect.y + toolbarBlk.rect.height - 2 })
    const selected = await page.locator('.wf-block.selected').count()
    expect(selected).toBeGreaterThanOrEqual(2)

    // GROUP NUDGE: Shift+ArrowDown moves every selected block 10px.
    await page.locator('[data-testid="wireframe-canvas"]').press('Shift+ArrowDown')
    await expect.poll(async () => {
      const blocks = await getBlocks()
      return {
        header: blocks.find((b) => b.id === headerBlk.id)!.rect.y,
        toolbar: blocks.find((b) => b.id === toolbarBlk.id)!.rect.y,
      }
    }, { timeout: 5_000 }).toEqual({ header: headerBlk.rect.y + 10, toolbar: toolbarBlk.rect.y + 10 })

    // EXPLODE: double-click the grid block → per-child blocks with their own anchors.
    const countBefore = (await getBlocks()).length
    await blockEl(gridBlk.id).dblclick()
    await expect.poll(async () => {
      const blocks = await getBlocks()
      return { gone: !blocks.some((b) => b.id === gridBlk.id), count: blocks.length }
    }, { timeout: 30_000 }).toMatchObject({ gone: true })
    const after = await getBlocks()
    expect(after.length).toBeGreaterThan(countBefore)
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
    expect(content.length).toBeGreaterThanOrEqual(3)
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
})
