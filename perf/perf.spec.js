import { test, expect, chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { room, openPeer, startChat, RELAY, transportProof } from '../tests/helpers.js'
import { stats, writeReport } from './report.js'

/**
 * Numbers with thresholds. Each test records what it measured; the last one
 * writes the report. The thresholds are generous on purpose — they catch a
 * regression of an order of magnitude, not a slow afternoon.
 */
const results = {}
const record = (key, value) => { results[key] = value; console.log(`    ${key} → ${JSON.stringify(value)}`) }

const portOpen = (port) => new Promise((resolve) => {
  const socket = net.connect({ port, host: '127.0.0.1' })
  socket.once('connect', () => { socket.destroy(); resolve(true) })
  socket.once('error', () => resolve(false))
})

const convOf = (peer) => peer.page.evaluate(() => window.app.nodes({ t: 'conv' }).then(n => n[0].id))
const holdsKey = async (peer) => {
  await peer.page.getByTestId('chat-row').first().click()
  await expect(peer.page.getByTestId('composer')).toBeEnabled()
}
const arrivals = (peer) => peer.page.evaluate(() => window.app.perf.arrivals())
const latencies = (list) => list.map(a => a.at - a.ts)

test.afterAll(() => { console.log('\n' + writeReport(results)) })

test('boot: cold, warm, identity, mount', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const name = room()

  let t = Date.now()
  await page.goto(`/?room=${name}&relay=${RELAY}`)
  await expect(page.getByTestId('join')).toBeVisible()
  const coldMs = Date.now() - t

  t = Date.now()
  await page.reload()
  await expect(page.getByTestId('join')).toBeVisible()
  const warmMs = Date.now() - t

  t = Date.now()
  await page.getByTestId('join').click()
  await expect(page.locator('dialog p.mono')).toBeVisible()
  const identityMs = Date.now() - t

  t = Date.now()
  await page.getByRole('button', { name: 'I saved it' }).click()
  await expect(page.getByTestId('chat-list')).toBeVisible()
  const mountMs = Date.now() - t

  record('boot', { coldMs, warmMs, identityMs, mountMs })
  expect(warmMs).toBeLessThan(10_000)
  await context.close()
})

test('delivery: discovery, key exchange, latency, burst, no HTTP, bytes on the wire', async ({ browser }) => {
  const name = room()
  const alice = await openPeer(browser, name, { transport: true })
  const bob = await openPeer(browser, name, { transport: true })

  // Discovery is counted from the moment Bob's app is on screen.
  let t = Date.now()
  await expect.poll(() => bob.page.evaluate(() => window.app.peerCount()), { timeout: 90_000, intervals: [50] }).toBeGreaterThanOrEqual(1)
  record('discoveryMs', Date.now() - t)

  // Key exchange: conversation created on Alice, envelope granted, Bob can write.
  t = Date.now()
  await startChat(alice, bob.address)
  await expect(bob.page.getByTestId('chat-row').first()).toBeVisible()
  await holdsKey(bob)
  record('keyExchangeMs', Date.now() - t)
  await holdsKey(alice)

  const convId = await convOf(alice)
  await bob.page.evaluate((id) => window.app.perf.watchArrivals(id), convId)

  // From here, every HTTP request by either peer is counted. There should be none.
  const requests = []
  for (const peer of [alice, bob]) peer.page.on('request', (r) => requests.push(r.url()))

  const puts = await alice.page.evaluate(([id, n]) => window.app.perf.sendMany(id, n, 'seq'), [convId, 50])
  await expect.poll(() => arrivals(bob).then(a => a.length), { timeout: 120_000, intervals: [50] }).toBeGreaterThanOrEqual(50)
  const sequential = stats(latencies(await arrivals(bob)))
  record('latencySequential', sequential)
  record('putMs', stats(puts.map(p => p.putMs)))
  expect(sequential.p95).toBeLessThan(2_000)

  await bob.page.evaluate(() => window.app.perf.reset())
  t = Date.now()
  await alice.page.evaluate(([id, n]) => window.app.perf.sendBurst(id, n, 'burst'), [convId, 100])
  await expect.poll(() => arrivals(bob).then(a => a.length), { timeout: 180_000, intervals: [50] }).toBeGreaterThanOrEqual(100)
  const totalMs = Date.now() - t
  record('burst100', { totalMs, perMessageMs: Math.round(totalMs / 100), latency: stats(latencies(await arrivals(bob))) })

  // The UI kept up: all 150 painted on the receiver.
  await expect(bob.page.getByTestId('message')).toHaveCount(150, { timeout: 60_000 })

  record('httpRequestsDuringMessaging', requests.length)
  if (requests.length) console.log('    unexpected requests:', requests.slice(0, 5))
  expect(requests.length).toBe(0)

  const proof = await transportProof(bob.page)
  record('transport', proof)
  expect(proof?.bytesReceived ?? 0).toBeGreaterThan(0)

  await alice.context.close()
  await bob.context.close()
})

