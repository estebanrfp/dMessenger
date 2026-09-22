import { defineConfig } from '@playwright/test'

/**
 * Discovery is local: the Fallback Server runs with an embedded Nostr relay and
 * every peer points at it, so no public relay decides whether two peers meet
 * and nothing leaves the machine.
 */
export default defineConfig({
  testDir: './tests',
  workers: 1,                        // peers share a signaling network
  timeout: 300_000,
  expect: { timeout: 60_000 },       // convergence: relay discovery, then envelopes
  use: { trace: 'on-first-retry', baseURL: 'http://localhost:5605' },
  webServer: [
    { command: 'pnpm dev', port: 5605, reuseExistingServer: true, timeout: 60_000 },
    // The production build, for what only a real service worker can prove.
    { command: 'pnpm build && pnpm preview', port: 5608, reuseExistingServer: true, timeout: 180_000 },
    {
      command: 'GDB_RELAY=1 PORT=5606 bun node_modules/genosdb/dist/genossrv.min.js dmessenger-tests --room',
      port: 5606,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
