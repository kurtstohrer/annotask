import { test, expect } from '@playwright/test'

test.describe('Sun page', () => {
  test('navigate to Sun page via Annotask shell', async ({ page }) => {
    // Open the Annotask shell
    await page.goto('/__annotask/')
    await page.waitForLoadState('networkidle')

    // Wait for the shell to render
    await expect(page.locator('.toolbar')).toBeVisible({ timeout: 15_000 })

    // Verify the iframe loaded the app
    const iframe = page.locator('.app-iframe')
    await expect(iframe).toBeVisible({ timeout: 15_000 })
    const frame = page.frameLocator('.app-iframe')

    // Navigate to /sun inside the iframe
    // Press 'i' to enter interact mode (keyboard shortcut)
    await page.keyboard.press('i')
    await frame.locator('a', { hasText: 'Sun' }).click({ timeout: 10_000 })

    // Wait for Vue router SPA navigation
    await expect(frame.locator('.sun-title')).toHaveText('The Sun', { timeout: 10_000 })
    await expect(frame.locator('.sun-subtitle')).toBeVisible()
    await expect(frame.locator('.fact-card')).toHaveCount(8)
    await expect(frame.locator('.layer-row')).toHaveCount(6)

    // Switch back to select mode and verify route indicator
    await page.keyboard.press('v')
    await expect(page.locator('.route-indicator')).toHaveText('/sun', { timeout: 5_000 })
  })

  test('Sun page has correct content and styling', async ({ page }) => {
    await page.goto('/sun')
    await page.waitForLoadState('networkidle')

    // Hero section
    await expect(page.locator('.sun-title')).toHaveText('The Sun')
    await expect(page.locator('.sun-subtitle')).toContainText('nearest star')
    await expect(page.locator('.sun-glow')).toBeVisible()

    // Facts section
    await expect(page.locator('.section-title').first()).toHaveText('Key Facts')
    await expect(page.locator('.fact-card')).toHaveCount(8)
    await expect(page.locator('.fact-value', { hasText: 'G-type Main Sequence' })).toBeVisible()
    await expect(page.locator('.fact-value', { hasText: '4.6 billion years' })).toBeVisible()
    await expect(page.locator('.fact-value', { hasText: '696,340 km' })).toBeVisible()

    // Solar structure
    await expect(page.locator('.layer-row')).toHaveCount(6)
    await expect(page.locator('.layer-name', { hasText: 'Core' })).toBeVisible()
    await expect(page.locator('.layer-name', { hasText: 'Corona' })).toBeVisible()

    // About section
    await expect(page.locator('.description-text').first()).toContainText('nuclear fusion')
  })

  test('Sun page is accessible from header navigation', async ({ page }) => {
    await page.goto('/planets')
    await page.waitForLoadState('networkidle')

    await page.locator('.nav-link', { hasText: 'Sun' }).click()
    await expect(page).toHaveURL('/sun')
    await expect(page.locator('.sun-title')).toHaveText('The Sun')
  })
})
