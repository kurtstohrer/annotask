/**
 * a11y_fix agent loop — produce an image-alt violation, let the shell's
 * axe-core scan catch it, seed an a11y_fix task with the rule context,
 * then run the simulator (deterministic image-alt fix) and verify the
 * violation is gone after re-scan.
 */
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { APPS, apiUrl } from '../fixtures/apps'
import { AnnotaskShell } from '../fixtures/annotask-page'
import { SEL } from '../helpers/selectors'
import { AGENT_LOOP_APPS, capture, restore, type CapturedFile } from '../helpers/agent-loop/targets'
import { applyA11yFix } from '../helpers/agent-loop/simulator'
import { emptyMetric, writeMetric, type RunMetric } from '../helpers/agent-loop/metrics'

const FEATURE_GROUP = 'agent-loop'
const FEATURE_ID = 'a11y-fix'

/** Remove the `alt=""` (or `alt=...`) attribute from the AgentLoopTarget
 *  image. Keeps the file syntactically valid in both JSX and Vue
 *  templates because we control the markup. */
function breakImageAlt(file: string): string {
  return file.replace(/<img([^>]*?)\salt=("[^"]*"|\{[^}]*\})([^>]*)>/g, '<img$1$3>')
}

for (const target of AGENT_LOOP_APPS) {
  const app = APPS.find(a => a.id === target.id)
  if (!app) throw new Error(`agent-loop target ${target.id} is not in APPS`)

  test.describe(`[${target.id}] agent-loop · a11y_fix`, () => {
    test.describe.configure({ mode: 'serial' })

    let captured: CapturedFile[] = []
    let metric: RunMetric

    test.beforeEach(async () => {
      captured = capture([target.componentPath, target.cssPath])
      metric = emptyMetric('a11y_fix', target.id, target.framework)
      // Seed the broken state: image with no alt attribute.
      const broken = breakImageAlt(captured[0].contents)
      if (broken === captured[0].contents) {
        throw new Error(
          `a11y_fix seed: could not break alt= attribute in ${target.componentPath}`,
        )
      }
      writeFileSync(target.componentPath, broken)
    })

    test.afterEach(async () => {
      restore(captured)
      writeMetric(metric)
    })

    test('agent fixes image-alt violation surfaced by axe scan', async ({ page, request }) => {
      test.info().annotations.push({
        type: 'matrix',
        description: `${target.id}/${FEATURE_GROUP}/${FEATURE_ID}`,
      })

      // 1. Load the iframe at the target hash and confirm the
      //    violation is surfaced by the shell's axe-core scan.
      await page.goto(`http://localhost:${target.port}/#agent-loop-target`)
      await expect(page.locator("[data-agent-loop-target='image']")).toBeVisible({ timeout: 10_000 })

      const shell = new AnnotaskShell(page, app)
      await shell.open()
      // Route the iframe to the target hash via the toolbar input.
      await page.locator(SEL.inputRoute).fill('/#agent-loop-target')
      await page.locator(SEL.inputRoute).press('Enter')

      await shell.gotoAuditSection('a11y')
      await page.locator(SEL.btnScanA11y).click()
      await expect.poll(async () => {
        return page.locator(SEL.a11yViolation).count()
      }, { timeout: 15_000 }).toBeGreaterThan(0)

      // 2. Seed the a11y_fix task explicitly. (We could click the
      //    shell's "Create Fix Task" button instead — that path is
      //    exercised in `annotate.spec.ts` — but here we want a
      //    deterministic task shape for the simulator.)
      const desc = `agent-loop a11y_fix image-alt · ${target.id} · ${Date.now()}`
      const seedRes = await request.post(apiUrl(app, '/tasks'), {
        data: {
          type: 'a11y_fix',
          description: desc,
          file: target.componentPath,
          line: 1,
          context: {
            rule: 'image-alt',
            impact: 'serious',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
            selector: "[data-agent-loop-target='image']",
          },
        },
      })
      expect(seedRes.ok(), `seed POST failed: ${await seedRes.text()}`).toBeTruthy()
      const taskId = (await seedRes.json()).task?.id ?? (await seedRes.json()).id
      expect(taskId).toBeTruthy()
      metric.task_id = taskId

      // 3. Run the simulator: deterministic alt="" injection.
      const started = Date.now()
      let result
      try {
        result = await applyA11yFix({
          taskId,
          port: app.port,
          componentPath: target.componentPath,
          rule: 'image-alt',
        })
      } catch (err) {
        metric.error_message = err instanceof Error ? err.message : String(err)
        throw err
      }
      metric.time_to_apply_ms = Date.now() - started
      metric.resolution = result.resolution

      // 4. Reload iframe (HMR may have already applied), re-scan,
      //    expect violation count to be zero (or at least drop).
      await page.locator(SEL.inputRoute).fill('/#agent-loop-target')
      await page.locator(SEL.inputRoute).press('Enter')
      await page.locator(SEL.btnScanA11y).click()
      await expect.poll(async () => {
        const rows = page.locator(SEL.a11yViolation)
        const count = await rows.count()
        let imageAltStill = 0
        for (let i = 0; i < count; i++) {
          const text = (await rows.nth(i).textContent()) ?? ''
          if (text.toLowerCase().includes('image-alt') || text.toLowerCase().includes('alternative text')) {
            imageAltStill++
          }
        }
        return imageAltStill
      }, { timeout: 15_000 }).toBe(0)

      // 5. Verify task state.
      const taskRes = await request.get(apiUrl(app, `/tasks/${taskId}`))
      const task = (await taskRes.json()).task ?? (await taskRes.json())
      expect(task.status).toBe('review')

      metric.outcome = 'success'
    })
  })
}
