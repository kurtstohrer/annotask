import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import {
  bootDesignShell,
  interceptPlanetsApi,
  skipInitWizard,
  getDesignSession,
  discardDesignSession,
  resetWorkspaceState,
} from './helpers/design-tool'

const ORIGIN = 'http://localhost:5173'

// Seed one pending style entry straight into the journal (the inspector UI
// records these live; the apply loop only cares that the entry exists).
async function seedStyleEntry(request: APIRequestContext): Promise<void> {
  const current = await (await request.get('/__annotask/api/design-session')).json() as { sessionId?: string; rev?: number }
  const doc = {
    version: '1.0',
    sessionId: current.sessionId ?? `ds-e2e-${Date.now()}`,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    ...(current.rev !== undefined ? { rev: current.rev } : {}),
    entries: [
      {
        id: 'se-e2e-1',
        ordinal: 1,
        ts: Date.now(),
        route: '/planets',
        change: {
          id: 'c-se-e2e-1', type: 'style_update', description: 'h1 color → blue',
          file: 'src/pages/PlanetsPage.vue', section: 'style', line: 9,
          element: 'h1', property: 'color', before: 'red', after: 'blue',
        },
        anchor: { file: 'src/pages/PlanetsPage.vue', line: 9, targetTag: 'h1' },
        live: { status: 'pending' },
      },
    ],
  }
  const res = await request.put('/__annotask/api/design-session', {
    headers: { Origin: ORIGIN },
    data: doc,
  })
  expect(res.ok()).toBe(true)
}

// UI half of the agent-apply loop (no provider configured in e2e, so the
// minted task waits for an agent — the full live loop is covered by
// src/server/__tests__/apply-session-matrix.test.ts with real CLIs).
test.describe('Vue + Vite design-session apply (UI)', () => {
  test.beforeEach(async ({ page, request }) => {
    await skipInitWizard(request, ORIGIN)
    await discardDesignSession(request, ORIGIN)
    await resetWorkspaceState(request, ORIGIN)
    await interceptPlanetsApi(page)
  })

  test.afterEach(async ({ request }) => {
    // Server-owned discard also unwinds anything a failing test left behind.
    await resetWorkspaceState(request, ORIGIN)
    await discardDesignSession(request, ORIGIN)
  })

  test('Apply now mints ONE task with context.session, snapshots the file, and statuses round-trip', async ({ page, request }) => {
    await seedStyleEntry(request)
    await bootDesignShell(page)
    const frame = page.frameLocator('.app-iframe')
    await expect(frame.locator('h1.title')).toHaveText('Planets', { timeout: 15_000 })

    // The session panel lives in the Components section.
    await page.locator('.toolbar button', { hasText: 'Components' }).click()
    const panel = page.locator('[data-testid="design-session-panel"]')
    await expect(panel).toBeVisible({ timeout: 10_000 })
    await expect(panel.locator('.session-chip.pending')).toHaveCount(1)

    await panel.locator('.session-apply').click()

    // Entries flip to applying against a minted task + sealed snapshot batch.
    await expect.poll(async () => {
      const session = await getDesignSession(request)
      return session.entries.map((e) => (e.live as { status: string }).status)
    }, { timeout: 10_000 }).toEqual(['applying'])

    const session = await getDesignSession(request)
    const taskId = String(session.entries[0].taskId)
    expect(taskId).toBeTruthy()

    const tasks = (await (await request.get('/__annotask/api/tasks')).json()).tasks as Array<Record<string, unknown>>
    const task = tasks.find((t) => t.id === taskId)!
    expect(task.type).toBe('wireframe_apply')
    const ctx = task.context as { session: { entries: Array<Record<string, unknown>> } }
    expect(ctx.session.entries).toHaveLength(1)

    const snapshots = await (await request.get('/__annotask/api/design-session/snapshots')).json() as { files: Record<string, unknown>; batches: Array<{ taskId: string }> }
    expect(Object.keys(snapshots.files).some((f) => f.includes('PlanetsPage.vue'))).toBe(true)
    expect(snapshots.batches[0]?.taskId).toBe(taskId)

    // No agent ran (no provider in e2e): deleting the task releases the
    // entries back to pending — the work is never silently lost.
    await request.delete(`/__annotask/api/tasks/${taskId}`, { headers: { Origin: ORIGIN } })
    await expect.poll(async () => {
      const after = await getDesignSession(request)
      return after.entries.map((e) => (e.live as { status: string }).status)
    }, { timeout: 5_000 }).toEqual(['pending'])
  })
})
