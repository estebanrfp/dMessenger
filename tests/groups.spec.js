import { test, expect } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
import { room, openPeer, RELAY } from './helpers.js'

const SECRET = new URL('../.secrets/superadmin.json', import.meta.url).pathname

/** Signs in the demo superadmin, who also runs the governance engine. */
const openSuperadmin = async (browser, name) => {
  const { mnemonic } = JSON.parse(readFileSync(SECRET, 'utf8'))
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`/?room=${name}&relay=${RELAY}`)
  await page.getByRole('button', { name: 'Recover with a phrase' }).click()
  await page.getByTestId('mnemonic').fill(mnemonic)
  await page.getByTestId('recover-confirm').click()
  await expect(page.getByTestId('role-badge')).toHaveText('superadmin')
  return { context, page, address: await page.evaluate(() => window.app.address()) }
}

/**
 * Signs a vouch from one peer for another, through the governance panel.
 *
 * Promotion here is *earned*, not handed out: the rules govern the `manager`
 * tier, so a superadmin's manual assignment is overwritten by the floor rule on
 * the next cycle — the documented consequence of letting rules govern a tier
 * you also assign by hand. The supported path is to satisfy the rule.
 */
const vouchFor = async (voucher, address) => {
  await voucher.page.getByTestId('open-governance').click()
  const row = voucher.page.getByTestId('identity-row').filter({ hasText: address.slice(0, 6) })
  await expect(row).toBeVisible({ timeout: 90_000 })
  await row.getByTestId('vouch').click()
}

/** Two signed vouches, published by the subject, are what the rule reads. */
const earnManager = async (subject, vouchers) => {
  await expect(subject.page.getByTestId('role-badge')).toHaveText('user', { timeout: 120_000 })
  for (const voucher of vouchers) await vouchFor(voucher, subject.address)
  await expect.poll(
    async () => {
      await subject.page.getByTestId('open-governance').click()
      await subject.page.getByTestId('publish-vouches').click()
      return subject.page.getByTestId('role-badge').textContent()
    },
    { timeout: 180_000, intervals: [5000] },
  ).toBe('manager')
}

test('creating a group needs the publish permission the ladder grants', async ({ browser }) => {
  test.skip(!existsSync(SECRET), 'no superadmin mnemonic in .secrets (see README)')
  const name = room()
  const alice = await openPeer(browser, name)

  // A fresh identity is a guest, and the button says why it cannot.
  await expect(alice.page.getByTestId('role-badge')).toHaveText('guest')
  await expect(alice.page.getByTestId('new-group')).toBeDisabled()

  // And the engine refuses it, not just the UI.
  const refused = await alice.page.evaluate(() => window.app.createGroup('too early', []))
  expect(refused.ok).toBe(false)

  // The superadmin's presence is what runs the governance engine.
  const admin = await openSuperadmin(browser, name)
  const witness = await openPeer(browser, name)
  await earnManager(alice, [admin, witness])

  await expect(alice.page.getByTestId('new-group')).toBeEnabled()

  const allowed = await alice.page.evaluate(() => window.app.createGroup('now it works', []))
  expect(allowed.ok, allowed.error).toBe(true)

  await alice.context.close()
  await admin.context.close()
  await witness.context.close()
})

test('a removed member keeps the past and loses the future', async ({ browser }) => {
  test.skip(!existsSync(SECRET), 'no superadmin mnemonic in .secrets (see README)')
  const name = room()
  const alice = await openPeer(browser, name)
  const bob = await openPeer(browser, name)
  const carol = await openPeer(browser, name)
  const admin = await openSuperadmin(browser, name)

  await earnManager(alice, [admin, carol])

  // Alice creates the group with both of them in it.
  await alice.page.getByTestId('new-group').click()
  await alice.page.getByTestId('group-name').fill('epoch demo')
  await alice.page.getByTestId('group-members').fill(`${bob.address}\n${carol.address}`)
  await alice.page.getByTestId('create-group').click()

  await expect(alice.page.getByTestId('group-row')).toHaveCount(1)
  await expect(bob.page.getByTestId('group-row')).toHaveCount(1)
  await expect(carol.page.getByTestId('group-row')).toHaveCount(1)

  // Epoch 0: everyone reads it.
  await alice.page.getByTestId('group-row').click()
  await expect(alice.page.getByTestId('composer')).toBeEnabled({ timeout: 90_000 })
  await alice.page.getByTestId('composer').fill('before the removal')
  await alice.page.getByTestId('send').click()

  for (const peer of [bob, carol]) {
    await peer.page.getByTestId('group-row').click()
    await expect(peer.page.getByTestId('message').first()).toContainText('before the removal', { timeout: 90_000 })
  }

  const groupId = await alice.page.evaluate(() => window.app.nodes({ t: 'group' }).then(n => n[0].id))
  const keyId = await alice.page.evaluate(() => window.app.nodes({ t: 'group' }).then(n => n[0].value.keyId))

  // Alice removes Bob: revoke the envelope, then open a new epoch.
  await alice.page.getByTestId('space-header').click()
  const bobRow = alice.page.getByTestId('member-row').filter({ hasText: bob.address.slice(0, 6) })
  await bobRow.getByTestId('remove-member').click()
  await alice.page.getByRole('button', { name: 'Remove' }).last().click()

  await expect(alice.page.getByTestId('member-row')).toHaveCount(2)

  // Epoch 1: a message only the remaining members can open.
  await alice.page.getByTestId('space-header').waitFor({ state: 'detached' }).catch(() => {})
  await alice.page.getByTestId('group-row').click()
  await expect(alice.page.getByTestId('composer')).toBeEnabled({ timeout: 90_000 })
  await alice.page.getByTestId('composer').fill('after the removal')
  await alice.page.getByTestId('send').click()

  // Carol stayed: she reads BOTH epochs. That is what the key array is for.
  await carol.page.getByTestId('group-row').click()
  await expect(carol.page.getByTestId('message')).toHaveCount(2, { timeout: 120_000 })
  await expect(carol.page.getByTestId('message').nth(0)).toContainText('before the removal')
  await expect(carol.page.getByTestId('message').nth(1)).toContainText('after the removal')

  // Sentinel: Bob is still replicating this group's messages...
  await expect
    .poll(() => bob.page.evaluate((id) => window.app.nodes({ t: 'msg', conv: id }).then(n => n.length), groupId),
      { message: 'the removed peer stopped replicating, so reading proves nothing' })
    .toBe(2)

  // ...and can no longer open the key record at all.
  await expect
    .poll(() => bob.page.evaluate((id) => window.app.canOpen(id), keyId))
    .toBe(false)

  // The ciphertext of the new epoch never contains the plaintext.
  const bodies = await bob.page.evaluate((id) => window.app.nodes({ t: 'msg', conv: id }).then(n => n.map(x => x.value.body)), groupId)
  for (const body of bodies) expect(body).not.toContain('after the removal')

  for (const peer of [alice, bob, carol, admin]) await peer.context.close()
})
