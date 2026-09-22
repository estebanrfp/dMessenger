import { test, expect } from '@playwright/test'
import { room, openPeer, startChat, say } from './helpers.js'

const openBoth = async (browser) => {
  const name = room()
  const alice = await openPeer(browser, name)
  const bob = await openPeer(browser, name)
  await startChat(alice, bob.address)
  await expect(bob.page.getByTestId('chat-row').first()).toBeVisible()
  await say(alice, 'the original')
  await bob.page.getByTestId('chat-row').first().click()
  await expect(bob.page.getByTestId('message').first()).toContainText('the original')
  return { alice, bob }
}

test('a reply quotes the original on both sides', async ({ browser }) => {
  const { alice, bob } = await openBoth(browser)

  const original = bob.page.getByTestId('message').first()
  await original.hover()
  await original.getByTestId('reply-action').click()
  await expect(bob.page.getByTestId('reply-bar')).toContainText('the original')
  await bob.page.getByTestId('composer').fill('and the answer')
  await bob.page.getByTestId('send').click()
  await expect(bob.page.getByTestId('reply-bar')).toBeHidden()

  // The quote is rendered from what each peer decrypted, on each peer.
  for (const peer of [alice, bob]) {
    const reply = peer.page.getByTestId('message').filter({ hasText: 'and the answer' })
    await expect(reply.getByTestId('reply-quote')).toContainText('the original')
  }
  await expect(alice.page.getByTestId('message').filter({ hasText: 'and the answer' }).getByTestId('reply-quote')).toContainText('You')

  await alice.context.close()
  await bob.context.close()
})

test('reactions are counted per reactor, replaced on change and removed only by their owner', async ({ browser }) => {
  const { alice, bob } = await openBoth(browser)
  const onAlice = alice.page.getByTestId('message').first()
  const onBob = bob.page.getByTestId('message').first()

  // Bob reacts 👍: one pill, count 1, his on his side, not his on Alice's.
  await onBob.hover()
  await onBob.getByTestId('react-action').click()
  await bob.page.getByTestId('quick-emoji').filter({ hasText: '👍' }).click()
  await expect(onBob.getByTestId('reaction-pill')).toHaveCount(1)
  await expect(onBob.getByTestId('reaction-pill')).toHaveText('👍1')
  await expect(onBob.getByTestId('reaction-pill')).toHaveAttribute('data-mine', 'true')
  await expect(onAlice.getByTestId('reaction-pill')).toHaveText('👍1')
  await expect(onAlice.getByTestId('reaction-pill')).toHaveAttribute('data-mine', 'false')

  // Alice joins with the same emoji by clicking the pill: count 2 everywhere.
  await onAlice.getByTestId('reaction-pill').click()
  await expect(onAlice.getByTestId('reaction-pill')).toHaveText('👍2')
  await expect(onBob.getByTestId('reaction-pill')).toHaveText('👍2')

  // Bob switches to ❤️: same id, replaced — never two reactions from one reactor.
  await onBob.hover()
  await onBob.getByTestId('react-action').click()
  await bob.page.getByTestId('quick-emoji').filter({ hasText: '❤️' }).click()
  await expect(onAlice.getByTestId('reaction-pill')).toHaveCount(2)
  await expect(onAlice.getByTestId('reaction-pill').filter({ hasText: '👍' })).toHaveText('👍1')
  await expect(onAlice.getByTestId('reaction-pill').filter({ hasText: '❤️' })).toHaveText('❤️1')

  // Bob removes his own: a remove only its owner can sign.
  await onBob.getByTestId('reaction-pill').filter({ hasText: '❤️' }).click()
  await expect(onAlice.getByTestId('reaction-pill')).toHaveCount(1)
  await expect(onAlice.getByTestId('reaction-pill')).toHaveText('👍1')

  await alice.context.close()
  await bob.context.close()
})

test('nobody can react in somebody else\'s name', async ({ browser }) => {
  const { alice, bob } = await openBoth(browser)
  const messageId = await alice.page.evaluate(() => window.app.nodes({ t: 'msg' }).then(n => n[0].id))
  const convId = await alice.page.evaluate(() => window.app.nodes({ t: 'conv' }).then(n => n[0].id))

  // Bob forges a reaction *as Alice*: an owned id with her prefix, her address
  // as owner. It lands in his own copy and nowhere else.
  const forged = await bob.page.evaluate(([owner, msg, conv]) => window.app.rawPut(
    { t: 'react', owner, conv, msg, epoch: 0, emoji: 'forged', ts: Date.now() },
    `${owner}:react:${msg}`,
  ), [alice.address, messageId, convId])

  // Sentinel: a reaction Bob *does* own, sent by the same path afterwards,
  // must arrive — so a missing forgery is a refusal, not a disconnection.
  const onBob = bob.page.getByTestId('message').first()
  await onBob.hover()
  await onBob.getByTestId('react-action').click()
  await bob.page.getByTestId('quick-emoji').filter({ hasText: '🔥' }).click()
  await expect(alice.page.getByTestId('message').first().getByTestId('reaction-pill')).toHaveText('🔥1')

  // Alice's copy holds Bob's honest reaction and not the one in her name.
  const owners = await alice.page.evaluate(() => window.app.nodes({ t: 'react' }).then(n => n.map(x => x.value.owner.toLowerCase())))
  expect(owners).toEqual([bob.address.toLowerCase()])
  test.info().annotations.push({ type: 'forgery', description: forged.ok ? 'accepted locally on the forger, refused by every other peer' : `refused locally: ${forged.error}` })

  await alice.context.close()
  await bob.context.close()
})
