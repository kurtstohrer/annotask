import { expect, test } from '@playwright/test'

interface Mfe {
  id: string
  heading: string
  url: string
}

// Native MFEs — bootable without Docker.
const mfes: Mfe[] = [
  { id: 'vue-data-lab', heading: 'Vue Data Lab', url: 'http://localhost:4220/' },
  { id: 'react-workflows', heading: 'React Workflows', url: 'http://localhost:4210/' },
  { id: 'svelte-streaming', heading: 'Svelte Streaming', url: 'http://localhost:4230/' },
  { id: 'solid-component-lab', heading: 'Solid Component Lab', url: 'http://localhost:4240/' },
  { id: 'htmx-partials', heading: 'htmx Partials', url: 'http://localhost:4260/' },
]

for (const mfe of mfes) {
  test(`mfe ${mfe.id} boots at ${mfe.url}`, async ({ page }) => {
    await page.goto(mfe.url)
    await expect(page.getByRole('heading', { name: mfe.heading })).toBeVisible()
  })
}

// Laravel serves the Blade slot at :4350 and is docker-only. Run only when
// it's actually reachable so the native-only dev flow stays green.
test('mfe blade-legacy-lab boots at http://localhost:4350/ (Laravel required)', async ({ page, request }) => {
  const probe = await request
    .get('http://localhost:4350/api/health', { failOnStatusCode: false })
    .catch(() => null)
  test.skip(!probe || !probe.ok(), 'Laravel service not running — start with `just laravel`')
  await page.goto('http://localhost:4350/')
  await expect(page.getByRole('heading', { name: 'Blade Legacy Lab' })).toBeVisible()
})
