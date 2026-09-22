import { expect } from '@playwright/test'

export const RELAY = 'ws://127.0.0.1:5606'

/** A fresh room per test: the graph also lives on the wire. */
export const room = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/** Collects every RTCPeerConnection before any page script runs. */
export const instrumentTransport = (context) =>
  context.addInitScript(() => {
    const Native = window.RTCPeerConnection
    window.__pcs = []
    window.RTCPeerConnection = class extends Native {
      constructor(...args) { super(...args); window.__pcs.push(this) }
    }
    Object.setPrototypeOf(window.RTCPeerConnection, Native)
  })

/**
 * Opens one peer: its own BrowserContext, so its own OPFS, localStorage,
 * IndexedDB and BroadcastChannel. A tab would be the same peer twice.
 */
export const openPeer = async (browser, roomName, { transport = false } = {}) => {
  const context = await browser.newContext()
  if (transport) await instrumentTransport(context)
  const page = await context.newPage()
  await page.goto(`/?room=${roomName}&relay=${RELAY}`)
  await page.getByTestId('join').click()
  const mnemonic = await page.locator('dialog p.mono').textContent()
  await page.getByRole('button', { name: 'I saved it' }).click()
  await expect(page.getByTestId('chat-list')).toBeVisible()
  const address = await page.evaluate(() => window.app.address())
  expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/)
  return { context, page, address, mnemonic }
}

/** Starts a conversation with another address and waits for the row. */
export const startChat = async (peer, otherAddress) => {
  await peer.page.getByTestId('new-chat').click()
  await peer.page.getByTestId('peer-address').fill(otherAddress)
  await peer.page.getByTestId('start-chat').click()
  await expect(peer.page.getByTestId('chat-row').first()).toBeVisible()
}

/** Sends a message in the first conversation. */
export const say = async (peer, text) => {
  await peer.page.getByTestId('chat-row').first().click()
  const composer = peer.page.getByTestId('composer')
  await expect(composer).toBeEnabled()
  await composer.fill(text)
  await peer.page.getByTestId('send').click()
}

/**
 * Proves the bytes crossed WebRTC: the busiest succeeded candidate pair across
 * every connection. ICE can hold several succeeded pairs and only the
 * nominated one carries traffic, so the first one found proves nothing —
 * the one with bytes on it does. Read only after the app-level assertion, or
 * the stats are still empty.
 */
export const transportProof = (page) => page.evaluate(async () => {
  let best = null
  for (const pc of window.__pcs ?? []) {
    for (const report of (await pc.getStats()).values()) {
      if (report.type !== 'candidate-pair' || report.state !== 'succeeded') continue
      const pair = { bytesSent: report.bytesSent ?? 0, bytesReceived: report.bytesReceived ?? 0 }
      if (!best || pair.bytesReceived + pair.bytesSent > best.bytesReceived + best.bytesSent) best = pair
    }
  }
  return best
})