test('no intermediary: the relay is killed and messages keep arriving', async ({ browser }) => {
  const port = 5609
  const relay = spawn('bun', ['node_modules/genosdb/dist/genossrv.min.js', `perf-relay-${Date.now().toString(36)}`, '--relay'], {
    env: { ...process.env, GDB_RELAY: '1', PORT: String(port) },
    stdio: 'ignore',
  })
  await expect.poll(() => portOpen(port), { timeout: 30_000 }).toBe(true)

  const name = room()
  const url = `http://localhost:5605/?room=${name}&relay=ws://127.0.0.1:${port}`
  const open = async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(url)
    await page.getByTestId('join').click()
    await page.getByRole('button', { name: 'I saved it' }).click()
    await expect(page.getByTestId('chat-list')).toBeVisible()
    return { context, page, address: await page.evaluate(() => window.app.address()) }
  }
  const alice = await open()
  const bob = await open()
  for (const peer of [alice, bob]) {
    await expect.poll(() => peer.page.evaluate(() => window.app.peerCount()), { timeout: 90_000 }).toBeGreaterThanOrEqual(1)
  }
  await startChat(alice, bob.address)
  await expect(bob.page.getByTestId('chat-row').first()).toBeVisible()
  await holdsKey(bob)
  await holdsKey(alice)
  const convId = await convOf(alice)
  await bob.page.evaluate((id) => window.app.perf.watchArrivals(id), convId)

  // The introduction is over. Kill the only server in sight.
  relay.kill('SIGKILL')
  await expect.poll(() => portOpen(port), { timeout: 15_000 }).toBe(false)

  const attempted = 20
  await alice.page.evaluate(([id, n]) => window.app.perf.sendMany(id, n, 'no-relay'), [convId, attempted])
  await expect.poll(() => arrivals(bob).then(a => a.length), { timeout: 60_000, intervals: [50] }).toBe(attempted)
  const delivered = (await arrivals(bob)).length
  record('relayKilled', { attempted, delivered, latency: stats(latencies(await arrivals(bob))) })
  expect(delivered).toBe(attempted)

  await alice.context.close()
  await bob.context.close()
})

test('catch-up: a returning device converges on what it missed', async ({ browser }, testInfo) => {
  const name = room()
  const alice = await openPeer(browser, name)

  const profile = testInfo.outputPath('bob-profile')
  let bobBrowser = await chromium.launchPersistentContext(profile)
  let bob = bobBrowser.pages()[0] ?? await bobBrowser.newPage()
  await bob.goto(`/?room=${name}&relay=${RELAY}`.replace(/^\//, 'http://localhost:5605/'))
  await bob.getByTestId('join').click()
  const mnemonic = await bob.locator('dialog p.mono').textContent()
  await bob.getByRole('button', { name: 'I saved it' }).click()
  await expect(bob.getByTestId('chat-list')).toBeVisible()
  const bobAddress = await bob.evaluate(() => window.app.address())

  await startChat(alice, bobAddress)
  await expect(bob.getByTestId('chat-row').first()).toBeVisible()
  await bob.getByTestId('chat-row').first().click()
  await expect(bob.getByTestId('composer')).toBeEnabled()
  await bobBrowser.close()

  const convId = await convOf(alice)
  const missed = 30
  await alice.page.evaluate(([id, n]) => window.app.perf.sendMany(id, n, 'missed'), [convId, missed])

  const launch = Date.now()
  bobBrowser = await chromium.launchPersistentContext(profile)
  bob = bobBrowser.pages()[0] ?? await bobBrowser.newPage()
  await bob.goto(`http://localhost:5605/?room=${name}&relay=${RELAY}`)
  await bob.getByRole('button', { name: 'Recover with a phrase' }).click()
  await bob.getByTestId('mnemonic').fill(mnemonic)
  await bob.getByTestId('recover-confirm').click()
  await expect(bob.getByTestId('chat-list')).toBeVisible()
  const signedIn = Date.now()

  await expect.poll(() => bob.evaluate((id) => window.app.nodes({ t: 'msg', conv: id }).then(n => n.length), convId), { timeout: 120_000, intervals: [100] }).toBe(missed)
  const done = Date.now()
  record('catchUp', { missed, fromLoginMs: done - signedIn, fromLaunchMs: done - launch })

  await bob.getByTestId('chat-row').first().click()
  await expect(bob.getByTestId('message')).toHaveCount(missed, { timeout: 60_000 })
  await expect(bob.getByTestId('message').last()).toContainText('missed 29')

  await bobBrowser.close()
  await alice.context.close()
})

test('crypto: the cost of sealing and opening a message', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`/?room=${room()}&relay=${RELAY}`)
  await expect(page.getByTestId('join')).toBeVisible()
  const crypto = await page.evaluate(() => window.app.perf.crypto(200, 1024))
  record('crypto', crypto)
  expect(crypto.sealUs).toBeLessThan(5_000)
  await context.close()
})
