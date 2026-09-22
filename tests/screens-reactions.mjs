import { chromium } from '@playwright/test'
const RUN = `r-${Date.now().toString(36)}`
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
await alice.p.getByTestId('composer').fill('¿qué te parece la demo de reacciones?')
await alice.p.getByTestId('send').click()
await bob.p.getByTestId('chat-row').first().click()
await bob.p.getByTestId('message').first().waitFor({ timeout: 60000 })
const t0 = Date.now(); while (Date.now() - t0 < 60000) { if (await bob.p.getByTestId('composer').isEnabled()) break; await bob.p.waitForTimeout(500) }
// bob responde citando y reacciona
const original = bob.p.getByTestId('message').first()
await original.hover(); await original.getByTestId('reply-action').click()
await bob.p.getByTestId('composer').fill('me convence: un nodo por reacción, firmado por quien reacciona')
await bob.p.getByTestId('send').click()
await original.hover(); await original.getByTestId('react-action').click()
await bob.p.getByTestId('quick-emoji').filter({ hasText: '🔥' }).click()
// alice reacciona a la respuesta y abre el picker para la captura
await alice.p.getByTestId('message').nth(1).waitFor({ timeout: 60000 })
const reply = alice.p.getByTestId('message').nth(1)
await reply.hover(); await reply.getByTestId('react-action').click()
await alice.p.getByTestId('quick-emoji').filter({ hasText: '❤️' }).click()
await alice.p.getByTestId('message').first().getByTestId('reaction-pill').first().waitFor({ timeout: 60000 })
await reply.hover(); await reply.getByTestId('react-action').click()
await alice.p.getByTestId('emoji-picker').waitFor()
await alice.p.screenshot({ path: 'tests/__screens/reactions-picker.png' })
await alice.p.keyboard.press('Escape'); await alice.p.getByTestId('thread').click({ position: { x: 400, y: 500 } })
await bob.p.waitForTimeout(1500)
await bob.p.screenshot({ path: 'tests/__screens/reactions-thread.png' })
console.log('capturas de reacciones listas')
await b.close()
