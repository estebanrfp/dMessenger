import { test, expect } from '@playwright/test'
import { room, RELAY } from './helpers.js'

/**
 * What only the production build can prove: the manifest is real, the service
 * worker installs, and the app opens with no network at all — including the
 * engine, which comes from a CDN and must therefore be in the cache.
 */
const BUILD = 'http://localhost:5608'

test('the app is installable and opens offline, engine included', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${BUILD}/?room=${room()}&relay=${RELAY}`)
  await expect(page.getByTestId('join')).toBeVisible()

  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]')
    return link ? fetch(link.href).then(r => r.json()) : null
  })
  expect(manifest?.name).toBe('dMessenger')
  expect(manifest.icons.some(i => i.purpose === 'maskable')).toBe(true)

  // The worker is active and the engine — every file of it — is precached.
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => !!r?.active)), { timeout: 60_000 }).toBe(true)
  const ENGINE = 'https://cdn.jsdelivr.net/npm/genosdb@0.36.3/dist/'
  for (const file of ['index.min.js', 'sm.min.js', 'genosrtc.min.js']) {
    await expect.poll(() => page.evaluate((url) => caches.match(url, { ignoreSearch: true }).then(r => !!r), ENGINE + file), { timeout: 60_000 }).toBe(true)
  }

  // No network: the shell and the engine come from the cache.
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('join')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('h1')).toContainText('Messenger')

  await context.setOffline(false)
  await context.close()
})
