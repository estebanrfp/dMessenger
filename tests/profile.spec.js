import { test, expect } from '@playwright/test'
import { room, openPeer, startChat, RELAY } from './helpers.js'

test('a name is a claim only its owner can make', async ({ browser }) => {
  const name = room()
  const alice = await openPeer(browser, name)
  const bob = await openPeer(browser, name)
  const carol = await openPeer(browser, name)      // the honest witness
  await startChat(alice, bob.address)
  await startChat(carol, alice.address)
  await expect(bob.page.getByTestId('chat-row').first()).toBeVisible()
  await expect(alice.page.getByTestId('chat-row')).toHaveCount(2)

  // Alice publishes her name from her own profile.
  await alice.page.getByTestId('open-profile').click()
  await alice.page.getByTestId('name-input').fill('Alice')
  await alice.page.getByTestId('name-save').click()
  await expect(alice.page.getByTestId('profile-name')).toHaveText('Alice')

  // It resolves everywhere it is shown: rows, and the thread header.
  await expect(bob.page.getByTestId('row-title').first()).toHaveText('Alice')
  await expect(carol.page.getByTestId('row-title').first()).toHaveText('Alice')
  await bob.page.getByTestId('chat-row').first().click()
  await expect(bob.page.getByTestId('space-title')).toHaveText('Alice')

  // Bob forges a rename of Alice's identity node. It is his copy's problem
  // alone: every other peer refuses a write to a node it does not own.
  await bob.page.evaluate((address) => window.app.rawPut({ displayName: 'Mallory', role: 'guest' }, `user:${address}`), alice.address)

  // Sentinel: Bob's *own* name, by the same path, must reach the witness.
  await bob.page.getByTestId('open-profile').click()
  await bob.page.getByTestId('name-input').fill('Bob')
  await bob.page.getByTestId('name-save').click()
  await expect(alice.page.getByTestId('row-title').filter({ hasText: 'Bob' })).toHaveCount(1)

  // The witness still knows Alice as Alice.
  await expect(carol.page.getByTestId('row-title').first()).toHaveText('Alice')
  const seenByCarol = await carol.page.evaluate((address) => window.app.nodes({ id: `user:${address}` }).then(n => n[0]?.value?.displayName), alice.address)
  expect(seenByCarol).toBe('Alice')

  for (const peer of [alice, bob, carol]) await peer.context.close()
})

test('an invite link opens the conversation with its author', async ({ browser }) => {
  const name = room()
  const alice = await openPeer(browser, name)

  await alice.page.getByTestId('new-chat').click()
  await alice.page.getByTestId('open-invite').click()
  await expect(alice.page.getByTestId('invite-qr')).toBeVisible()
  const link = (await alice.page.getByTestId('invite-link').textContent()).trim()
  expect(link).toContain(`invite=${alice.address}`)
  expect(link).toContain(`room=${name}`)
  await alice.page.keyboard.press('Escape')

  // Bob opens the link on a fresh device and joins: the chat is simply there.
  const context = await browser.newContext()
  const bob = await context.newPage()
  await bob.goto(link)
  await bob.getByTestId('join').click()
  await bob.getByRole('button', { name: 'I saved it' }).click()
  await expect(bob.getByTestId('chat-row')).toHaveCount(1)
  await expect(bob.getByTestId('space-title')).toHaveText(alice.address.slice(0, 6) + '…' + alice.address.slice(-4))
  await expect(alice.page.getByTestId('chat-row')).toHaveCount(1)

  // The URL no longer carries the invite once it has been used.
  expect(bob.url()).not.toContain('invite=')

  await alice.context.close()
  await context.close()
})

test('the theme is a device preference that survives the session', async ({ browser }) => {
  const name = room()
  const alice = await openPeer(browser, name)
  await alice.page.getByTestId('open-settings').click()
  await alice.page.getByTestId('theme-select').selectOption('light')
  await expect(alice.page.locator('html')).toHaveAttribute('data-theme', 'light')

  // A mnemonic session dies on reload; the preference does not.
  await alice.page.reload()
  await expect(alice.page.getByTestId('join')).toBeVisible()
  await expect(alice.page.locator('html')).toHaveAttribute('data-theme', 'light')

  await alice.context.close()
})
