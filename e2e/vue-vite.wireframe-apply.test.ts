import { test, expect } from '@playwright/test'
import {
  bootDesignShell,
  interceptPlanetsApi,
  skipInitWizard,
  getDesignSession,
  discardDesignSession,
  resetWorkspaceState,
  enterWireframeMode,
} from './helpers/design-tool'

const ORIGIN = 'http://localhost:5173'

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
