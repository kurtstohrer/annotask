import { test, expect } from '@playwright/test'
import { APPS, isSkipped, apiUrl } from './fixtures/apps'
import { AnnotaskShell } from './fixtures/annotask-page'
import { SEL } from './helpers/selectors'

const FEATURE_GROUP = 'annotate'

for (const app of APPS) {
  test.describe(`[${app.id}] Annotate tab`, () => {
    test.describe.configure({ mode: 'serial' })

    test('shell boots and iframe loads app', async ({ page }) => {
      test.info().annotations.push({ type: 'matrix', description: `${app.id}/${FEATURE_GROUP}/shell-boots` })
      const shell = new AnnotaskShell(page, app)
      await shell.open()
      await expect(page.locator(SEL.shellToolbar)).toBeVisible()
    })

    test('top-level tabs switch', async ({ page }) => {
      test.info().annotations.push({ type: 'matrix', description: `${app.id}/${FEATURE_GROUP}/tab-switch` })
      const shell = new AnnotaskShell(page, app)
      await shell.open()

      await shell.gotoTab('design')
      await expect(page.locator(SEL.tabDesign)).toHaveClass(/active/)

      await shell.gotoTab('audit')
      await expect(page.locator(SEL.tabAudit)).toHaveClass(/active/)

      await shell.gotoTab('annotate')
      await expect(page.locator(SEL.tabAnnotate)).toHaveClass(/active/)
    })

    for (const tool of ['pin', 'arrow', 'draw', 'highlight', 'select', 'interact'] as const) {
      test(`tool ${tool} activates`, async ({ page }) => {
        test.info().annotations.push({ type: 'matrix', description: `${app.id}/${FEATURE_GROUP}/tool-${tool}` })
        const shell = new AnnotaskShell(page, app)
        await shell.open()
        await shell.activateTool(tool)
        const map = {
          pin: SEL.toolPin, arrow: SEL.toolArrow, draw: SEL.toolDraw,
          highlight: SEL.toolHighlight, select: SEL.toolSelect, interact: SEL.toolInteract,
        } as const
        await expect(page.locator(map[tool])).toHaveClass(/active/)
      })
    }

    test('free-form task creation via + New', async ({ page, request }) => {
      test.info().annotations.push({ type: 'matrix', description: `${app.id}/${FEATURE_GROUP}/free-form-task` })
      const shell = new AnnotaskShell(page, app)
      await shell.open()
      await shell.openTasksPanel()

      await page.locator(SEL.btnNewTask).click()
      const desc = `e2e smoke task from ${app.id} · ${Date.now()}`
      await page.locator(SEL.inputTaskDescription).fill(desc)
      await page.locator(SEL.btnSubmitNewTask).click()

      const card = page.locator(SEL.taskCard).filter({ hasText: desc })
      await expect(card).toBeVisible({ timeout: 5_000 })

      const res = await request.get(apiUrl(app, '/tasks'))
      expect(res.ok()).toBeTruthy()
      const body = await res.json()
      const found = (body.tasks || []).find((t: { description: string }) => t.description === desc)
      expect(found).toBeTruthy()
      expect(found.type).toBe('annotation')
    })

    test('task delete via trash button', async ({ page, request }) => {
      test.info().annotations.push({ type: 'matrix', description: `${app.id}/${FEATURE_GROUP}/task-delete` })
      const desc = `task to delete ${Date.now()}`
      await request.post(apiUrl(app, '/tasks'), {
        data: { type: 'annotation', description: desc, file: 'src/smoke.ts', line: 1 },
      })

      const shell = new AnnotaskShell(page, app)
      await shell.open()
      await shell.openTasksPanel()

      const card = page.locator(SEL.taskCard).filter({ hasText: desc })
      await expect(card).toBeVisible({ timeout: 5_000 })
      await card.locator(SEL.btnDeleteTask).click()
      await page.locator('[data-testid="confirm-delete"]').click()

      await expect(card).toHaveCount(0, { timeout: 5_000 })

      const res = await request.get(apiUrl(app, '/tasks'))
      const body = await res.json()
      const found = (body.tasks || []).find((t: { description: string }) => t.description === desc)
      expect(found).toBeUndefined()
    })

    test.describe('pin tool interaction', () => {
      test.skip(isSkipped(app.id, FEATURE_GROUP), 'skipped by SKIP_MATRIX')

      test('activating pin mode + clicking iframe creates a pin overlay', async ({ page }) => {
        test.info().annotations.push({ type: 'matrix', description: `${app.id}/${FEATURE_GROUP}/pin-overlay` })
        const shell = new AnnotaskShell(page, app)
        await shell.open()
        await shell.activateTool('pin')

        const iframeEl = page.locator(SEL.iframe)
        const box = await iframeEl.boundingBox()
        if (!box) throw new Error('iframe has no bounding box')
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

        await expect(page.locator(SEL.pinOverlay).first()).toBeVisible({ timeout: 5_000 })
      })
    })
  })
}
