// Renders the figures for the blog post from HTML, in the app's own palette.
import { chromium } from '@playwright/test'
const css = `
  :root { --page:#09090c; --card:#18181e; --field:#26262e; --raised:#363640; --ink:#f6f6fa; --dim:#a0a6b4; --faint:#707684; --accent:#605ceb; --ok:#34c77b; --warn:#f5a623; --danger:#ef5350; --violet:#a78bfa; --line:#2c2c36 }
  * { box-sizing:border-box; margin:0 } body { width:1400px; background:var(--page); color:var(--ink); font:16px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; padding:44px 56px 36px; position:relative }
  h1 { font-size:30px; font-weight:800; letter-spacing:-.4px } h1 b { color:var(--accent) } .sub { color:var(--dim); font-size:17px; margin-top:6px }
  .mono { font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:14px }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:20px 22px }
  .tag { display:inline-block; padding:3px 10px; border-radius:99px; font-size:12px; font-weight:600 }
  .foot { margin-top:26px; color:var(--faint); font-size:13px }
`
const pages = {
  axes: `<h1>One graph, <b>three axes</b> of separation</h1><p class="sub">Every peer replicates the same graph. What keeps a private messenger private is not <i>where</i> a node lives, but what it is, who owns it, and who holds an envelope for it.</p>
  <div style="margin-top:28px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px">
    <div class="card"><span class="tag" style="background:rgb(96 92 235 / .2);color:var(--accent)">KIND</span><h2 style="font-size:22px;margin:12px 0 6px">value.t + one query per view</h2><p style="color:var(--dim)">The queries are the routing. No store, no router, no array kept in step with the screen.</p>
      <div class="mono" style="margin-top:16px;display:grid;gap:8px"><div style="background:var(--field);border-radius:8px;padding:8px 10px">{ t: 'conv', members: { $in: [me] } }</div><div style="background:var(--field);border-radius:8px;padding:8px 10px">{ t: 'msg', conv: id } · sorted by ts</div><div style="background:var(--field);border-radius:8px;padding:8px 10px">{ t: 'react', conv: id }</div></div></div>
    <div class="card"><span class="tag" style="background:rgb(52 199 123 / .18);color:var(--ok)">OWNERSHIP</span><h2 style="font-size:22px;margin:12px 0 6px">value.owner → id ${'${owner}'}:…</h2><p style="color:var(--dim)">Only the owner (or a collaborator) may write, link or delete it — checked by <b style="color:var(--ink)">every peer</b> on every path.</p>
      <div class="mono" style="margin-top:16px;display:grid;gap:8px"><div style="background:var(--field);border-radius:8px;padding:8px 10px;border-left:3px solid var(--ok)">0xAlice:msg:… ✓ Alice wrote it</div><div style="background:var(--field);border-radius:8px;padding:8px 10px;border-left:3px solid var(--ok)">0xBob:react:0xAlice:msg:… ✓</div><div style="background:var(--field);border-radius:8px;padding:8px 10px;border-left:3px solid var(--danger);color:var(--danger)">0xAlice:react:… written by Bob ✗ refused</div></div></div>
    <div class="card"><span class="tag" style="background:rgb(167 139 250 / .2);color:var(--violet)">CONFIDENTIALITY</span><h2 style="font-size:22px;margin:12px 0 6px">an envelope per reader</h2><p style="color:var(--dim)">The key is an encrypted record; <span class="mono">acls.grant</span> wraps it for each member. The room replicates every byte; only members open it.</p>
      <div style="margin-top:16px;background:var(--field);border-radius:10px;padding:12px 14px"><div class="mono" style="color:var(--violet)">🔒 key record · epoch keys [k0, k1]</div><div class="mono" style="margin-top:8px;color:var(--dim)">envelopes → Alice ✓ · Superadmin ✓ · <s>Bob</s> revoked</div><div class="mono" style="margin-top:8px;color:var(--dim)">outsider: ciphertext, nothing else</div></div></div>
  </div><div class="foot">dMessenger · one GenosDB database, no server in the data path</div>`,
  relay: `<h1>The relay <b>introduces</b>. WebRTC carries.</h1><p class="sub">A Nostr relay exchanges the WebRTC offers and answers so two browsers can find each other — and never sees a message. The suite proves it the only honest way: it kills the relay.</p>
  <svg width="1288" height="440" style="margin-top:22px" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
    <defs><marker id="a" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#605ceb"/></marker></defs>
    <g><rect x="504" y="18" width="280" height="86" rx="16" fill="#18181e" stroke="#2c2c36"/><text x="644" y="52" text-anchor="middle" fill="#f6f6fa" font-size="20" font-weight="700">signaling relay</text><text x="644" y="80" text-anchor="middle" fill="#a0a6b4" font-size="14">offers · answers · presence — never data</text>
      <line x1="560" y1="30" x2="730" y2="92" stroke="#ef5350" stroke-width="6" stroke-linecap="round"/><line x1="730" y1="30" x2="560" y2="92" stroke="#ef5350" stroke-width="6" stroke-linecap="round"/>
      <text x="644" y="134" text-anchor="middle" fill="#ef5350" font-size="15" font-weight="600">killed with SIGKILL after the introduction</text></g>
    <line x1="250" y1="290" x2="560" y2="110" stroke="#707684" stroke-width="2" stroke-dasharray="8 8"/><line x1="1038" y1="290" x2="728" y2="110" stroke="#707684" stroke-width="2" stroke-dasharray="8 8"/>
    <text x="360" y="190" fill="#707684" font-size="14" transform="rotate(-30 360 190)">introduction only</text><text x="900" y="176" fill="#707684" font-size="14" transform="rotate(30 900 176)">introduction only</text>
    <g><rect x="60" y="250" width="300" height="130" rx="18" fill="#18181e" stroke="#2c2c36"/><text x="210" y="300" text-anchor="middle" fill="#f6f6fa" font-size="22" font-weight="700">Alice's browser</text><text x="210" y="330" text-anchor="middle" fill="#a0a6b4" font-size="14">her copy of the graph · OPFS</text><text x="210" y="356" text-anchor="middle" fill="#605ceb" font-size="14" font-family="ui-monospace,Menlo,monospace">0x3546…4931</text></g>
    <g><rect x="928" y="250" width="300" height="130" rx="18" fill="#18181e" stroke="#2c2c36"/><text x="1078" y="300" text-anchor="middle" fill="#f6f6fa" font-size="22" font-weight="700">Bob's browser</text><text x="1078" y="330" text-anchor="middle" fill="#a0a6b4" font-size="14">his copy of the graph · OPFS</text><text x="1078" y="356" text-anchor="middle" fill="#605ceb" font-size="14" font-family="ui-monospace,Menlo,monospace">0x8089…7DEC</text></g>
    <line x1="366" y1="315" x2="920" y2="315" stroke="#605ceb" stroke-width="8" stroke-linecap="round" marker-end="url(#a)"/><line x1="920" y1="315" x2="366" y2="315" stroke="#605ceb" stroke-width="8" stroke-linecap="round" marker-end="url(#a)"/>
    <rect x="493" y="330" width="302" height="72" rx="12" fill="#26262e" stroke="#2c2c36"/><text x="644" y="358" text-anchor="middle" fill="#f6f6fa" font-size="16" font-weight="700">WebRTC data channel · signed operations</text><text x="644" y="384" text-anchor="middle" fill="#34c77b" font-size="15" font-weight="600">20/20 delivered after the kill · p50 45 ms · 0 HTTP requests</text>
  </svg><div class="foot">measured by pnpm perf, in real Chromium over real WebRTC</div>`,
  epochs: `<h1>Removing a member opens a <b>new key epoch</b></h1><p class="sub">Two incompatible needs: they must stop reading what comes next, and everyone who stayed must keep reading what came before. So the key record holds one key per epoch, and each message carries the epoch it was sealed under.</p>
  <svg width="1288" height="430" style="margin-top:22px" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
    <line x1="60" y1="120" x2="1228" y2="120" stroke="#2c2c36" stroke-width="2"/>
    <g><rect x="60" y="60" width="470" height="120" rx="16" fill="rgb(96 92 235 / .12)" stroke="#605ceb"/><text x="84" y="92" fill="#605ceb" font-size="15" font-weight="700">EPOCH 0 · key k0</text><text x="84" y="120" fill="#f6f6fa" font-size="17">envelopes: Alice · Bob · Superadmin</text><text x="84" y="150" fill="#a0a6b4" font-size="15" font-family="ui-monospace,Menlo,monospace">m1 "before the removal" · epoch 0</text></g>
    <g><rect x="560" y="46" width="170" height="148" rx="16" fill="#18181e" stroke="#ef5350"/><text x="645" y="84" text-anchor="middle" fill="#ef5350" font-size="15" font-weight="700">Alice removes Bob</text><text x="645" y="112" text-anchor="middle" fill="#a0a6b4" font-size="13">1 · revoke his envelope</text><text x="645" y="134" text-anchor="middle" fill="#a0a6b4" font-size="13">2 · append key k1</text><text x="645" y="156" text-anchor="middle" fill="#a0a6b4" font-size="13">3 · write the roster</text><text x="645" y="182" text-anchor="middle" fill="#707684" font-size="12">28 s, live</text></g>
    <g><rect x="760" y="60" width="468" height="120" rx="16" fill="rgb(52 199 123 / .10)" stroke="#34c77b"/><text x="784" y="92" fill="#34c77b" font-size="15" font-weight="700">EPOCH 1 · keys [k0, k1]</text><text x="784" y="120" fill="#f6f6fa" font-size="17">envelopes: Alice · Superadmin</text><text x="784" y="150" fill="#a0a6b4" font-size="15" font-family="ui-monospace,Menlo,monospace">m2 "after the removal" · epoch 1</text></g>
    <g><rect x="60" y="240" width="560" height="150" rx="16" fill="#18181e" stroke="#2c2c36"/><text x="84" y="274" fill="#f6f6fa" font-size="19" font-weight="700">Superadmin — stayed</text><text x="84" y="306" fill="#34c77b" font-size="16">✓ m1  "before the removal"</text><text x="84" y="336" fill="#34c77b" font-size="16">✓ m2  "after the removal"</text><text x="84" y="368" fill="#a0a6b4" font-size="14">holds k0 and k1: the whole history, before and after</text></g>
    <g><rect x="668" y="240" width="560" height="150" rx="16" fill="#18181e" stroke="#2c2c36"/><text x="692" y="274" fill="#f6f6fa" font-size="19" font-weight="700">Bob — removed</text><text x="692" y="306" fill="#a0a6b4" font-size="16">✓ m1  still on his screen — no rotation takes that back</text><text x="692" y="336" fill="#ef5350" font-size="16">🔒 m2  ciphertext for a key he cannot reach</text><text x="692" y="368" fill="#a0a6b4" font-size="14">still replicates the bytes; the key record no longer opens for him</text></g>
  </svg><div class="foot">forward-only by construction: what a member could read while authorized, they may have copied</div>`,
}
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 760 }, deviceScaleFactor: 1.5 })
for (const [name, body] of Object.entries(pages)) {
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`)
  await p.waitForTimeout(200)
  const height = await p.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height))
  await p.setViewportSize({ width: 1400, height })
  await p.screenshot({ path: `docs/post/${name}.png`, clip: { x: 0, y: 0, width: 1400, height } })
  console.log('figura', name)
}
await b.close()
