import { test, expect } from '@playwright/test'

test.describe('Vue + Vite smoke', () => {
  test('shell loads and renders app in iframe', async ({ page }) => {
    await page.goto('/__annotask/')
    await page.waitForLoadState('networkidle')

    // Shell toolbar renders
    await expect(page.locator('.toolbar')).toBeVisible({ timeout: 15_000 })

    // Iframe loads the app
    const iframe = page.locator('.app-iframe')
    await expect(iframe).toBeVisible({ timeout: 15_000 })

    // App header visible inside iframe
    const frame = page.frameLocator('.app-iframe')
    await expect(frame.locator('.brand-title')).toBeVisible({ timeout: 10_000 })

    // Route indicator shows current path
    await expect(page.locator('.route-indicator')).toBeVisible()
  })

  test('transform injects data-annotask attributes', async ({ page }) => {
    await page.goto('/planets')
    await page.waitForLoadState('networkidle')

    // Elements should have data-annotask-file from the Vite transform
    const annotated = page.locator('[data-annotask-file]').first()
    await expect(annotated).toBeVisible({ timeout: 10_000 })

    // Should also have line numbers
    const line = await annotated.getAttribute('data-annotask-line')
    expect(line).toBeTruthy()
  })

  test('element selection shows inspector panel', async ({ page }) => {
    await page.goto('/__annotask/')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.toolbar')).toBeVisible({ timeout: 15_000 })

    const frame = page.frameLocator('.app-iframe')
    await expect(frame.locator('.brand-title')).toBeVisible({ timeout: 10_000 })

    // Default mode is select — click an element in the iframe
    await frame.locator('.brand-title').click()

    // Inspector panel appears with source path info
    await expect(page.locator('.panel .source-path')).toBeVisible({ timeout: 5_000 })
  })

  test('report API responds', async ({ request }) => {
    const response = await request.get('/__annotask/api/report')
    expect(response.ok()).toBe(true)
    const body = await response.json()
    // Empty report (no changes made) or valid report structure
    expect(body === null || body.version === '1.0').toBe(true)
  })

  test('status API responds', async ({ request }) => {
    const response = await request.get('/__annotask/api/status')
    expect(response.ok()).toBe(true)
  })
})
