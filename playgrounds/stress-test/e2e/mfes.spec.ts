import { expect, test } from '@playwright/test'

interface Mfe {
  id: string
  heading: string
  url: string
}

const mfes: Mfe[] = [
  { id: 'vue-data-lab', heading: 'Vue Data Lab', url: 'http://localhost:4220/' },
  { id: 'react-workflows', heading: 'React Workflows', url: 'http://localhost:4210/' },
  { id: 'svelte-streaming', heading: 'Svelte Streaming', url: 'http://localhost:4230/' },
  { id: 'solid-component-lab', heading: 'Solid Component Lab', url: 'http://localhost:4240/' },
  { id: 'blade-legacy-lab', heading: 'Blade Legacy Lab', url: 'http://localhost:4250/' },
  { id: 'htmx-partials', heading: 'htmx Partials', url: 'http://localhost:4260/' },
]

for (const mfe of mfes) {
  test(`mfe ${mfe.id} boots at ${mfe.url}`, async ({ page }) => {
    await page.goto(mfe.url)
    await expect(page.getByRole('heading', { name: mfe.heading })).toBeVisible()
  })
}
