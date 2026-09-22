import { mkdirSync, writeFileSync } from 'node:fs'

const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

/** p50 / p95 / max / mean over a list of milliseconds. */
export const stats = (values) => ({
  n: values.length,
  p50: pct(values, 50),
  p95: pct(values, 95),
  max: Math.max(...values),
  mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
})

const ms = (v) => `${v} ms`
const lat = (s) => `p50 ${s.p50} · p95 ${s.p95} · max ${s.max} ms (n=${s.n})`

/** Renders the collected numbers as JSON and as a Markdown table. */
export const writeReport = (results, dir = 'perf-results') => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/report.json`, JSON.stringify({ at: new Date().toISOString(), ...results }, null, 2) + '\n')
  const r = results
  const rows = [
    ['Cold start — first load, engine from the CDN, until the identity door is on screen', r.boot && ms(r.boot.coldMs)],
    ['Warm start — reload, engine from the browser cache', r.boot && ms(r.boot.warmMs)],
    ['Identity — key pair, mnemonic and volatile session', r.boot && ms(r.boot.identityMs)],
    ['App mount after the phrase is saved — session, graph, subscriptions', r.boot && ms(r.boot.mountMs)],
    ['Peer discovery — relay introduction + ICE, until the other peer is seen', r.discoveryMs != null && ms(r.discoveryMs)],
    ['Key exchange — a conversation opened, envelope granted and delivered', r.keyExchangeMs != null && ms(r.keyExchangeMs)],
    ['Delivery latency, 50 messages one by one (sender stamp → receiver map callback)', r.latencySequential && lat(r.latencySequential)],
    ['Local put — seal + write, per message', r.putMs && lat(r.putMs)],
    ['Burst — 100 messages sent at once, until all 100 are on the other peer', r.burst100 && `${r.burst100.totalMs} ms total · ${r.burst100.perMessageMs} ms/msg · latency ${lat(r.burst100.latency)}`],
    ['HTTP requests made by either peer during 150 messages', r.httpRequestsDuringMessaging != null && String(r.httpRequestsDuringMessaging)],
    ['Bytes over the busiest WebRTC candidate pair (receiver side)', r.transport && `${r.transport.bytesReceived} received · ${r.transport.bytesSent} sent`],
    ['Relay killed after the introduction — messages still delivered', r.relayKilled && `${r.relayKilled.delivered}/${r.relayKilled.attempted} · latency ${lat(r.relayKilled.latency)}`],
    ['Catch-up after a partition — a returning device, 30 messages missed, from page load to convergence', r.catchUp && `${r.catchUp.fromLaunchMs} ms (the graph had converged before the phrase was even typed: ${r.catchUp.fromLoginMs} ms after sign-in)`],
    ['AES-GCM seal / open, 1 KB, per message', r.crypto && `${r.crypto.sealUs} µs / ${r.crypto.openUs} µs (n=${r.crypto.n})`],
  ].filter(([, v]) => v)
  const md = [
    '# dMessenger — performance report',
    '',
    `Measured ${new Date().toISOString()} on this machine, in real Chromium over real WebRTC, with a local signaling relay. Numbers are what the application does, DOM included — not a benchmark of the engine in isolation.`,
    '',
    '| What | Result |',
    '|---|---|',
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    '',
    'How to read it: the sender stamps `ts` before sealing; the receiver stamps arrival inside the same `db.map` callback the UI paints from. Both peers run on one machine, so the two clocks agree and the difference is the one-way path: seal, batch, WebRTC, verify, apply, notify.',
    '',
  ].join('\n')
  writeFileSync(`${dir}/report.md`, md)
  return md
}
