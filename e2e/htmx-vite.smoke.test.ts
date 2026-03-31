import { test, expect } from '@playwright/test'

test.describe('htmx + Vite smoke', () => {
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

  test('shell page loads', async ({ request }) => {
    const response = await request.get('/__annotask/')
    expect(response.ok()).toBe(true)
    const body = await response.text()
    expect(body).toContain('<!DOCTYPE html>')
  })
})
