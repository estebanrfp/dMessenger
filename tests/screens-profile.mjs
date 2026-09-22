import { chromium } from '@playwright/test'
const RUN = `p-${Date.now().toString(36)}`
const U = `http://localhost:5605/?room=${RUN}&relay=ws://127.0.0.1:5607`
const b = await chromium.launch()
const peer = async () => {
  const c = await b.newContext({ colorScheme: 'dark' }); const p = await c.newPage()
  await p.goto(U); await p.getByTestId('join').click()
  await p.getByRole('button', { name: 'I saved it' }).click()
  await p.getByTestId('chat-list').waitFor({ timeout: 30000 })
  return { c, p, address: await p.evaluate(() => window.app.address()) }
}
const alice = await peer(), bob = await peer()
await alice.p.getByTestId('open-profile').click()
await alice.p.getByTestId('name-input').fill('Alice')
await alice.p.getByTestId('name-save').click()
await alice.p.waitForTimeout(600)
await alice.p.screenshot({ path: 'tests/__screens/profile-own.png' })
await bob.p.getByTestId('new-chat').click()
await bob.p.getByTestId('peer-address').fill(alice.address)
await bob.p.getByTestId('start-chat').click()
await bob.p.getByTestId('chat-row').first().click()
const t0 = Date.now(); while (Date.now() - t0 < 60000) { if ((await bob.p.getByTestId('space-title').textContent()) === 'Alice') break; await bob.p.waitForTimeout(500) }
await bob.p.getByTestId('space-header').click()
await bob.p.getByTestId('profile-card').waitFor()
await bob.p.waitForTimeout(500)
await bob.p.screenshot({ path: 'tests/__screens/profile-other.png' })
await bob.p.getByTestId('open-settings').click()
await bob.p.waitForTimeout(800)
await bob.p.screenshot({ path: 'tests/__screens/settings.png' })
await alice.p.getByTestId('new-chat').click()
await alice.p.getByTestId('open-invite').click()
await alice.p.getByTestId('invite-qr').waitFor()
await alice.p.waitForTimeout(300)
await alice.p.screenshot({ path: 'tests/__screens/invite.png' })
console.log('capturas de perfil/ajustes/invitación listas')
await b.close()
