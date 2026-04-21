import { expect, test } from '@playwright/test'

test('host renders overview with MFE cards and the sidebar mounts', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Annotask Stress Lab' })).toBeVisible()

  // Sidebar brand from the React sidebar MFE.
  await expect(page.getByRole('heading', { name: 'Annotask', level: 1 })).toBeVisible()

  // Sidebar nav links must show every MFE label, including Overview.
  const mfeLinks = [
    'Overview',
    'Vue · Data Lab',
    'React · Workflows',
    'Svelte · Streaming',
    'Solid · Components',
    'htmx · Partials',
  ]
  for (const label of mfeLinks) {
    await expect(page.getByRole('link', { name: new RegExp(label) })).toBeVisible()
  }
})

test('sidebar theme toggle flips <html data-theme>', async ({ page }) => {
  await page.goto('/')
  // The sidebar toggle button lives inside the persistent sidebar MFE.
  const toggle = page.getByRole('button', { name: 'Toggle theme' })
  await toggle.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await toggle.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

// ── single-spa route mounts ────────────────────────────────
// Each MFE is loaded into the host's DOM as a real single-spa application
// (ESM cross-origin import of src/single-spa.*), not an iframe. These
// tests click the sidebar link and assert the MFE's heading renders inside
// the host document — no iframe traversal needed.

interface SpaMfe {
  label: string
  hash: string
  heading: string
}

const spaMfes: SpaMfe[] = [
  { label: 'Vue · Data Lab',      hash: '#/vue',    heading: 'Vue Data Lab' },
  { label: 'React · Workflows',   hash: '#/react',  heading: 'React Workflows' },
  { label: 'Svelte · Streaming',  hash: '#/svelte', heading: 'Svelte Streaming' },
  { label: 'Solid · Components',  hash: '#/solid',  heading: 'Solid Component Lab' },
  { label: 'htmx · Partials',     hash: '#/htmx',   heading: 'htmx Partials' },
]

for (const mfe of spaMfes) {
  test(`single-spa mounts ${mfe.heading} at ${mfe.hash}`, async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: new RegExp(mfe.label) }).click()
    await expect(page).toHaveURL(new RegExp(mfe.hash.replace('/', '\\/') + '$'))
    // Heading is inside the host's own DOM (mounted by single-spa), NOT in an iframe.
    await expect(page.getByRole('heading', { name: mfe.heading })).toBeVisible()
  })
}
