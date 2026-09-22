/**
 * Groups — the same private space as a conversation, with a roster and a
 * policy about who may change it.
 *
 * Three engine guarantees do all the work here, and the application adds no
 * enforcement of its own:
 *
 *   · **the ladder** — creating a group needs the `publish` permission, so a
 *     `user` cannot and a `manager` can. The tier is reached through governance,
 *     which makes the role ladder mean something an application actually does.
 *   · **ownership** — the roster node is owned by its creator. Admins are
 *     collaborators with `write`; every other peer refuses a roster written by
 *     anyone else. A collaborator writes content, never policy: spreading the
 *     value keeps `owner` and the envelope table intact, which is what makes
 *     their write acceptable everywhere.
 *   · **the envelope** — membership is a key, not a flag. Removing someone
 *     revokes their envelope and opens a new epoch, so what they read next is
 *     nothing.
 */
import { db } from './db.js'
import { T } from './constitution.js'
import { session } from './identity.js'
import { createKeyRecord, shareKey, rotate, keysFor } from './keyring.js'

/**
 * Creates a group. Rejects when the session's role does not carry `publish`.
 * @param {string} name
 * @param {string[]} members addresses to invite, besides the creator
 * @returns {Promise<{id: string}>}
 */
export const createGroup = async (name, members = []) => {
  const me = await db.sm.executeWithPermission('publish')   // rejects for user/guest
  const id = `${me}:group:${crypto.randomUUID()}`
  const keyId = await createKeyRecord(id)
  const roster = [me, ...members.filter(a => a.toLowerCase() !== me.toLowerCase())]

  await db.sm.acls.set({
    t: T.GROUP, name, members: roster, admins: [me], keyId, createdAt: Date.now(), ttl: null,
  }, id)

  for (const member of members) await shareKey(keyId, member)
  return { id }
}

/** True when an address may change this group's roster. */
export const isAdmin = (group, address = session.address) =>
  (group.value.admins ?? []).some(a => a.toLowerCase() === address?.toLowerCase())

/** True when an address is in the roster. */
export const isMember = (group, address = session.address) =>
  (group.value.members ?? []).some(a => a.toLowerCase() === address?.toLowerCase())

const writeRoster = (group, changes) =>
  // Spreading is what keeps owner, collaborators and the envelope table
  // untouched, so a non-owner admin's write is accepted by every peer.
  db.put({ ...group.value, ...changes }, group.id)

/**
 * Adds a member: the roster entry and the envelope that makes it mean anything.
 */
export const addMember = async (group, address) => {
  if (!isAdmin(group)) throw new Error('Only an admin can change the roster')
  if (isMember(group, address)) return false
  await writeRoster(group, { members: [...group.value.members, address] })
  return shareKey(group.value.keyId, address)
}

/**
 * Removes a member, in the only order that works: revoke the envelope first —
 * which rotates the record's own key — then open a new content epoch, then
 * write the roster. Everything sealed before stays readable for whoever stayed;
 * everything after is unreachable for whoever left.
 */
export const removeMember = async (group, address) => {
  if (!isAdmin(group)) throw new Error('Only an admin can change the roster')
  await db.sm.acls.revoke(group.value.keyId, address)
  const fresh = (await db.get(group.id)).result ?? group
  await rotate(fresh)
  await writeRoster(fresh, {
    members: fresh.value.members.filter(a => a.toLowerCase() !== address.toLowerCase()),
    admins: (fresh.value.admins ?? []).filter(a => a.toLowerCase() !== address.toLowerCase()),
  })
  return true
}

/**
 * Promotes a member to admin: a roster entry plus `write` on the node, so the
 * gate on every peer accepts their roster changes.
 */
export const promoteToAdmin = async (group, address) => {
  if (group.value.owner.toLowerCase() !== session.address?.toLowerCase()) {
    throw new Error('Only the group owner can appoint admins')
  }
  await db.sm.acls.grant(group.id, address, 'write')
  await writeRoster(group, { admins: [...(group.value.admins ?? []), address] })
  return true
}

/** One subscription for the group list. */
export const watchGroups = (callback) =>
  db.map({ query: { t: T.GROUP, members: { $in: [session.address] } }, field: 'createdAt', order: 'desc' }, callback)

/** Whether this session can currently read the group's content. */
export const canRead = async (group) => (await keysFor(group)).length > 0
