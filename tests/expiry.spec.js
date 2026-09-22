import { test, expect, chromium } from '@playwright/test'
import { room, openPeer, startChat, say, RELAY } from './helpers.js'

/**
 * Disappearing messages, and the one property that makes them hard here:
 * a tombstone lives only in the operation window, so removal cannot be what
 * makes a message disappear. Expiry is enforced by every honest receiver on
 * its own copy — render, ingress and sweep — and these specs pin each.
 */

test('the policy is shared: either side of a 1:1 may change it, and both see it', async ({ browser }) => {
  const name = room()
  const alice = await openPeer(browser, name)
  const bob = await openPeer(browser, name)
  await startChat(alice, bob.address)
  await expect(bob.page.getByTestId('chat-row').first()).toBeVisible()

  // Alice (owner) picks 1 hour from the menu.
  await alice.page.getByTestId('chat-row').first().click()
  await alice.page.getByTestId('chat-menu').click()
  await alice.page.getByTestId('menu-disappearing').click()
  await alice.page.getByTestId('ttl-option').filter({ hasText: '1 hour' }).click()
  await expect(alice.page.getByTestId('ttl-notice')).toHaveText('Messages now live for 1 hour')
  await expect(alice.page.getByTestId('ttl-badge')).toHaveText('1 hour')

  // Bob sees the policy land on the space node, then turns it off himself:
  // not the owner, but a `write` collaborator, so every peer accepts it.
  await bob.page.getByTestId('chat-row').first().click()
  await expect(bob.page.getByTestId('ttl-badge')).toHaveText('1 hour')
  await bob.page.getByTestId('chat-menu').click()
  await bob.page.getByTestId('menu-disappearing').click()
  await expect(bob.page.getByTestId('ttl-option').first()).toBeEnabled()
  await bob.page.getByTestId('ttl-option').filter({ hasText: 'Off' }).click()
  await expect(alice.page.getByTestId('ttl-notice')).toHaveText('Messages now live forever')

  await alice.context.close()
  await bob.context.close()
})

test('an expiring message leaves every honest peer, and its author removes it from the graph', async ({ browser }) => {
  const name = room()
  const alice = await openPeer(browser, name)
  const bob = await openPeer(browser, name)
  await startChat(alice, bob.address)
  await expect(bob.page.getByTestId('chat-row').first()).toBeVisible()

  const convId = await alice.page.evaluate(() => window.app.nodes({ t: 'conv' }).then(n => n[0].id))
  await alice.page.evaluate((id) => window.app.setTtl(id, 6), convId)   // shorter than the picker offers
  await alice.page.getByTestId('chat-row').first().click()
  await expect(alice.page.getByTestId('ttl-badge')).toHaveText('6s')

  await say(alice, 'read me while you can')
  await expect(alice.page.getByTestId('countdown')).toBeVisible()
  await bob.page.getByTestId('chat-row').first().click()
  await expect(bob.page.getByTestId('message').first()).toContainText('read me while you can')
  await expect(bob.page.getByTestId('countdown')).toBeVisible()

  // Point 1 and 3: it leaves both screens, and the owner removes the node.
  await expect(alice.page.getByTestId('message')).toHaveCount(0)
  await expect(bob.page.getByTestId('message')).toHaveCount(0)
  await expect.poll(() => alice.page.evaluate(() => window.app.nodes({ t: 'msg' }).then(n => n.length))).toBe(0)
  await expect.poll(() => bob.page.evaluate(() => window.app.nodes({ t: 'msg' }).then(n => n.length))).toBe(0)

  // Sentinel: the conversation is alive after the removal, both ways.
  await say(alice, 'still here')
  await expect(bob.page.getByTestId('message').first()).toContainText('still here')

  await alice.context.close()
  await bob.context.close()
})

