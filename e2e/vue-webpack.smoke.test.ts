import { test, expect } from '@playwright/test'

const ANNOTASK_URL = 'http://localhost:24678'
const APP_URL = 'http://localhost:8090'

test.describe('Vue + Webpack smoke', () => {
  test('app loads with data-annotask attributes', async ({ page }) => {
    await page.goto(APP_URL + '/continents')
    await page.waitForLoadState('networkidle')

    // App header renders
    await expect(page.locator('.brand-text', { hasText: 'Earth Explorer' })).toBeVisible({ timeout: 15_000 })

    // Transform injected data attributes
    const annotated = page.locator('[data-annotask-file]').first()
    await expect(annotated).toBeVisible({ timeout: 10_000 })

    const line = await annotated.getAttribute('data-annotask-line')
    expect(line).toBeTruthy()
  })

  test('toggle button injected into app', async ({ page }) => {
    await page.goto(APP_URL + '/')
    await page.waitForLoadState('networkidle')

    // The Annotask toggle button should be injected in the bottom-right
    await expect(page.locator('button[aria-label="Open Annotask design tool"]')).toBeVisible({ timeout: 10_000 })
  })

  test('standalone annotask server responds', async ({ request }) => {
    // Wait for the standalone server (started by webpack plugin) to be ready
    await expect(async () => {
      const response = await request.get(ANNOTASK_URL + '/__annotask/api/status')
      expect(response.ok()).toBe(true)
    }).toPass({ timeout: 15_000 })
  })

  test('shell loads with app in iframe', async ({ page }) => {
    // Wait for standalone server
    await expect(async () => {
      const res = await page.request.get(ANNOTASK_URL + '/__annotask/api/status')
      expect(res.ok()).toBe(true)
    }).toPass({ timeout: 15_000 })

    // Open shell with appUrl pointing to webpack dev server
    await page.goto(ANNOTASK_URL + '/__annotask/?appUrl=' + encodeURIComponent(APP_URL + '/'))
    await page.waitForLoadState('networkidle')

    await expect(page.locator('.toolbar')).toBeVisible({ timeout: 15_000 })

    const iframe = page.locator('.app-iframe')
    await expect(iframe).toBeVisible({ timeout: 15_000 })

    // App content visible in cross-origin iframe
    const frame = page.frameLocator('.app-iframe')
    await expect(frame.locator('.brand-text', { hasText: 'Earth Explorer' })).toBeVisible({ timeout: 15_000 })
  })

  test('report API responds', async ({ request }) => {
    await expect(async () => {
      const response = await request.get(ANNOTASK_URL + '/__annotask/api/report')
      expect(response.ok()).toBe(true)
      const body = await response.json()
      expect(body === null || body.version === '1.0').toBe(true)
    }).toPass({ timeout: 15_000 })
  })
})
