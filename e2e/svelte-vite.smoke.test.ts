import { test, expect } from '@playwright/test'

test.describe('Svelte + Vite smoke', () => {
  test('shell loads and renders app in iframe', async ({ page }) => {
    await page.goto('/__annotask/')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('.toolbar')).toBeVisible({ timeout: 15_000 })

    const iframe = page.locator('.app-iframe')
    await expect(iframe).toBeVisible({ timeout: 15_000 })

    // Svelte app header visible inside iframe
    const frame = page.frameLocator('.app-iframe')
    await expect(frame.locator('.header')).toBeVisible({ timeout: 10_000 })
    await expect(frame.locator('.logo-text', { hasText: 'Planet Explorer' })).toBeVisible()

    await expect(page.locator('.route-indicator')).toBeVisible()
  })

  test('transform injects data-annotask attributes', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const annotated = page.locator('[data-annotask-file]').first()
    await expect(annotated).toBeVisible({ timeout: 10_000 })

    const line = await annotated.getAttribute('data-annotask-line')
    expect(line).toBeTruthy()
  })

  test('element selection shows inspector panel', async ({ page }) => {
    await page.goto('/__annotask/')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.toolbar')).toBeVisible({ timeout: 15_000 })

    const frame = page.frameLocator('.app-iframe')
    await expect(frame.locator('.header')).toBeVisible({ timeout: 10_000 })

    // Click the header in the iframe
    await frame.locator('.header').click()

    await expect(page.locator('.panel .source-path')).toBeVisible({ timeout: 5_000 })
  })

  test('report API responds', async ({ request }) => {
    const response = await request.get('/__annotask/api/report')
    expect(response.ok()).toBe(true)
    const body = await response.json()
    expect(body === null || body.version === '1.0').toBe(true)
  })

  test('status API responds', async ({ request }) => {
    const response = await request.get('/__annotask/api/status')
    expect(response.ok()).toBe(true)
  })
})
