import { chromium } from '@playwright/test'
const RUN = `x-${Date.now().toString(36)}`
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
await alice.p.getByTestId('new-chat').click()
await alice.p.getByTestId('peer-address').fill(bob.address)
await alice.p.getByTestId('start-chat').click()
await alice.p.getByTestId('chat-row').first().click()
await alice.p.getByTestId('composer').waitFor()
await alice.p.getByTestId('chat-menu').click()
await alice.p.getByTestId('menu-disappearing').click()
await alice.p.getByTestId('ttl-options').waitFor()
await alice.p.screenshot({ path: 'tests/__screens/expiry-picker.png' })
await alice.p.getByTestId('ttl-option').filter({ hasText: '5 minutes' }).click()
await alice.p.getByTestId('ttl-notice').waitFor()
for (const t of ['esto se borra en cinco minutos', 'en cada peer honesto, sin esperar a nadie']) {
  await alice.p.getByTestId('composer').fill(t); await alice.p.getByTestId('send').click(); await alice.p.waitForTimeout(700)
}
await bob.p.getByTestId('chat-row').first().click()
const t0 = Date.now()
while (Date.now() - t0 < 60000) {
  const n = await bob.p.getByTestId('countdown').count()
  if (n >= 2) break
  await bob.p.waitForTimeout(800)
}
await bob.p.getByTestId('composer').fill('y la política la ve cualquiera de los dos')
await bob.p.getByTestId('send').click()
await bob.p.waitForTimeout(1500)
await bob.p.screenshot({ path: 'tests/__screens/expiry-thread.png' })
console.log('capturas de expiración listas')
await b.close()
