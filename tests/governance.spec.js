import { test, expect } from '@playwright/test'
import { room, openPeer } from './helpers.js'

/**
 * Governance runs while a superadmin is signed in on that device — their key
 * signs every decision — or 24/7 on the Fallback Server. Here a browser peer
 * plays the superadmin, exactly as the engine's own governance demo does.
 *
 * Rule 1 keys on time the engine itself observed, so no client can forge it:
 * a guest whose node has been stable for 8s becomes a user.
 */

test('a guest is promoted by a signed decision, and every peer agrees', async ({ browser }) => {
  const name = room()

  const newcomer = await openPeer(browser, name)
  await expect(newcomer.page.getByTestId('role-badge')).toHaveText('guest')

  // The superadmin joins: from here the rules are evaluated every 4s.
  const admin = await browser.newContext()
  const adminPage = await admin.newPage()
  await adminPage.goto(`/?room=${name}&relay=ws://127.0.0.1:5606`)
  await adminPage.getByTestId('demo-superadmin').click()            // the design guide's one-click demo shortcut
  await expect(adminPage.getByTestId('chat-list')).toBeVisible()
  await expect(adminPage.getByTestId('role-badge')).toHaveText('superadmin')

  // The promotion is a node in the graph, so it shows up on the newcomer too.
  await expect(newcomer.page.getByTestId('role-badge')).toHaveText('user', { timeout: 120_000 })

  // And on a third peer that was never involved: the decision is the graph's.
  const witness = await openPeer(browser, name)
  await witness.page.getByTestId('open-governance').click()
  const row = witness.page.getByTestId('identity-row').filter({ hasText: newcomer.address.slice(0, 6) })
  await expect(row).toContainText('user')

  await newcomer.context.close()
  await admin.close()
  await witness.context.close()
})
