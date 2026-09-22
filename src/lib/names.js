/**
 * Display names.
 *
 * A name lives on `user:<address>` — the node the Security Manager maintains
 * and governance reads — and only its owner (or a superadmin) may write it. So
 * a name is a claim nobody can make on your behalf: every peer refuses the
 * write, and a forged one lands in the forger's own copy alone.
 *
 * One subscription for the page resolves every identity the peer holds.
 */
import { db } from './db.js'

const names = new Map()
const listeners = new Set()
let started = false

/** Starts the resolver once; safe to call again. */
export const startNames = async () => {
  if (started) return
  started = true
  await db.map({ query: { id: /^user:/ } }, (event) => {
    const address = event.id.slice('user:'.length).toLowerCase()
    const name = event.action === 'removed' ? null : (event.value?.displayName?.trim() || null)
    if ((names.get(address) ?? null) === name) return
    if (name) names.set(address, name); else names.delete(address)
    listeners.forEach(fn => fn(address, name))
  })
}

/** The display name an address published, or null. */
export const nameOf = (address) => names.get(address?.toLowerCase()) ?? null

const short = (address) => address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''

/** What to print for an address: its name when it has one, else its short form. */
export const label = (address) => nameOf(address) ?? short(address)

/** Subscribes to name changes: `(address, name|null)`. */
export const onName = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
