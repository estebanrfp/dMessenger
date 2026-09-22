import { test, expect } from '@playwright/test'
import { room, openPeer, startChat, say } from './helpers.js'

/**
 * The negative, with a sentinel.
 *
 * The room replicates every node to every peer, so the outsider holds the same
 * bytes as the members. What it does not hold is an envelope. A refusal that
 * cannot be told from a disconnection would prove nothing, so the outsider
 * first proves it is connected and replicating — that is the sentinel — and
 * only then is its inability to read asserted.
 */
test('an outsider replicates the ciphertext and cannot read it', async ({ browser }) => {
  const name = room()
  const alice = await openPeer(browser, name)
  const bob = await openPeer(browser, name)
  const mallory = await openPeer(browser, name)

  await startChat(alice, bob.address)
  await expect(bob.page.getByTestId('chat-row').first()).toBeVisible()
  await say(alice, 'a secret worth keeping')
  await bob.page.getByTestId('chat-row').first().click()
  await expect(bob.page.getByTestId('message').first()).toContainText('a secret worth keeping')

  // Sentinel: Mallory is replicating this graph — she holds the message node.
  await expect.poll(
    () => mallory.page.evaluate(() => window.app.nodes({ t: 'msg' }).then(n => n.length)),
    { message: 'the outsider never replicated the node, so reading proves nothing' },
  ).toBeGreaterThan(0)

  // She has the bytes. They are ciphertext, and no plaintext is anywhere in them.
  const bodies = await mallory.page.evaluate(() => window.app.nodes({ t: 'msg' }).then(n => n.map(x => x.value.body)))
  expect(bodies.length).toBeGreaterThan(0)
  for (const body of bodies) expect(body).not.toContain('a secret worth keeping')

  // And the conversation key refuses to open for her.
  const [conversation] = await mallory.page.evaluate(() => window.app.nodes({ t: 'conv' }))
  const opened = await mallory.page.evaluate((keyId) => window.app.canOpen(keyId), conversation.value.keyId)
  expect(opened, 'the outsider opened the conversation key').toBe(false)

  await alice.context.close()
  await bob.context.close()
  await mallory.context.close()
})
