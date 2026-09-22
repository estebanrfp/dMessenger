/**
 * Vouches — a worked example of the one honest limitation of rule-based
 * governance, shown rather than hidden.
 *
 * A rule reads `user:<address>`, a node its own subject may rewrite. So the
 * counter a rule trusts is self-declared. The *evidence* is not: each vouch is
 * its own node, owned by whoever signed it, and every peer can count them. The
 * governance panel shows both numbers side by side, so a peer that inflates its
 * own counter is visible to everyone rather than merely promoted.
 */
import { db } from './db.js'
import { T } from './constitution.js'
import { session } from './identity.js'

/** Signs a vouch for another address. One per pair, replacing any earlier one. */
export const vouch = (subject) =>
  db.put({ t: T.VOUCH, owner: session.address, subject, at: Date.now() }, `${session.address}:vouch:${subject}`)

/** Counts the vouches that actually exist for an address. */
export const countVouches = async (subject) => {
  const { results } = await db.map({ query: { t: T.VOUCH, subject } })
  return results.length
}

/**
 * Publishes the caller's own vouch count onto `user:<address>`, where the
 * governance rule can read it. Only the subject or a superadmin may write it.
 */
export const publishOwnVouchCount = async () => {
  const id = `user:${session.address}`
  const vouches = await countVouches(session.address)
  const { result } = await db.get(id)
  if ((result?.value?.vouches ?? 0) === vouches) return vouches
  await db.put({ ...(result?.value ?? {}), vouches }, id)
  return vouches
}

/** Subscribes to every identity node, which is where roles become visible. */
export const watchIdentities = (callback) =>
  db.map({ query: { id: /^user:/ } }, callback)
