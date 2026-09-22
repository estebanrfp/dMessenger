/**
 * The keyring — one mechanism for every private space, 1:1 or group.
 *
 * A space (a conversation or a group) keeps its content keys in a single
 * encrypted record, and each member reaches it through an envelope. The record
 * holds an **array** of keys, one per epoch, because removing a member has to
 * do two different things at once:
 *
 *   · stop them reading what comes next — a new epoch key they never receive;
 *   · not destroy what came before — older messages stay sealed under older
 *     keys the remaining members still hold.
 *
 * So a message carries the epoch it was sealed under. Removal is forward-only
 * by construction: what a member could read while authorized, they may have
 * copied, and no rotation can take that back.
 */
import { db } from './db.js'
import { T } from './constitution.js'
import { session } from './identity.js'
import { mintConversationKey } from './crypto.js'

/** Extra convergence passes other modules register; run with every tick. */
const reconcilers = new Set()

/** Registers a pass that runs alongside the envelope reconciliation. */
export const addReconciler = (fn) => { reconcilers.add(fn); return () => reconcilers.delete(fn) }

/** spaceId -> string[] of epoch keys readable by this session. */
const cache = new Map()
const listeners = new Set()

/** Subscribes to keys arriving late: an envelope has to travel before it opens. */
export const onKey = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

const announce = (spaceId, keys) => listeners.forEach(fn => fn(spaceId, keys))

/** Creates the sealed key record for a new space. */
export const createKeyRecord = async (spaceId) => {
  const key = mintConversationKey()
  const keyId = await db.sm.put({ t: T.KEY, space: spaceId, keys: [key] })
  cache.set(spaceId, [key])
  return keyId
}

/**
 * Adds a reader envelope. Throws-free: it fails while that identity has never
 * signed in anywhere, because `grant` needs a published key to wrap for.
 * @returns {Promise<boolean>}
 */
export const shareKey = async (keyId, address) => {
  try {
    await db.sm.acls.grant(keyId, address, 'read')
    return true
  } catch {
    return false
  }
}

/** The addresses that currently hold an envelope for a key record. */
export const readersOf = async (keyId) => {
  const permissions = await db.sm.acls.getPermissions(keyId)
  const collaborators = permissions?.collaborators ?? {}   // a map of address -> level
  const list = Array.isArray(collaborators) ? collaborators.map(c => c.address ?? c) : Object.keys(collaborators)
  return list.map(address => address.toLowerCase())
}

/**
 * Resolves every epoch key this session can read for a space.
 * @returns {Promise<string[]>} empty when this peer holds no envelope
 */
export const keysFor = async (space) => {
  const cached = cache.get(space.id)
  if (cached) return cached
  const { result } = await db.sm.get(space.value.keyId).catch(() => ({ result: null }))
  const value = result?.value
  const keys = Array.isArray(value?.keys) ? value.keys : []
  if (keys.length) cache.set(space.id, keys)
  return keys
}

/** Keys already known for a space, without touching the graph. */
export const cachedKeys = (spaceId) => cache.get(spaceId) ?? []

/** The key a new message must be sealed under, and its epoch. */
export const currentEpoch = (spaceId) => {
  const keys = cache.get(spaceId) ?? []
  return { epoch: keys.length - 1, key: keys.at(-1) ?? null }
}

/**
 * Opens a new epoch: a fresh key appended to the record, readable only by the
 * addresses that still hold an envelope. Called after removing a member, whose
 * envelope was revoked first — `revoke` also rotates the record's own key, so
 * the removed member cannot even reach the array any more.
 */
export const rotate = async (space) => {
  const keys = await keysFor(space)
  const next = [...keys, mintConversationKey()]
  await db.sm.put({ t: T.KEY, space: space.id, keys: next }, space.value.keyId)
  cache.set(space.id, next)
  announce(space.id, next)
  return next.length - 1
}

/** Every space this identity takes part in, of either kind. */
const mySpaces = async () => {
  const [conversations, groups] = await Promise.all([
    db.map({ query: { t: T.CONV, members: { $in: [session.address] } } }),
    db.map({ query: { t: T.GROUP, members: { $in: [session.address] } } }),
  ])
  return [...conversations.results, ...groups.results]
}

/** Grants the envelopes still missing on spaces this identity owns. */
export const reconcileAccess = async () => {
  const [conversations, groups] = await Promise.all([
    db.map({ query: { t: T.CONV, owner: session.address } }),
    db.map({ query: { t: T.GROUP, owner: session.address } }),
  ])
  for (const fn of reconcilers) await fn(conversations.results).catch(() => {})
  for (const space of [...conversations.results, ...groups.results]) {
    const readers = await readersOf(space.value.keyId)
    for (const member of space.value.members) {
      if (member.toLowerCase() === session.address.toLowerCase()) continue
      if (readers.includes(member.toLowerCase())) continue
      await shareKey(space.value.keyId, member)
    }
  }
}

/**
 * Keeps access converging in both directions: granting what this peer owes as
 * an owner, and retrying what it cannot open yet as a member. Runs on a timer
 * and on `peer:join` — a peer arriving is exactly when an identity that had
 * never signed in has just published its key.
 */
export const startKeyring = (everyMs = 4000) => {
  const tick = async () => {
    await reconcileAccess().catch(error => console.warn('[keyring] grant pass failed:', error?.message ?? error))
    for (const space of await mySpaces()) {
      const before = cache.get(space.id)?.length ?? 0
      cache.delete(space.id)                       // epochs grow: always re-read
      const keys = await keysFor(space)
      if (keys.length > before) announce(space.id, keys)
      else if (!keys.length && before) cache.delete(space.id)
    }
  }
  db.room.on('peer:join', () => { tick() })
  const timer = setInterval(tick, everyMs)
  tick()
  return () => clearInterval(timer)
}
