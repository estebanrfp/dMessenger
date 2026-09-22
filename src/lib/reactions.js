/**
 * Reactions — one node per (reactor, message).
 *
 * The id is deterministic, `${reactor}:react:${messageId}`, which does three
 * jobs at once: reacting again replaces the earlier reaction, removing it is a
 * `remove` only its owner can sign, and — because the id carries the owner
 * prefix the gate enforces — nobody can react in somebody else's name. A peer
 * that tries writes into its own copy and every other peer refuses it.
 *
 * The emoji is sealed under the space key at the current epoch: an outsider
 * sees that a reaction exists, never which one. It inherits the message's
 * expiry, so it disappears with it on every honest peer.
 */
import { db } from './db.js'
import { T } from './constitution.js'
import { session } from './identity.js'
import { sealBody, openBody } from './crypto.js'
import { currentEpoch } from './keyring.js'

export const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥']

/** This session's reaction id for a message. */
export const reactionId = (messageId) => `${session.address}:react:${messageId}`

/**
 * Reacts to a message, replacing any earlier reaction by this session.
 * @param {string} spaceId
 * @param {object} message the message node
 * @param {string} emoji
 */
export const react = async (spaceId, message, emoji) => {
  const { epoch, key } = currentEpoch(spaceId)
  if (!key) throw new Error('No key for this space yet')
  return db.put({
    t: T.REACT,
    owner: session.address,
    conv: spaceId,
    msg: message.id,
    epoch,
    emoji: await sealBody(key, emoji),
    ts: Date.now(),
    ...(typeof message.value.expiresAt === 'number' && { expiresAt: message.value.expiresAt }),
  }, reactionId(message.id))
}

/** Removes this session's reaction to a message. */
export const unreact = (messageId) => db.remove(reactionId(messageId))

/** One subscription for every reaction in a space; the thread groups them by message. */
export const watchReactions = (spaceId, callback) =>
  db.map({ query: { t: T.REACT, conv: spaceId } }, callback)

/**
 * Opens a sealed emoji with the epoch key it was sealed under.
 * @returns {Promise<string|null>} null when this peer cannot read it
 */
export const readEmoji = (keys, reaction) => {
  const key = keys?.[reaction.value.epoch ?? 0]
  return key ? openBody(key, reaction.value.emoji) : Promise.resolve(null)
}
