import { expect, test } from '@playwright/test'

test('host renders overview and lists every MFE', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Host (single-spa root)' })).toBeVisible()

  // Every MFE must appear in the navigation and the overview table.
  const mfes = [
    'Vue · Data Lab',
    'React · Workflows',
    'Svelte · Streaming',
    'Solid · Component Lab',
    'Blade · Legacy Lab',
    'htmx · Partials',
  ]
  for (const label of mfes) {
    await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible()
  }
})

test('selecting an MFE iframes it into the host viewport', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Vue · Data Lab/ }).click()

  const frame = page.frameLocator('iframe[title="Vue · Data Lab"]')
  await expect(frame.getByRole('heading', { name: 'Vue Data Lab' })).toBeVisible()
})
