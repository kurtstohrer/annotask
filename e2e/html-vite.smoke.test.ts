import { test, expect } from '@playwright/test'

test.describe('HTML + Vite smoke', () => {
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

  test('transform injects data-annotask attributes', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const annotated = page.locator('[data-annotask-file]').first()
    await expect(annotated).toBeVisible({ timeout: 10_000 })

    const line = await annotated.getAttribute('data-annotask-line')
    expect(line).toBeTruthy()
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
