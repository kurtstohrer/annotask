/**
 * Focused Playwright config for the agent-loop e2e suite. Only spins up
 * the host shell plus the two target MFEs (react-workflows,
 * vue-data-lab) — the rest of the stress cluster is overkill for these
 * specs and would triple the CI runtime.
 *
 * If you need to run against the full stress cluster instead, use
 * `pnpm test:e2e:stress:annotask` which loads the broader config.
 */
import { defineConfig, devices } from '@playwright/test'

const webServers = [
  { name: 'stress-host', command: 'pnpm dev:stress-host', url: 'http://localhost:4200' },
  { name: 'stress-react-workflows', command: 'pnpm dev:stress-react-workflows', url: 'http://localhost:4210' },
  { name: 'stress-vue-data-lab', command: 'pnpm dev:stress-vue-data-lab', url: 'http://localhost:4220' },
]

export default defineConfig({
  testDir: './annotask/agent-loop',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['./annotask/reporter.ts']],
  use: {
    trace: 'on-first-retry',
    baseURL: 'http://localhost:4200',
    ...devices['Desktop Chrome'],
  },
  webServer: webServers.map(s => ({
    command: s.command,
    url: s.url,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  })),
})
