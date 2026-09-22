import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const { mnemonic } = JSON.parse(readFileSync(new URL('../.secrets/superadmin.json', import.meta.url).pathname, 'utf8'))
const RUN = `shot-${Date.now().toString(36)}`
const URL_ = (r) => `http://localhost:5605/?room=${r}&relay=ws://127.0.0.1:5606`
const b = await chromium.launch()

const join = async (dark) => {
  const c = await b.newContext({ colorScheme: dark ? 'dark' : 'light' })
  const p = await c.newPage()
  await p.goto(URL_(RUN))
  await p.getByTestId('join').click()
  await p.getByRole('button', { name: 'I saved it' }).click()
  await p.getByTestId('chat-list').waitFor({ timeout: 30000 })
  return { c, p, address: await p.evaluate(() => window.app.address()) }
}

const alice = await join(true)
const bob = await join(true)
await alice.p.getByTestId('new-chat').click()
await alice.p.getByTestId('peer-address').fill(bob.address)
await alice.p.getByTestId('start-chat').click()
await alice.p.getByTestId('chat-row').first().click()
await alice.p.getByTestId('composer').waitFor()

// superadmin para que corra la gobernanza
const ac = await b.newContext({ colorScheme: 'dark' }); const ap = await ac.newPage()
await ap.goto(URL_(RUN))
await ap.getByRole('button', { name: 'Recover with a phrase' }).click()
await ap.getByTestId('mnemonic').fill(mnemonic)
await ap.getByTestId('recover-confirm').click()
await ap.getByTestId('chat-list').waitFor({ timeout: 30000 })

for (const text of ['esto va por un único grafo', 'sin relays, sin servidor', 'y la clave viaja en un sobre']) {
  await alice.p.getByTestId('composer').fill(text)
  await alice.p.getByTestId('send').click()
  await alice.p.waitForTimeout(700)
}
await bob.p.getByTestId('chat-row').first().click()
const t0 = Date.now()
while (Date.now() - t0 < 60000) {
  const n = await bob.p.getByTestId('message').count()
  const txt = await bob.p.getByTestId('message').first().textContent().catch(()=>'')
  if (n >= 3 && txt.includes('único grafo')) break
  await bob.p.waitForTimeout(800)
}
await bob.p.screenshot({ path: 'tests/__screens/chat-dark.png' })

await ap.waitForTimeout(14000)          // deja correr un par de ciclos de gobernanza
await ap.getByTestId('open-governance').click()
await ap.waitForTimeout(1500)
await ap.screenshot({ path: 'tests/__screens/governance.png' })
console.log('capturas listas')
await b.close()
