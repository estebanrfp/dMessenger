/**
 * One-to-one conversations.
 *
 * A conversation is two nodes with different jobs: a public one, reactive under
 * `db.map`, saying who takes part and where the key record lives — metadata
 * every peer sees anyway — and the encrypted key record itself, which reaches
 * each member through an envelope and nobody else.
 *
 * The room replicates both to everyone. Only the members can open the second.
 */
import { db } from './db.js'
import { T } from './constitution.js'
import { session } from './identity.js'
import { pairId } from './crypto.js'
import { createKeyRecord, shareKey, addReconciler } from './keyring.js'

/**
 * A 1:1 has no admin: both sides may change its settings. The initiator owns
 * the node and grants the other `write` on it, so a policy change by either is
 * accepted by every peer — and one by anybody else is refused.
 */
const shareSettings = async (convId, other) => {
  try { await db.sm.acls.grant(convId, other, 'write'); return true } catch { return false }
}

const findByPair = async (pair) => {
  const { results } = await db.map({ query: { t: T.CONV, pair } })
  return results[0] ?? null
}

/**
 * Starts (or returns) the conversation with another address.
 * @param {string} other peer address
 * @returns {Promise<{id: string, granted: boolean}>}
 */
export const startConversation = async (other) => {
  const me = session.address
  if (!me) throw new Error('No active session')
  if (other.toLowerCase() === me.toLowerCase()) throw new Error('That is your own address')

  const pair = await pairId(me, other)
  const existing = await findByPair(pair)
  if (existing) return { id: existing.id, granted: true }

  const id = `${me}:conv:${pair}`
  const keyId = await createKeyRecord(id)
  // acls.set makes it an ACL node from birth: owner and collaborators are
  // engine-managed, and `grant` works on it by contract.
  await db.sm.acls.set({ t: T.CONV, pair, members: [me, other], keyId, createdAt: Date.now(), ttl: null }, id)

  const granted = await shareKey(keyId, other)
  await shareSettings(id, other)
  return { id, granted }
}

/** Retries the settings grant for a member that had no published key at creation. */
export const reconcileSettings = async (conv) => {
  const other = counterpart(conv)
  const permissions = await db.sm.acls.getPermissions(conv.id).catch(() => null)
  const has = Object.keys(permissions?.collaborators ?? {}).some(a => a.toLowerCase() === other.toLowerCase())
  return has || shareSettings(conv.id, other)
}

// Runs with the keyring's own tick, over the conversations this identity owns.
addReconciler(async (owned) => { for (const conv of owned) await reconcileSettings(conv).catch(() => {}) })

/**
 * One subscription for the conversation list. `$in` on an array field matches
 * on overlap, so both members see it without either writing to the other's node.
 */
export const watchConversations = (callback) =>
  db.map({ query: { t: T.CONV, members: { $in: [session.address] } }, field: 'createdAt', order: 'desc' }, callback)

/** The other participant of a conversation. */
export const counterpart = (conv) =>
  conv.value.members.find(m => m.toLowerCase() !== session.address?.toLowerCase()) ?? conv.value.members[0]
