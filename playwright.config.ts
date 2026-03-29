import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'vue-vite',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173' },
      testMatch: ['**/vue-vite*.test.ts', '**/new-page.test.ts'],
    },
    {
      name: 'react-vite',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5174' },
      testMatch: '**/react-vite*.test.ts',
    },
    {
      name: 'svelte-vite',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5175' },
      testMatch: '**/svelte-vite*.test.ts',
    },
    {
      name: 'vue-webpack',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:8090' },
      testMatch: '**/vue-webpack*.test.ts',
    },
  ],
  webServer: [
    {
      command: 'pnpm dev:vue-vite',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev:react-vite',
      url: 'http://localhost:5174',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev:svelte-vite',
      url: 'http://localhost:5175',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev:vue-webpack',
      url: 'http://localhost:8090',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
