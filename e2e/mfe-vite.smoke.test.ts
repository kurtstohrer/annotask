import { test, expect } from '@playwright/test'

test.describe('MFE + Vite smoke', () => {
  test('app loads with planet data', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // NavBar renders with MFE tag
    await expect(page.locator('.brand-tag')).toHaveText('MFE')

    // Dashboard loads planet stats from API
    await expect(page.locator('.stat-card').first()).toBeVisible({ timeout: 10_000 })

    // Planet ranking renders
    await expect(page.locator('.rank-row').first()).toBeVisible({ timeout: 10_000 })
  })

  test('planets page loads with table and search', async ({ page }) => {
    await page.goto('/planets')
    await page.waitForLoadState('networkidle')

    // Table renders with planet rows
    await expect(page.locator('.table tbody tr').first()).toBeVisible({ timeout: 10_000 })

    // Search works
    await page.locator('.search').fill('jupiter')
    const rows = page.locator('.table tbody tr')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Jupiter')
  })

  test('moons page loads with filter buttons', async ({ page }) => {
    await page.goto('/moons')
    await page.waitForLoadState('networkidle')

    // Table renders
    await expect(page.locator('.table tbody tr').first()).toBeVisible({ timeout: 10_000 })

    // Planet filter buttons present
    await expect(page.locator('.filter-btn').first()).toBeVisible()
  })

  test('transform injects data-annotask-mfe attribute', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Elements should have data-annotask-mfe from the MFE Vite transform
    const mfeEl = page.locator('[data-annotask-mfe="@test/mfe-child"]').first()
    await expect(mfeEl).toBeVisible({ timeout: 10_000 })

    // Should also have standard annotask attributes
    const file = await mfeEl.getAttribute('data-annotask-file')
    expect(file).toBeTruthy()

    const line = await mfeEl.getAttribute('data-annotask-line')
    expect(line).toBeTruthy()
  })

  test('annotask shell loads in standalone MFE mode', async ({ page }) => {
    await page.goto('/__annotask/')
    await page.waitForLoadState('networkidle')

    // Shell toolbar renders
    await expect(page.locator('.toolbar')).toBeVisible({ timeout: 15_000 })

    // Iframe loads the app
    const frame = page.frameLocator('.app-iframe')
    await expect(frame.locator('.brand-text')).toBeVisible({ timeout: 10_000 })
  })

  test('annotask API responds in standalone MFE mode', async ({ request }) => {
    const response = await request.get('/__annotask/api/status')
    expect(response.ok()).toBe(true)
    const body = await response.json()
    expect(body.tool).toBe('annotask')
  })

  test('tasks API supports mfe filter', async ({ request }) => {
    // Create a task with mfe field
    await request.post('/__annotask/api/tasks', {
      data: { type: 'annotation', description: 'test', file: 'src/App.vue', line: 1, mfe: '@test/mfe-child' },
    })
    // Create a task without mfe
    await request.post('/__annotask/api/tasks', {
      data: { type: 'annotation', description: 'other', file: 'src/Other.vue', line: 1, mfe: '@other/app' },
    })

    // Unfiltered returns both
    const all = await (await request.get('/__annotask/api/tasks')).json()
    expect(all.tasks.length).toBeGreaterThanOrEqual(2)

    // Filtered returns only matching mfe
    const filtered = await (await request.get('/__annotask/api/tasks?mfe=@test/mfe-child')).json()
    expect(filtered.tasks.every((t: any) => t.mfe === '@test/mfe-child')).toBe(true)
  })
})
