// Rasterises public/logo.svg into the PWA icon set with the browser itself.
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const svg = readFileSync(new URL('../public/logo.svg', import.meta.url), 'utf8')
const b = await chromium.launch(); const p = await b.newPage()
for (const [size, name, pad] of [[192, 'icon-192.png', 0], [512, 'icon-512.png', 0], [512, 'icon-maskable-512.png', 0.1]]) {
  const inner = Math.round(size * (1 - pad * 2))
  await p.setViewportSize({ width: size, height: size })
  await p.setContent(`<html><body style="margin:0;background:${pad ? 'rgb(96 92 235)' : 'transparent'};display:grid;place-items:center;width:${size}px;height:${size}px">${svg.replace(/width="64" height="64"/, `width="${inner}" height="${inner}"`)}</body></html>`)
  await p.screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname, omitBackground: !pad, clip: { x: 0, y: 0, width: size, height: size } })
  console.log('icono', name)
}
await b.close()
