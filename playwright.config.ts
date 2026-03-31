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
      testMatch: '**/vue-vite*.test.ts',
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
      name: 'html-vite',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5176' },
      testMatch: '**/html-vite*.test.ts',
    },
    {
      name: 'astro',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5177' },
      testMatch: '**/astro*.test.ts',
    },
    {
      name: 'htmx-vite',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5178' },
      testMatch: '**/htmx-vite*.test.ts',
    },
    {
      name: 'vue-webpack',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:8090' },
      testMatch: '**/vue-webpack*.test.ts',
    },
    {
      name: 'mfe-vite',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5180' },
      testMatch: '**/mfe-vite*.test.ts',
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
      command: 'pnpm dev:html-vite',
      url: 'http://localhost:5176',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev:astro',
      url: 'http://localhost:5177',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev:htmx-vite',
      url: 'http://localhost:5178',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev:vue-webpack',
      url: 'http://localhost:8090',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev:mfe-vite',
      url: 'http://localhost:5180',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
