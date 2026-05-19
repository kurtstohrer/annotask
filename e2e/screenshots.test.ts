import { test, expect } from '@playwright/test'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'docs', 'media', 'screenshots')
const MARKETING_OUT = join(__dirname, '..', 'playgrounds', 'simple', 'marketing', 'public', 'screenshots')
mkdirSync(OUT, { recursive: true })
mkdirSync(MARKETING_OUT, { recursive: true })

/** Wait for the Annotask shell to be fully loaded */
async function waitForShell(page: import('@playwright/test').Page) {
  await page.goto('/__annotask/')
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('.toolbar')).toBeVisible({ timeout: 15_000 })

  // Dismiss init wizard if it appears
  const closeBtn = page.locator('.init-modal-close')
  try {
    await closeBtn.click({ timeout: 3000 })
    await page.waitForTimeout(500)
  } catch {
    // No init wizard — continue
  }

  // Wait for iframe content to render
  const frame = page.frameLocator('.app-iframe')
  await frame.locator('body').waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForTimeout(1500)
  return frame
}

function shot(name: string) {
  return { path: join(OUT, name), fullPage: false }
}

/** Save to both docs/media and marketing public */
async function saveShot(page: import('@playwright/test').Page, name: string) {
  await page.screenshot({ path: join(OUT, name), fullPage: false })
  const { copyFileSync } = await import('fs')
  copyFileSync(join(OUT, name), join(MARKETING_OUT, name))
}

