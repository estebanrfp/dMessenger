import { defineConfig } from '@playwright/test'

/**
 * The performance suite: same servers as the correctness suite, longer
 * budgets, no retries — a retried measurement is a measurement thrown away.
 */
export default defineConfig({
  testDir: './perf',
  workers: 1,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 120_000 },
  reporter: 'list',
  use: { baseURL: 'http://localhost:5605' },
  webServer: [
    { command: 'pnpm dev', port: 5605, reuseExistingServer: true, timeout: 60_000 },
    {
      command: 'GDB_RELAY=1 PORT=5606 bun node_modules/genosdb/dist/genossrv.min.js dmessenger-tests --room',
      port: 5606,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
