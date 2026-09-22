import { test, expect, chromium } from '@playwright/test'
import { room, openPeer, startChat, RELAY } from './helpers.js'

/** A tiny valid PNG (1×1, red) — enough to be rendered on the other side. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')

test('an image travels sealed and renders on the other peer; the cap is enforced', async ({ browser }) => {
  const name = room()
  const alice = await openPeer(browser, name)
  const bob = await openPeer(browser, name)
  await startChat(alice, bob.address)
  await expect(bob.page.getByTestId('chat-row').first()).toBeVisible()
  await alice.page.getByTestId('chat-row').first().click()
  await expect(alice.page.getByTestId('composer')).toBeEnabled()

  // Over the cap: refused before anything is sealed — the graph is the store.
  await alice.page.getByTestId('file-input').setInputFiles({ name: 'huge.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(600 * 1024) })
  await expect(alice.page.locator('.toast').last()).toContainText('capped at 512 KB')
  await expect(alice.page.getByTestId('attach-bar')).toBeHidden()

  // Under it: previewed, sent, and rendered as an image by Bob.
  await alice.page.getByTestId('file-input').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG })
  await expect(alice.page.getByTestId('attach-bar')).toBeVisible()
  await alice.page.getByTestId('send').click()
  await expect(alice.page.getByTestId('file-image')).toHaveCount(1)

  await bob.page.getByTestId('chat-row').first().click()
  const image = bob.page.getByTestId('file-image')
  await expect(image).toHaveCount(1)
  await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth)).toBe(1)
  await expect(bob.page.getByTestId('row-title').first()).toBeVisible()

  // What is public is the metadata, never the pixels.
  const node = await bob.page.evaluate(() => window.app.nodes({ t: 'msg' }).then(n => n[0].value))
  expect(node.kind).toBe('file')
  expect(node.name).toBe('dot.png')
  expect(node.body).not.toContain(PNG.toString('base64'))

  await alice.context.close()
  await bob.context.close()
})

test('a voice note is recorded, sealed and playable on the other side', async ({ browser }) => {
  const name = room()
  const bob = await openPeer(browser, name)

  // Chromium's fake media device gives the recorder a real audio track.
  const fake = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const context = await fake.newContext()
  const page = await context.newPage()
  await page.goto(`/?room=${name}&relay=${RELAY}`.replace(/^\//, 'http://localhost:5605/'))
  await page.getByTestId('join').click()
  await page.getByRole('button', { name: 'I saved it' }).click()
  await expect(page.getByTestId('chat-list')).toBeVisible()
  const alice = { page, context, address: await page.evaluate(() => window.app.address()) }

  await startChat(alice, bob.address)
  await alice.page.getByTestId('chat-row').first().click()
  await expect(alice.page.getByTestId('composer')).toBeEnabled()

  await alice.page.getByTestId('record').click()
  await expect(alice.page.getByTestId('recorder')).toBeVisible()
  await expect(alice.page.getByTestId('record-time')).not.toHaveText('0:00')      // it is actually recording
  await alice.page.getByTestId('record-send').click()
  await expect(alice.page.getByTestId('recorder')).toBeHidden()
  await expect(alice.page.getByTestId('file-audio')).toHaveCount(1)

  await expect(bob.page.getByTestId('chat-row').first()).toBeVisible()
  await bob.page.getByTestId('chat-row').first().click()
  await expect(bob.page.getByTestId('file-audio')).toHaveCount(1)
  await expect.poll(() => bob.page.getByTestId('file-audio').evaluate(a => a.readyState)).toBeGreaterThan(0)

  await context.close()
  await fake.close()
  await bob.context.close()
})
