/**
 * Ephemeral traffic — typing, presence, read receipts.
 *
 * One channel for the whole application, multiplexed by `kind`: many channels
 * degrade the engine's own sync channel. Nothing here persists and nothing here
 * authorizes — a channel message is transport. To say *who* is typing, the
 * payload is signed with `db.sm.sign` and dropped on arrival unless
 * `db.sm.verify` returns the same address the payload claims.
 */
import { db, live } from './db.js'
import { session } from './identity.js'

const handlers = new Map()
const pending = new Map()
let frame = null

/** Presence by relay announces, deduplicated; `peer:seen` re-fires as a heartbeat. */
export const presentPeers = new Set()

const dispatch = (kind, payload, from) => handlers.get(kind)?.forEach(fn => fn(payload, from))

live.on('message', (raw) => {
  if (!raw?.envelope) return
  let from = null
  try { from = db.sm.verify(raw.envelope, 30_000) } catch { return }
  if (!from) return                                    // unsigned, stale or forged: drop it
  const { kind, ...payload } = raw.envelope.value
  if (!kind) return
  dispatch(kind, payload, from)
})

db.room.on('peer:seen', (peerId) => { presentPeers.add(peerId); dispatch('presence', { online: true }, peerId) })
db.room.on('peer:lost', (peerId) => { presentPeers.delete(peerId); dispatch('presence', { online: false }, peerId) })

/**
 * Registers a handler for one ephemeral kind.
 * @param {'typing'|'receipt'|'presence'} kind
 * @param {(payload: object, from: string) => void} fn
 */
export const on = (kind, fn) => {
  if (!handlers.has(kind)) handlers.set(kind, new Set())
  handlers.get(kind).add(fn)
  return () => handlers.get(kind).delete(fn)
}

/**
 * Sends a signed ephemeral message, coalesced to one send per animation frame
 * per kind so a fast typist cannot flood the channel.
 */
export const emit = (kind, payload = {}) => {
  if (!session.isActive) return
  pending.set(kind, { kind, ...payload })
  frame ??= requestAnimationFrame(async () => {
    frame = null
    const batch = [...pending.values()]
    pending.clear()
    for (const value of batch) {
      const envelope = await db.sm.sign(value).catch(() => null)
      if (envelope) live.send({ envelope }).catch(() => {})   // best effort by design: never retry
    }
  })
}

/** Whether this device announces typing at all — a local preference, never shared. */
export const typingEnabled = () => { try { return localStorage.getItem('dmessenger-typing') !== 'off' } catch { return true } }

/** Announces typing in a conversation, unless this device keeps that to itself. */
export const typing = (conv) => { if (typingEnabled()) emit('typing', { conv }) }

/** Announces that messages in a conversation have been seen. */
export const seen = (conv, upTo) => emit('receipt', { conv, upTo })
