/**
 * style_update agent loop — annotate a styled element, simulator
 * rewrites the tracer stylesheet, iframe DOM picks the change up via
 * Vite HMR.
 *
 * v1 caveat: the apply step is rule-based, not LLM-driven (see
 * `docs/agent-loop-evals.md`). The test exercises the full task
 * lifecycle (pending → in_progress → review) and verifies the rendered
 * DOM, but does not yet exercise the shell's inspector tool to create
 * the task — the seed goes straight through the per-MFE API.
 */
import { test, expect } from '@playwright/test'
import { APPS, apiUrl } from '../fixtures/apps'
import { AnnotaskShell } from '../fixtures/annotask-page'
import { SEL } from '../helpers/selectors'
import { AGENT_LOOP_APPS, capture, restore, type CapturedFile } from '../helpers/agent-loop/targets'
import { applyStyleUpdate } from '../helpers/agent-loop/simulator'
import { emptyMetric, writeMetric, type RunMetric } from '../helpers/agent-loop/metrics'

const FEATURE_GROUP = 'agent-loop'
const FEATURE_ID = 'style-update'

for (const target of AGENT_LOOP_APPS) {
  const app = APPS.find(a => a.id === target.id)
  if (!app) throw new Error(`agent-loop target ${target.id} is not in APPS`)

  test.describe(`[${target.id}] agent-loop · style_update`, () => {
    test.describe.configure({ mode: 'serial' })

    let captured: CapturedFile[] = []
    let metric: RunMetric

    test.beforeEach(async () => {
      captured = capture([target.cssPath, target.componentPath])
      metric = emptyMetric('style_update', target.id, target.framework)
    })

    test.afterEach(async () => {
      restore(captured)
      writeMetric(metric)
    })

    test('agent applies color token swap and iframe re-renders', async ({ page, request }) => {
      test.info().annotations.push({
        type: 'matrix',
        description: `${target.id}/${FEATURE_GROUP}/${FEATURE_ID}`,
      })

      // 1. Seed the style_update task via the per-MFE API. The
      //    `context.changes` block mirrors what the shell's inspector
      //    emits today (see src/shell/composables/useStyleEditor.ts).
      const desc = `agent-loop style_update · ${target.id} · ${Date.now()}`
      const seedRes = await request.post(apiUrl(app, '/tasks'), {
        data: {
          type: 'style_update',
          description: desc,
          file: target.cssPath,
          line: 4,
          context: {
            element: "[data-agent-loop-target='paragraph']",
            changes: [
              {
                type: 'style_update',
                element: "[data-agent-loop-target='paragraph']",
                property: 'color',
                before: 'rgb(255, 0, 0)',
                after: 'rgb(0, 128, 0)',
              },
            ],
          },
        },
      })
      expect(seedRes.ok(), `seed POST failed: ${await seedRes.text()}`).toBeTruthy()
      const seedBody = await seedRes.json()
      const taskId = seedBody.task?.id ?? seedBody.id
      expect(taskId).toBeTruthy()
      metric.task_id = taskId

      // 2. Drive the shell — boots, shows the seeded task in the panel.
      const shell = new AnnotaskShell(page, app)
      await shell.open()
      await shell.openTasksPanel()
      await expect(
        page.locator(SEL.taskCard).filter({ hasText: desc }),
      ).toBeVisible({ timeout: 5_000 })

      // 3. Run the simulator (same MCP-CLI sequence a real agent
      //    follows). It locks, rewrites the CSS, and marks `review`.
      const started = Date.now()
      let result
      try {
        result = await applyStyleUpdate({
          taskId,
          port: app.port,
          cssPath: target.cssPath,
          selector: "[data-agent-loop-target='paragraph']",
          property: 'color',
          before: 'rgb(255, 0, 0)',
          after: 'rgb(0, 128, 0)',
        })
      } catch (err) {
        metric.error_message = err instanceof Error ? err.message : String(err)
        throw err
      }
      metric.time_to_apply_ms = Date.now() - started
      metric.resolution = result.resolution

      // 4. Verify the iframe DOM picks up the HMR-applied change.
      //    We load the dev app directly with the target hash so the
      //    AgentLoopTarget component mounts and the tracer stylesheet
      //    is in scope.
      await page.goto(`http://localhost:${target.port}/#agent-loop-target`)
      const targetEl = page.locator("[data-agent-loop-target='paragraph']")
      await expect(targetEl).toBeVisible({ timeout: 10_000 })
      await expect.poll(async () => {
        return await targetEl.evaluate(el => getComputedStyle(el).color)
      }, { timeout: 10_000 }).toBe('rgb(0, 128, 0)')

      // 5. Verify task transitioned to review with a resolution note.
      const taskRes = await request.get(apiUrl(app, `/tasks/${taskId}`))
      expect(taskRes.ok()).toBeTruthy()
      const taskBody = await taskRes.json()
      const task = taskBody.task ?? taskBody
      expect(task.status).toBe('review')
      expect(task.resolution).toBeTruthy()

      metric.outcome = 'success'
    })
  })
}
