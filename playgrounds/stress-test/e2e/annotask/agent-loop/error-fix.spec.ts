/**
 * error_fix agent loop — inject a `console.error` tracer into the
 * AgentLoopTarget, confirm the shell's error monitor catches it, seed
 * an error_fix task pointing at the marker line, run the simulator
 * to delete the marker line, and verify the error stops firing.
 */
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { APPS, apiUrl } from '../fixtures/apps'
import { AnnotaskShell } from '../fixtures/annotask-page'
import { SEL } from '../helpers/selectors'
import { AGENT_LOOP_APPS, capture, restore, type CapturedFile } from '../helpers/agent-loop/targets'
import { applyErrorFix } from '../helpers/agent-loop/simulator'
import { emptyMetric, writeMetric, type RunMetric } from '../helpers/agent-loop/metrics'

const FEATURE_GROUP = 'agent-loop'
const FEATURE_ID = 'error-fix'
const TRACER = 'e2e-agent-loop-error-tracer'

/** Inject a `console.error` call into the AgentLoopTarget render path.
 *  For React, we inject above the `<section …>` JSX (legal inside
 *  fragment-free returns we control). For Vue, we inject inside the
 *  `<script setup>` block. */
function breakWithErrorTracer(file: string): string {
  if (file.includes('<script setup')) {
    // Vue SFC — append the error line at the end of <script setup>.
    return file.replace(
      /<\/script>/,
      `console.error('${TRACER}') // ${TRACER}\n</script>`,
    )
  }
  // React/TSX — drop the error inside the component body before the
  // JSX `return`. Match the closing brace of `useShowTarget(...)` line
  // and append on a new line.
  return file.replace(
    /export function AgentLoopTarget\(\): JSX\.Element \| null \{\n(\s+)const show = useShowTarget\(\)/,
    `export function AgentLoopTarget(): JSX.Element | null {\n$1const show = useShowTarget()\n$1console.error('${TRACER}') // ${TRACER}`,
  )
}

for (const target of AGENT_LOOP_APPS) {
  const app = APPS.find(a => a.id === target.id)
  if (!app) throw new Error(`agent-loop target ${target.id} is not in APPS`)

  test.describe(`[${target.id}] agent-loop · error_fix`, () => {
    test.describe.configure({ mode: 'serial' })

    let captured: CapturedFile[] = []
    let metric: RunMetric

    test.beforeEach(async () => {
      captured = capture([target.componentPath])
      metric = emptyMetric('error_fix', target.id, target.framework)
      const broken = breakWithErrorTracer(captured[0].contents)
      if (broken === captured[0].contents) {
        throw new Error(
          `error_fix seed: could not inject tracer into ${target.componentPath}`,
        )
      }
      writeFileSync(target.componentPath, broken)
    })

    test.afterEach(async () => {
      restore(captured)
      writeMetric(metric)
    })

    test('agent removes throwing line and console error stops firing', async ({ page, request }) => {
      test.info().annotations.push({
        type: 'matrix',
        description: `${target.id}/${FEATURE_GROUP}/${FEATURE_ID}`,
      })

      // 1. Open the shell and route the iframe to the target hash.
      const consoleErrors: string[] = []
      page.on('console', msg => {
        if (msg.type() === 'error' && msg.text().includes(TRACER)) {
          consoleErrors.push(msg.text())
        }
      })

      const shell = new AnnotaskShell(page, app)
      await shell.open()
      await page.locator(SEL.inputRoute).fill('/#agent-loop-target')
      await page.locator(SEL.inputRoute).press('Enter')
      await expect(page.locator(SEL.iframe)).toBeVisible()

      // 2. Confirm the shell's error monitor catches the tracer.
      await shell.gotoAuditSection('errors')
      await expect.poll(async () => {
        const rows = page.locator(SEL.errorRow)
        const count = await rows.count()
        for (let i = 0; i < count; i++) {
          const text = (await rows.nth(i).textContent()) ?? ''
          if (text.includes(TRACER)) return true
        }
        return false
      }, { timeout: 15_000 }).toBe(true)

      // 3. Seed the error_fix task with the marker line as anchor.
      const desc = `agent-loop error_fix · ${target.id} · ${Date.now()}`
      const seedRes = await request.post(apiUrl(app, '/tasks'), {
        data: {
          type: 'error_fix',
          description: desc,
          file: target.componentPath,
          line: 1,
          context: {
            message: TRACER,
            marker: TRACER,
            severity: 'error',
          },
        },
      })
      expect(seedRes.ok(), `seed POST failed: ${await seedRes.text()}`).toBeTruthy()
      const taskId = (await seedRes.json()).task?.id ?? (await seedRes.json()).id
      expect(taskId).toBeTruthy()
      metric.task_id = taskId

      // 4. Run the simulator: strip the tracer line.
      const started = Date.now()
      let result
      try {
        result = await applyErrorFix({
          taskId,
          port: app.port,
          componentPath: target.componentPath,
          marker: TRACER,
        })
      } catch (err) {
        metric.error_message = err instanceof Error ? err.message : String(err)
        throw err
      }
      metric.time_to_apply_ms = Date.now() - started
      metric.resolution = result.resolution

      // 5. Reload iframe, observe no further tracer errors.
      consoleErrors.length = 0
      await page.locator(SEL.inputRoute).fill('/#agent-loop-target')
      await page.locator(SEL.inputRoute).press('Enter')
      await page.waitForTimeout(2_000) // HMR settle window
      expect(
        consoleErrors,
        `tracer console.error still firing after fix: ${consoleErrors.join(' | ')}`,
      ).toHaveLength(0)

      // 6. Verify task state.
      const taskRes = await request.get(apiUrl(app, `/tasks/${taskId}`))
      const task = (await taskRes.json()).task ?? (await taskRes.json())
      expect(task.status).toBe('review')

      metric.outcome = 'success'
    })
  })
}
