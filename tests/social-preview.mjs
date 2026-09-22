import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const logo = readFileSync('public/logo.svg', 'utf8')
const shot = readFileSync('docs/screenshot-dark.png').toString('base64')
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root { --page: #09090c; --card: #18181e; --ink: #f6f6fa; --dim: #a0a6b4; --accent: #605ceb; --line: #2c2c36; }
  * { box-sizing: border-box; margin: 0 } body { width: 1280px; height: 640px; background: var(--page); color: var(--ink); font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; overflow: hidden; position: relative }
  .glow { position: absolute; inset: -40% -20% auto -20%; height: 120%; background: radial-gradient(60% 50% at 30% 30%, rgb(96 92 235 / .25), transparent 70%) }
  .copy { position: absolute; left: 72px; top: 92px; width: 520px }
  .brand { display: flex; align-items: center; gap: 18px } .brand svg { width: 64px; height: 64px } .brand h1 { font-size: 56px; font-weight: 800; letter-spacing: -1px } .brand h1 b { color: var(--accent); font-weight: 800 }
  .tag { margin-top: 26px; font-size: 26px; line-height: 1.3; color: var(--ink) } .tag em { font-style: normal; color: var(--accent) }
  ul { margin-top: 30px; list-style: none; display: grid; gap: 12px } li { font-size: 19px; color: var(--dim); display: flex; gap: 12px; align-items: baseline } li::before { content: ""; width: 8px; height: 8px; border-radius: 99px; background: var(--accent); flex-shrink: 0; position: relative; top: -2px }
  .foot { position: absolute; left: 72px; bottom: 56px; font-size: 17px; color: var(--dim) } .foot b { color: var(--ink); font-weight: 600 }
  .shot { position: absolute; right: -180px; top: 96px; width: 820px; border-radius: 18px; border: 1px solid var(--line); box-shadow: 0 30px 80px rgb(0 0 0 / .6); overflow: hidden; transform: perspective(1400px) rotateY(-10deg) rotateX(2deg) } .shot img { display: block; width: 100% }
</style></head><body>
  <div class="glow"></div>
  <div class="copy">
    <div class="brand">${logo}<h1><b>d</b>Messenger</h1></div>
    <p class="tag">A private messenger that runs <em>entirely between its users</em>.</p>
    <ul><li>One GenosDB graph — no relays holding messages, no servers</li><li>Sealed for members: keys travel as envelopes, never in the clear</li><li>Roles earned through governance, enforced by every peer</li><li>Installs as an app and opens with no network</li></ul>
  </div>
  <div class="foot"><b>estebanrfp.github.io/dMessenger</b> · MIT · built on GenosDB</div>
  <div class="shot"><img src="data:image/png;base64,${shot}"></div>
</body></html>`
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 })
await p.setContent(html); await p.waitForTimeout(300)
await p.screenshot({ path: 'docs/social-preview.png', clip: { x: 0, y: 0, width: 1280, height: 640 } })
console.log('social preview: docs/social-preview.png'); await b.close()
