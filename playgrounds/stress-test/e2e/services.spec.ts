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
