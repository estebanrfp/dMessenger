/**
 * Mints the local demo superadmin for a fresh clone, with the engine itself.
 *
 * The constitution is local configuration compiled into the bundle, identical
 * for every peer built from it — never read from a URL or the graph. Here it
 * comes from `.env.local` (VITE_SUPERADMINS), and the matching mnemonic lands
 * in `.secrets/superadmin.json`; both are ignored by git.
 *
 *   node scripts/mint.mjs              always mint a new one
 *   node scripts/mint.mjs --if-missing  only when none exists (the `pretest` hook)
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { chromium } from '@playwright/test'

const root = new URL('..', import.meta.url).pathname
const secret = `${root}.secrets/superadmin.json`
const envFile = `${root}.env.local`

if (process.argv.includes('--if-missing') && existsSync(secret) && existsSync(envFile) && readFileSync(envFile, 'utf8').includes('VITE_SUPERADMINS=')) {
  console.log('superadmin: already minted')
  process.exit(0)
}

// A tiny origin of our own: OPFS and localStorage need one, and a data: URL has none.
const page = `<!doctype html><script type="module">
  import { gdb } from 'https://cdn.jsdelivr.net/npm/genosdb@0.36.3/dist/index.min.js'
  const db = await gdb('mint-${Date.now().toString(36)}', { sm: { superAdmins: ['0x0000000000000000000000000000000000000001'] } })
  window.identity = await db.sm.startNewUserRegistration()
</script>`
const server = createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end(page) }).listen(0)
const { port } = server.address()

const browser = await chromium.launch()
const tab = await browser.newPage()
await tab.goto(`http://localhost:${port}/`)
await tab.waitForFunction('window.identity && window.identity.address', null, { timeout: 60_000 })
const identity = await tab.evaluate(() => window.identity)
await browser.close()
server.close()

mkdirSync(`${root}.secrets`, { recursive: true })
writeFileSync(secret, JSON.stringify({ address: identity.address, mnemonic: identity.mnemonic }, null, 2) + '\n')
const rest = existsSync(envFile) ? readFileSync(envFile, 'utf8').split('\n').filter(l => l && !l.startsWith('VITE_SUPERADMINS=')) : []
writeFileSync(envFile, [...rest, `VITE_SUPERADMINS=${identity.address}`].join('\n') + '\n')
console.log(`superadmin: ${identity.address} (mnemonic in .secrets/superadmin.json, address in .env.local)`)
