import { test, expect } from '@playwright/test'

test.describe('Astro smoke', () => {
  test('shell loads and renders app in iframe', async ({ page }) => {
    await page.goto('/__annotask/')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('.toolbar')).toBeVisible({ timeout: 15_000 })

    const iframe = page.locator('.app-iframe')
    await expect(iframe).toBeVisible({ timeout: 15_000 })

    const frame = page.frameLocator('.app-iframe')
    await expect(frame.locator('.logo')).toBeVisible({ timeout: 10_000 })

    await expect(page.locator('.route-indicator')).toBeVisible()
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
