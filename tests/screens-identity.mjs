import { chromium } from '@playwright/test'
import { SUPERADMIN } from '../src/lib/demo.js'
const { mnemonic } = SUPERADMIN
const RUN = `id-${Date.now().toString(36)}`
const U = `http://localhost:5605/?room=${RUN}&relay=ws://127.0.0.1:5607`
const b = await chromium.launch()
const login = async (scheme, phrase) => {
  const c = await b.newContext({ colorScheme: scheme }); const p = await c.newPage()
  await p.goto(U)
  if (phrase) {
    await p.getByRole('button', { name: 'Recover with a phrase' }).click()
    await p.getByTestId('mnemonic').fill(phrase); await p.getByTestId('recover-confirm').click()
  } else {
    await p.getByTestId('join').click(); await p.getByRole('button', { name: 'I saved it' }).click()
  }
  await p.getByTestId('chat-list').waitFor({ timeout: 30000 })
  return { c, p, address: await p.evaluate(() => window.app.address()) }
}
// login screens, both themes
for (const scheme of ['dark', 'light']) {
  const c = await b.newContext({ colorScheme: scheme }); const p = await c.newPage()
  await p.goto(U); await p.getByTestId('join').waitFor(); await p.waitForTimeout(400)
  await p.screenshot({ path: `tests/__screens/new-login-${scheme}.png` }); await c.close()
}
const admin = await login('dark', mnemonic), bob = await login('dark'), carol = await login('light')
await admin.p.getByTestId('open-profile').click()
await admin.p.getByTestId('name-input').fill('Esteban'); await admin.p.getByTestId('name-save').click()
await bob.p.getByTestId('open-profile').click()
await bob.p.getByTestId('name-input').fill('Bob'); await bob.p.getByTestId('name-save').click()
await admin.p.getByTestId('new-group').click()
await admin.p.getByTestId('group-name').fill('GenosDB core team')
await admin.p.getByTestId('group-members').fill(`${bob.address}\n${carol.address}`)
await admin.p.getByTestId('create-group').click()
await admin.p.getByTestId('group-row').waitFor({ timeout: 30000 }); await admin.p.getByTestId('group-row').click()
await admin.p.getByTestId('composer').waitFor()
await admin.p.getByTestId('chat-menu').click(); await admin.p.getByTestId('menu-disappearing').click()
await admin.p.getByTestId('ttl-option').filter({ hasText: '1 day' }).click()
for (const t of ['one graph, no servers — and the constitution enforced by every peer', 'a message is a node you own; a key is an envelope only members can open']) {
  await admin.p.getByTestId('composer').fill(t); await admin.p.getByTestId('send').click(); await admin.p.waitForTimeout(600)
}
const wait = async (m) => { await m.p.getByTestId('group-row').click(); const t0 = Date.now(); while (Date.now() - t0 < 60000) { if (await m.p.getByTestId('composer').isEnabled().catch(() => false) && await m.p.getByTestId('message').count() >= 2) break; await m.p.waitForTimeout(500) } }
await wait(bob); await wait(carol)
await bob.p.getByTestId('composer').fill('reactions are signed by whoever reacts, nobody can react in your name'); await bob.p.getByTestId('send').click()
const first = bob.p.getByTestId('message').first(); await first.hover(); await first.getByTestId('react-action').click()
await bob.p.getByTestId('quick-emoji').filter({ hasText: '🔥' }).click()
await carol.p.getByTestId('message').nth(2).waitFor({ timeout: 60000 })
const reply = carol.p.getByTestId('message').nth(1); await reply.hover(); await reply.getByTestId('reply-action').click()
await carol.p.getByTestId('composer').fill('nothing here is decided by a server'); await carol.p.getByTestId('send').click()
await admin.p.getByTestId('message').nth(3).waitFor({ timeout: 60000 }); await admin.p.waitForTimeout(1200)
await admin.p.screenshot({ path: 'tests/__screens/new-chat-dark.png' })
await carol.p.waitForTimeout(800); await carol.p.screenshot({ path: 'tests/__screens/new-chat-light.png' })
await admin.p.getByTestId('open-governance').click(); await admin.p.waitForTimeout(1200)
await admin.p.screenshot({ path: 'tests/__screens/new-governance.png' })
console.log('capturas de la nueva identidad listas'); await b.close()
