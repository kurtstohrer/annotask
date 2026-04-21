import { defineConfig, devices } from '@playwright/test'

// Stress-lab Playwright config. Boots the 5 native MFEs + host + the 4
// fast native services (fastapi, node, go, rust). Java-backed React data
// is docker-only. Specs that depend on it assert tolerant fallbacks when
// the service isn't reachable.

const webServers = [
  { name: 'stress-host', command: 'pnpm dev:stress-host', url: 'http://localhost:4200' },
  { name: 'stress-react-sidebar', command: 'pnpm dev:stress-react-sidebar', url: 'http://localhost:4250' },
  { name: 'stress-react-workflows', command: 'pnpm dev:stress-react-workflows', url: 'http://localhost:4210' },
  { name: 'stress-vue-data-lab', command: 'pnpm dev:stress-vue-data-lab', url: 'http://localhost:4220' },
  { name: 'stress-svelte-streaming', command: 'pnpm dev:stress-svelte-streaming', url: 'http://localhost:4230' },
  { name: 'stress-solid-component-lab', command: 'pnpm dev:stress-solid-component-lab', url: 'http://localhost:4240' },
  { name: 'stress-htmx-partials', command: 'pnpm dev:stress-htmx-partials', url: 'http://localhost:4260' },
  { name: 'stress-fastapi', command: 'pnpm dev:stress-fastapi', url: 'http://localhost:4320/api/health' },
  { name: 'stress-node-api', command: 'pnpm dev:stress-node-api', url: 'http://localhost:4340/api/health' },
  { name: 'stress-go-api', command: 'pnpm dev:stress-go-api', url: 'http://localhost:4330/api/health' },
  { name: 'stress-rust-api', command: 'pnpm dev:stress-rust-api', url: 'http://localhost:4360/api/health' },
]

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 7,
  retries: 0,
  reporter: [['list'], ['./annotask/reporter.ts']],
  use: {
    trace: 'on-first-retry',
    baseURL: 'http://localhost:4200',
    ...devices['Desktop Chrome'],
  },
  webServer: webServers.map((s) => ({
    command: s.command,
    url: s.url,
    reuseExistingServer: true,
    // MFEs pull in component libraries (Mantine, Naive UI, Kobalte,
    // bits-ui) so first-boot Vite dep optimization can take a while.
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  })),
})
