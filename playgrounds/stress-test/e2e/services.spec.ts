import { expect, test } from '@playwright/test'

interface Service {
  name: string
  url: string
}

const services: Service[] = [
  { name: 'fastapi', url: 'http://localhost:4320/api/health' },
  { name: 'node-api', url: 'http://localhost:4340/api/health' },
  { name: 'go-api', url: 'http://localhost:4330/api/health' },
  { name: 'rust-api', url: 'http://localhost:4360/api/health' },
]

for (const svc of services) {
  test(`service ${svc.name} reports healthy`, async ({ request }) => {
    const res = await request.get(svc.url)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body).toMatchObject({ status: 'ok', service: svc.name })
  })
}

test('vue-data-lab proxies /api/health to FastAPI', async ({ request }) => {
  const res = await request.get('http://localhost:4220/api/health')
  expect(res.ok()).toBe(true)
  const body = await res.json()
  expect(body).toMatchObject({ status: 'ok', service: 'fastapi' })
})

test('htmx MFE can fetch a rendered HTML fragment from Rust', async ({ request }) => {
  const res = await request.get('http://localhost:4260/api/health-fragment')
  expect(res.ok()).toBe(true)
  const body = await res.text()
  expect(body).toContain('rust-api')
  expect(body).toContain('<dl')
})

// Docker-only services. Tests skip when the service isn't reachable so the
// native dev loop stays green; when compose is up they assert the health
// contract matches the native services.

test('service java-api reports healthy (Docker required)', async ({ request }) => {
  const probe = await request
    .get('http://localhost:4310/api/health', { failOnStatusCode: false })
    .catch(() => null)
  test.skip(!probe || !probe.ok(), 'Java service not running — start with `just java`')
  const body = await probe!.json()
  expect(body).toMatchObject({ status: 'ok', service: 'java-api' })
})

test('service java-api lists workflows (Docker required)', async ({ request }) => {
  const probe = await request
    .get('http://localhost:4310/api/health', { failOnStatusCode: false })
    .catch(() => null)
  test.skip(!probe || !probe.ok(), 'Java service not running — start with `just java`')
  const res = await request.get('http://localhost:4310/api/workflows')
  expect(res.ok()).toBe(true)
  const body = await res.json()
  expect(Array.isArray(body)).toBe(true)
  expect(body.length).toBeGreaterThan(0)
  expect(body[0]).toMatchObject({ id: expect.stringMatching(/^wf-/), status: expect.any(String) })
})

test('service laravel reports healthy (Docker required)', async ({ request }) => {
  const probe = await request
    .get('http://localhost:4350/api/health', { failOnStatusCode: false })
    .catch(() => null)
  test.skip(!probe || !probe.ok(), 'Laravel service not running — start with `just laravel`')
  const body = await probe!.json()
  expect(body).toMatchObject({ status: 'ok', service: 'laravel' })
})

test('laravel Blade home renders the workflow queue (Docker required)', async ({ page, request }) => {
  const probe = await request
    .get('http://localhost:4350/api/health', { failOnStatusCode: false })
    .catch(() => null)
  test.skip(!probe || !probe.ok(), 'Laravel service not running — start with `just laravel`')
  await page.goto('http://localhost:4350/')
  await expect(page.getByRole('heading', { name: 'Workflow queue' })).toBeVisible()
  await expect(page.getByText('New lease request')).toBeVisible()
})