test.describe('Marketing screenshots', () => {
  test.describe.configure({ mode: 'serial' })

  test('shell-overview', async ({ page }) => {
    await waitForShell(page)
    // Small delay for animations to settle
    await page.waitForTimeout(1000)
    await saveShot(page, 'shell-overview.png')
  })

  test('annotate-pins', async ({ page }) => {
    const frame = await waitForShell(page)

    // Ensure we're in Annotate view
    await page.locator('[data-testid="tab-annotate"]').click()
    // Switch to pin mode
    await page.locator('[data-testid="tool-pin"]').click()

    // Click several elements in the iframe to create pins
    const targets = ['.brand-title', 'nav a:first-child', 'nav a:nth-child(2)', '.card:first-child']
    for (const selector of targets) {
      try {
        await frame.locator(selector).first().click({ timeout: 3000 })
        await page.waitForTimeout(300)
      } catch {
        // Some elements may not exist on every route, skip
      }
    }
    await page.waitForTimeout(500)
    await saveShot(page, 'annotate-pins.png')
  })

  test('annotate-arrows', async ({ page }) => {
    const frame = await waitForShell(page)

    await page.locator('[data-testid="tab-annotate"]').click()
    // Switch to arrow mode
    await page.locator('[data-testid="tool-arrow"]').click()

    // Draw arrows by clicking source then target elements
    const pairs = [
      ['.brand-title', 'nav a:first-child'],
      ['nav a:first-child', 'nav a:nth-child(2)'],
    ]
    for (const [src, tgt] of pairs) {
      try {
        await frame.locator(src).first().click({ timeout: 3000 })
        await page.waitForTimeout(200)
        await frame.locator(tgt).first().click({ timeout: 3000 })
        await page.waitForTimeout(300)
      } catch {
        // Skip if elements not found
      }
    }
    await page.waitForTimeout(500)
    await saveShot(page, 'annotate-arrows.png')
  })

  test('annotate-sections', async ({ page }) => {
    await waitForShell(page)

    await page.locator('[data-testid="tab-annotate"]').click()
    // Switch to draw mode
    await page.locator('[data-testid="tool-draw"]').click()

    // Draw a section by dragging on the iframe area
    const iframe = page.locator('.app-iframe')
    const box = await iframe.boundingBox()
    if (box) {
      const startX = box.x + box.width * 0.1
      const startY = box.y + box.height * 0.15
      const endX = box.x + box.width * 0.6
      const endY = box.y + box.height * 0.5
      await page.mouse.move(startX, startY)
      await page.mouse.down()
      await page.mouse.move(endX, endY, { steps: 10 })
      await page.mouse.up()
    }
    await page.waitForTimeout(500)
    await saveShot(page, 'annotate-sections.png')
  })

  test('annotate-highlights', async ({ page }) => {
    const frame = await waitForShell(page)

    await page.locator('[data-testid="tab-annotate"]').click()
    // Switch to highlight mode
    await page.locator('[data-testid="tool-highlight"]').click()

    // Try to select text in the iframe
    try {
      const textEl = frame.locator('h1, h2, .brand-title').first()
      const textBox = await textEl.boundingBox()
      if (textBox) {
        await page.mouse.click(textBox.x + 5, textBox.y + textBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(textBox.x + textBox.width - 5, textBox.y + textBox.height / 2, { steps: 10 })
        await page.mouse.up()
      }
    } catch {
      // Fallback — just show highlight mode active
    }
    await page.waitForTimeout(500)
    await saveShot(page, 'annotate-highlights.png')
  })

  test('design-tokens', async ({ page }) => {
    await waitForShell(page)
    await page.locator('[data-testid="tab-design"]').click()
    await page.locator('[data-testid="design-tokens"]').click()
    await page.waitForTimeout(500)
    await saveShot(page, 'design-tokens.png')
  })

  test('design-inspector', async ({ page }) => {
    const frame = await waitForShell(page)
    await page.locator('[data-testid="tab-design"]').click()
    await page.locator('[data-testid="design-inspector"]').click()

    // Try to select an element to show inspector
    try {
      const selectBtn = page.locator('[data-testid="tool-select"]')
      if (await selectBtn.isVisible({ timeout: 2000 })) {
        await selectBtn.click()
      }
      await frame.locator('h1, header, .brand-title').first().click({ timeout: 3000 })
      await page.waitForTimeout(500)
    } catch {
      // Element selection may not work — just show the inspector tab
    }
    await page.waitForTimeout(500)
    await saveShot(page, 'design-inspector.png')
  })

  test('design-components', async ({ page }) => {
    await waitForShell(page)
    await page.locator('[data-testid="tab-design"]').click()
    await page.locator('[data-testid="design-components"]').click()
    await page.waitForTimeout(500)
    await saveShot(page, 'design-components.png')
  })

  test('audit-a11y', async ({ page }) => {
    await waitForShell(page)
    await page.locator('[data-testid="tab-audit"]').click()
    await page.locator('[data-testid="audit-a11y"]').click()

    // Try to run a11y scan
    try {
      const scanBtn = page.locator('[data-testid="btn-scan-a11y"], button:has-text("Scan"), button:has-text("Run")')
      await scanBtn.first().click({ timeout: 3000 })
      await page.waitForTimeout(5000)
    } catch {
      // Button may not exist or scan may not complete
      await page.waitForTimeout(1000)
    }
    await saveShot(page, 'audit-a11y.png')
  })

  test('audit-perf', async ({ page }) => {
    await waitForShell(page)
    await page.locator('[data-testid="tab-audit"]').click()
    await page.locator('[data-testid="audit-perf"]').click()

    // Try to run perf scan
    try {
      const scanBtn = page.locator('[data-testid="btn-scan-perf"], button:has-text("Scan"), button:has-text("Run")')
      await scanBtn.first().click({ timeout: 3000 })
      await page.waitForTimeout(5000)
    } catch {
      await page.waitForTimeout(1000)
    }
    await saveShot(page, 'audit-perf.png')
  })

  test('audit-errors', async ({ page }) => {
    await waitForShell(page)
    await page.locator('[data-testid="tab-audit"]').click()
    await page.locator('[data-testid="audit-errors"]').click()
    await page.waitForTimeout(1000)
    await saveShot(page, 'audit-errors.png')
  })

  test('task-detail', async ({ page }) => {
    const frame = await waitForShell(page)

    // Create a pin to generate a task
    await page.locator('[data-testid="tab-annotate"]').click()

    try {
      await page.locator('[data-testid="tool-pin"]').click({ timeout: 3000 })
    } catch {
      // Pin tool might already be active or use different selector
    }

    try {
      await frame.locator('h1, header, .brand-title').first().click({ timeout: 3000 })
      await page.waitForTimeout(1000)

      // Try to submit the pending task
      const submitBtn = page.locator('button:has-text("Create"), button:has-text("Add Task"), button:has-text("Submit")')
      if (await submitBtn.first().isVisible({ timeout: 2000 })) {
        await submitBtn.first().click()
        await page.waitForTimeout(500)
      }

      // Try to open task detail
      const taskCard = page.locator('.task-card, [class*="task-card"], [class*="task-item"]').first()
      if (await taskCard.isVisible({ timeout: 2000 })) {
        await taskCard.click()
        await page.waitForTimeout(500)
      }
    } catch {
      // Show whatever state we ended up in
    }
    await page.waitForTimeout(500)
    await saveShot(page, 'task-detail.png')
  })
})
