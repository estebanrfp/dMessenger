import { test, expect } from '@playwright/test'
import { room, openPeer, startChat, say, transportProof } from './helpers.js'

test('a message reaches the other peer, decrypted, over WebRTC', async ({ browser }) => {
  const name = room()
  const alice = await openPeer(browser, name, { transport: true })
  const bob = await openPeer(browser, name, { transport: true })

  await startChat(alice, bob.address)

  // Bob discovers the conversation without anyone writing to a node he owns:
  // `members: { $in: [me] }` matches on overlap, so the query is the routing.
  await expect(bob.page.getByTestId('chat-row').first()).toBeVisible()

  await say(alice, 'the graph is the transport')

  await bob.page.getByTestId('chat-row').first().click()
  await expect(bob.page.getByTestId('message').first()).toContainText('the graph is the transport')

  // Only now are the stats populated: the app-level assertion comes first.
  const proof = await transportProof(bob.page)
  expect(proof, 'no succeeded ICE candidate pair: nothing crossed WebRTC').not.toBeNull()
  expect(proof.bytesReceived).toBeGreaterThan(0)

  await alice.context.close()
  await bob.context.close()
})

test('both directions converge and the thread agrees on both peers', async ({ browser }) => {
  const name = room()
  const alice = await openPeer(browser, name)
  const bob = await openPeer(browser, name)

  await startChat(alice, bob.address)
  await expect(bob.page.getByTestId('chat-row').first()).toBeVisible()

  await say(alice, 'first')
  await bob.page.getByTestId('chat-row').first().click()
  await expect(bob.page.getByTestId('message').first()).toContainText('first')

  await bob.page.getByTestId('composer').fill('second')
  await bob.page.getByTestId('send').click()

  await expect(alice.page.getByTestId('message')).toHaveCount(2)
  await expect(bob.page.getByTestId('message')).toHaveCount(2)
  await expect(alice.page.getByTestId('message').nth(1)).toContainText('second')

  await alice.context.close()
  await bob.context.close()
})
