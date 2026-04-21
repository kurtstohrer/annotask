import { test, expect } from '@playwright/test'
import { APPS, apiUrl } from './fixtures/apps'
import { AnnotaskShell } from './fixtures/annotask-page'
import { SEL } from './helpers/selectors'

const FEATURE_GROUP = 'task-lifecycle'

async function seedTask(
  request: import('@playwright/test').APIRequestContext,
  app: typeof APPS[number],
  data: Record<string, unknown>,
  opts: { targetStatus?: string } = {},
): Promise<string> {
  const { status: _drop, ...createData } = data as { status?: string } & Record<string, unknown>
  const res = await request.post(apiUrl(app, '/tasks'), { data: createData })
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  const id = body.task?.id ?? body.id
  const target = opts.targetStatus ?? (data as { status?: string }).status
  if (!target || target === 'pending') return id

  const path: string[] = []
  if (target === 'in_progress') path.push('in_progress')
  else if (target === 'review') path.push('in_progress', 'review')
  else if (target === 'accepted') path.push('in_progress', 'review', 'accepted')
  else if (target === 'denied') path.push('in_progress', 'denied')
  else if (target === 'needs_info') path.push('in_progress', 'needs_info')
  else if (target === 'blocked') path.push('in_progress', 'blocked')

  for (const next of path) {
    const r = await request.patch(apiUrl(app, `/tasks/${id}`), { data: { status: next } })
    expect(r.ok(), `transition to ${next} failed: ${await r.text()}`).toBeTruthy()
  }
  return id
}

for (const app of APPS) {
  test.describe(`[${app.id}] Task lifecycle`, () => {
    test.describe.configure({ mode: 'serial' })

    test('task card renders in panel with correct file:line', async ({ page, request }) => {
      test.info().annotations.push({ type: 'matrix', description: `${app.id}/${FEATURE_GROUP}/card-renders` })
      const desc = `lifecycle render ${Date.now()}`
      await seedTask(request, app, {
        type: 'annotation', description: desc, file: 'src/App.tsx', line: 42,
      })

      const shell = new AnnotaskShell(page, app)
      await shell.open()
      await shell.openTasksPanel()

      const card = page.locator(SEL.taskCard).filter({ hasText: desc })
      await expect(card).toBeVisible()
      await expect(card).toContainText('src/App.tsx')
      await expect(card).toContainText('42')
    })

    test('click task card opens detail modal', async ({ page, request }) => {
      test.info().annotations.push({ type: 'matrix', description: `${app.id}/${FEATURE_GROUP}/detail-modal` })
      const desc = `lifecycle detail ${Date.now()}`
      await seedTask(request, app, {
        type: 'annotation', description: desc, file: 'src/X.ts', line: 1,
      })

      const shell = new AnnotaskShell(page, app)
      await shell.open()
      await shell.openTasksPanel()

      await page.locator(SEL.taskCard).filter({ hasText: desc }).click()
      await expect(page.locator(SEL.taskDetailModal)).toBeVisible()
      await expect(page.locator(SEL.taskDetailType)).toContainText('annotation')
      await expect(page.locator(SEL.taskDetailDescription)).toContainText(desc)
    })

    test('accept button transitions status via API', async ({ page, request }) => {
      test.info().annotations.push({ type: 'matrix', description: `${app.id}/${FEATURE_GROUP}/accept` })
      const desc = `lifecycle accept ${Date.now()}`
      const id = await seedTask(request, app, {
        type: 'annotation', description: desc, file: 'src/A.ts', line: 1, status: 'review',
      })

      const shell = new AnnotaskShell(page, app)
      await shell.open()
      await shell.openTasksPanel()

      const card = page.locator(SEL.taskCard).filter({ hasText: desc })
      await expect(card).toBeVisible()
      await card.locator(SEL.btnAcceptTask).click()

      // Accepted tasks are removed from the store on transition — expect 404.
      await expect.poll(async () => {
        const res = await request.get(apiUrl(app, `/tasks/${id}`))
        return res.status()
      }, { timeout: 5_000 }).toBe(404)
    })

    test('deny button opens feedback form and submits', async ({ page, request }) => {
      test.info().annotations.push({ type: 'matrix', description: `${app.id}/${FEATURE_GROUP}/deny` })
      const desc = `lifecycle deny ${Date.now()}`
      const id = await seedTask(request, app, {
        type: 'annotation', description: desc, file: 'src/D.ts', line: 1, status: 'review',
      })

      const shell = new AnnotaskShell(page, app)
      await shell.open()
      await shell.openTasksPanel()

      const card = page.locator(SEL.taskCard).filter({ hasText: desc })
      await expect(card).toBeVisible()
      await card.locator(SEL.btnDenyTask).click()

      const feedback = 'not what I wanted'
      await card.locator('[data-testid="input-deny-feedback"]').fill(feedback)
      await card.locator('[data-testid="btn-submit-deny"]').click()

      await expect.poll(async () => {
        const res = await request.get(apiUrl(app, `/tasks/${id}`))
        if (!res.ok()) return null
        const body = await res.json()
        return (body.task ?? body).status
      }, { timeout: 5_000 }).toBe('denied')

      const res = await request.get(apiUrl(app, `/tasks/${id}`))
      const body = await res.json()
      const task = body.task ?? body
      expect(task.feedback).toContain(feedback)
    })

    test('delete from detail modal removes task', async ({ page, request }) => {
      test.info().annotations.push({ type: 'matrix', description: `${app.id}/${FEATURE_GROUP}/modal-delete` })
      const desc = `lifecycle modal-delete ${Date.now()}`
      const id = await seedTask(request, app, {
        type: 'annotation', description: desc, file: 'src/M.ts', line: 1,
      })

      const shell = new AnnotaskShell(page, app)
      await shell.open()
      await shell.openTasksPanel()

      await page.locator(SEL.taskCard).filter({ hasText: desc }).click()
      await expect(page.locator(SEL.taskDetailModal)).toBeVisible()
      await page.locator(SEL.btnModalDelete).click()

      const confirm = page.locator('.cd-confirm, [data-testid="confirm-delete"]').first()
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click()
      } else {
        await page.getByRole('button', { name: /delete|confirm|yes/i }).first().click()
      }

      await expect.poll(async () => {
        const res = await request.get(apiUrl(app, `/tasks/${id}`))
        return res.status()
      }, { timeout: 5_000 }).toBe(404)
    })
  })
}