test('a laggard cannot resurrect an expired message once its tombstone has rolled out', async ({ browser }, testInfo) => {
  const name = room()
  const url = `http://localhost:5605/?room=${name}&relay=${RELAY}&oplog=3`

  const alice = await openPeer(browser, name)

  // Carol is a *returning device*: a persistent context keeps her OPFS and
  // clock across a close and a relaunch. A fresh context would be a new peer.
  const profile = testInfo.outputPath('carol-profile')
  let carolBrowser = await chromium.launchPersistentContext(profile)
  let carol = carolBrowser.pages()[0] ?? await carolBrowser.newPage()
  await carol.goto(url)
  await carol.getByTestId('join').click()
  const carolMnemonic = await carol.locator('dialog p.mono').textContent()
  await carol.getByRole('button', { name: 'I saved it' }).click()
  await expect(carol.getByTestId('chat-list')).toBeVisible()
  const carolAddress = await carol.evaluate(() => window.app.address())

  // A 1:1 with a 6 s policy. Alice's window holds only 3 operations.
  await startChat(alice, carolAddress)
  await expect(carol.getByTestId('chat-row').first()).toBeVisible()
  const convId = await alice.page.evaluate(() => window.app.nodes({ t: 'conv' }).then(n => n[0].id))
  await alice.page.evaluate((id) => window.app.setTtl(id, 6), convId)

  await say(alice, 'gone in six seconds')
  await carol.getByTestId('chat-row').first().click()
  await expect(carol.getByTestId('message').first()).toContainText('gone in six seconds', { timeout: 90_000 })

  // Carol leaves *holding the message*. From here she is a laggard.
  await carolBrowser.close()

  // It expires; Alice removes it; the tombstone sits in her 3-op window.
  await expect.poll(() => alice.page.evaluate(() => window.app.nodes({ t: 'msg' }).then(n => n.length))).toBe(0)

  // Policy off from here: the only node that could ever carry an expiry now
  // is the one Carol brings back, which makes the final count unambiguous.
  await alice.page.evaluate((id) => window.app.setTtl(id, null), convId)
  await expect(alice.page.getByTestId('ttl-notice')).toHaveText('Messages now live forever')

  // Ordinary traffic pushes the tombstone out of the window.
  for (const text of ['one', 'two', 'three', 'four']) {
    await alice.page.getByTestId('composer').fill(text)
    await alice.page.getByTestId('send').click()
  }
  await expect(alice.page.getByTestId('message')).toHaveCount(4)

  // Carol returns with her old copy, which still holds the expired node.
  carolBrowser = await chromium.launchPersistentContext(profile)
  carol = carolBrowser.pages()[0] ?? await carolBrowser.newPage()
  await carol.goto(url)
  await carol.getByRole('button', { name: 'Recover with a phrase' }).click()
  await carol.getByTestId('mnemonic').fill(carolMnemonic)
  await carol.getByTestId('recover-confirm').click()
  await expect(carol.getByTestId('chat-list')).toBeVisible()

  // Sentinel: she is connected and replicating — her new message must land.
  await carol.getByTestId('chat-row').first().click()
  await expect(carol.getByTestId('composer')).toBeEnabled({ timeout: 90_000 })
  await carol.getByTestId('composer').fill('back from the past')
  await carol.getByTestId('send').click()
  await expect(alice.page.getByTestId('message').filter({ hasText: 'back from the past' })).toHaveCount(1, { timeout: 90_000 })

  // The verdict: nothing expired came back to the honest peer — not in the
  // graph (ingress), not on screen (render) — and Carol forgot it (sweep).
  const expired = (page) => page.evaluate(() => window.app.nodes({ t: 'msg' }).then(n => n.filter(m => typeof m.value.expiresAt === 'number').length))
  expect(await expired(alice.page)).toBe(0)
  await expect(alice.page.getByTestId('message').filter({ hasText: 'gone in six seconds' })).toHaveCount(0)
  await expect(alice.page.getByTestId('message')).toHaveCount(5)
  await expect(carol.getByTestId('message').filter({ hasText: 'gone in six seconds' })).toHaveCount(0)
  await expect.poll(() => expired(carol)).toBe(0)

  await carolBrowser.close()
  await alice.context.close()
})
