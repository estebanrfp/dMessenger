import { chromium } from '@playwright/test'
import { SUPERADMIN } from '../src/lib/demo.js'
const { mnemonic } = SUPERADMIN
const RUN = `g-${Date.now().toString(36)}`
const U = `http://localhost:5605/?room=${RUN}&relay=ws://127.0.0.1:5606`
const b = await chromium.launch()
const dark = { colorScheme: 'dark' }
const peer = async () => {
  const c = await b.newContext(dark); const p = await c.newPage()
  await p.goto(U); await p.getByTestId('join').click()
  await p.getByRole('button', { name: 'I saved it' }).click()
  await p.getByTestId('chat-list').waitFor({ timeout: 30000 })
  return { c, p, address: await p.evaluate(() => window.app.address()) }
}
const c0 = await b.newContext(dark); const admin = await c0.newPage()
await admin.goto(U)
await admin.getByRole('button', { name: 'Recover with a phrase' }).click()
await admin.getByTestId('mnemonic').fill(mnemonic)
await admin.getByTestId('recover-confirm').click()
await admin.getByTestId('chat-list').waitFor({ timeout: 30000 })
const bob = await peer(), carol = await peer()

await admin.getByTestId('new-group').click()
await admin.getByTestId('group-name').fill('núcleo GenosDB')
await admin.getByTestId('group-members').fill(`${bob.address}\n${carol.address}`)
await admin.getByTestId('create-group').click()
await admin.getByTestId('group-row').waitFor({ timeout: 30000 })
await admin.getByTestId('group-row').click()
await admin.getByTestId('composer').waitFor()
for (const t of ['el roster es un nodo con dueño', 'y la pertenencia es una clave, no un flag']) {
  await admin.getByTestId('composer').fill(t); await admin.getByTestId('send').click(); await admin.waitForTimeout(600)
}
// que respondan los miembros
for (const m of [bob, carol]) {
  await m.p.getByTestId('group-row').click()
  const t0 = Date.now()
  while (Date.now() - t0 < 60000) {
    if (await m.p.getByTestId('composer').isEnabled().catch(()=>false)) break
    await m.p.waitForTimeout(1000)
  }
  await m.p.getByTestId('composer').fill(m === bob ? 'expulsar abre una época nueva' : 'y el historial sigue intacto')
  await m.p.getByTestId('send').click()
  await m.p.waitForTimeout(800)
}
const t0 = Date.now()
while (Date.now() - t0 < 60000) {
  if (await admin.getByTestId('message').count() >= 4) break
  await admin.waitForTimeout(800)
}
await admin.screenshot({ path: 'tests/__screens/group-thread.png' })
await admin.getByTestId('space-header').click()
await admin.getByTestId('roster').waitFor({ timeout: 15000 })
await admin.waitForTimeout(800)
await admin.screenshot({ path: 'tests/__screens/group-details.png' })
console.log('capturas de grupo listas')
await b.close()
