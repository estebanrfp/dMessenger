import { chromium } from '@playwright/test'
const RUN = `f-${Date.now().toString(36)}`
const U = `http://localhost:5605/?room=${RUN}&relay=ws://127.0.0.1:5607`
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAY0lEQVR42u3PMQEAAAgDoP1/qgFfkQVCyj0cGgQFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQXPBjQ1AAFVv1OeAAAAAElFTkSuQmCC', 'base64')
const fake = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const peer = async () => {
  const c = await fake.newContext({ colorScheme: 'dark' }); const p = await c.newPage()
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
await alice.p.getByTestId('composer').fill('te mando el logo y una nota de voz')
await alice.p.getByTestId('send').click()
await alice.p.getByTestId('file-input').setInputFiles('public/icon-192.png')
await alice.p.getByTestId('attach-bar').waitFor()
await alice.p.screenshot({ path: 'tests/__screens/attach-pending.png' })
await alice.p.getByTestId('send').click()
await alice.p.getByTestId('record').click()
await alice.p.waitForTimeout(1800)
await alice.p.screenshot({ path: 'tests/__screens/recording.png' })
await alice.p.getByTestId('record-send').click()
await bob.p.getByTestId('chat-row').first().click()
const t0 = Date.now(); while (Date.now() - t0 < 60000) { if (await bob.p.getByTestId('file-audio').count() && await bob.p.getByTestId('file-image').count()) break; await bob.p.waitForTimeout(600) }
await bob.p.waitForTimeout(800)
await bob.p.screenshot({ path: 'tests/__screens/files-thread.png' })
console.log('capturas de adjuntos listas')
await fake.close()
