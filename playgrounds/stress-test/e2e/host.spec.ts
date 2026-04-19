import { expect, test } from '@playwright/test'

test('host renders overview and lists every MFE', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Host (single-spa root)' })).toBeVisible()

  // Nav is made of <a> links with the hash route. Every MFE must appear.
  const mfes = [
    'Vue · Data Lab',
    'React · Workflows',
    'Svelte · Streaming',
    'Solid · Component Lab',
    'Blade · Legacy Lab',
    'htmx · Partials',
  ]
  for (const label of mfes) {
    await expect(page.getByRole('link', { name: new RegExp(label) })).toBeVisible()
  }
})

// ── single-spa route mounts ────────────────────────────────
// Each MFE is loaded into the host's DOM as a real single-spa application
// (ESM cross-origin import of src/single-spa.*), not an iframe. These
// tests click the nav link and assert the MFE's heading renders inside
// the host document — no iframe traversal needed.

interface SpaMfe {
  label: string
  hash: string
  heading: string
}

const spaMfes: SpaMfe[] = [
  { label: 'Vue · Data Lab',        hash: '#/vue',    heading: 'Vue Data Lab' },
  { label: 'React · Workflows',     hash: '#/react',  heading: 'React Workflows' },
  { label: 'Svelte · Streaming',    hash: '#/svelte', heading: 'Svelte Streaming' },
  { label: 'Solid · Component Lab', hash: '#/solid',  heading: 'Solid Component Lab' },
  { label: 'htmx · Partials',       hash: '#/htmx',   heading: 'htmx Partials' },
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

test('single-spa mounts Blade Legacy Lab as an iframe under #/blade', async ({ page, request }) => {
  const probe = await request
    .get('http://localhost:4350/api/health', { failOnStatusCode: false })
    .catch(() => null)
  test.skip(!probe || !probe.ok(), 'Laravel service not running — start with `just laravel`')

  await page.goto('/')
  await page.getByRole('link', { name: /Blade · Legacy Lab/ }).click()
  await expect(page).toHaveURL(/#\/blade$/)
  // Blade is iframe-mounted (single-spa legacy app pattern for SSR).
  const frame = page.frameLocator('iframe[title="Blade Legacy Lab"]')
  await expect(frame.getByRole('heading', { name: 'Blade Legacy Lab' })).toBeVisible()
})
