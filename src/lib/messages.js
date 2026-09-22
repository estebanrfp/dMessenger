/**
 * Messages — one node per message, which is what makes concurrency a non-issue:
 * two peers writing at the same instant write different nodes, so there is
 * nothing to merge and nothing to lose.
 *
 * The node is public and reactive, so `db.map` can sort, window and stream it;
 * only `body` is ciphertext. It carries the **epoch** it was sealed under, so a
 * space that has rotated its key after removing a member still reads its whole
 * history for whoever stayed.
 */
import { db } from './db.js'
import { T } from './constitution.js'
import { session } from './identity.js'
import { sealBody, openBody, bytesToBase64, base64ToBytes } from './crypto.js'
import { currentEpoch } from './keyring.js'

/**
 * The honest limit of "the graph is the store": the room replicates every
 * byte of a node to every peer, so an attachment is capped rather than
 * streamed. Anything larger belongs on an ephemeral channel, not in the graph.
 */
export const MAX_FILE_BYTES = 512 * 1024

/**
 * A strictly increasing stamp per session. Two sends inside one millisecond
 * would otherwise tie on `ts` and be ordered by node id — random — so a burst
 * could paint out of the order it was written. The clock still wins the moment
 * it moves past the counter.
 */
let lastStamp = 0
const stamp = () => { lastStamp = Math.max(Date.now(), lastStamp + 1); return lastStamp }

/**
 * Sends a message to a space (a conversation or a group).
 *
 * The expiry is stamped on the message itself, from the space's policy at the
 * moment of sending: every honest receiver honours that stamp, so the author's
 * peer needs nobody else's cooperation for it to mean something.
 * @param {string} spaceId
 * @param {string} text plaintext, never stored
 * @param {{ttl?: number|null, replyTo?: string}} [options] ttl in seconds
 */
export const send = async (spaceId, text, { ttl = null, replyTo } = {}) => {
  const { epoch, key } = currentEpoch(spaceId)
  if (!key) throw new Error('No key for this space yet')
  const body = await sealBody(key, text)
  const ts = stamp()
  return db.put({
    t: T.MSG,
    owner: session.address,
    conv: spaceId,
    ts,
    epoch,
    body,
    ...(ttl && { expiresAt: ts + ttl * 1000 }),
    ...(replyTo && { replyTo }),
  })
}

/**
 * Sends a file (or a voice note) as a message whose body is the sealed bytes.
 * The name, type and size stay public metadata, like a text message's length.
 * @param {string} spaceId
 * @param {File} file
 * @param {{ttl?: number|null, replyTo?: string}} [options]
 */
export const sendFile = async (spaceId, file, { ttl = null, replyTo } = {}) => {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`Files are capped at ${MAX_FILE_BYTES / 1024} KB: the room replicates every byte to every peer`)
  }
  const { epoch, key } = currentEpoch(spaceId)
  if (!key) throw new Error('No key for this space yet')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const body = await sealBody(key, bytesToBase64(bytes))
  const ts = stamp()
  return db.put({
    t: T.MSG,
    owner: session.address,
    conv: spaceId,
    ts,
    epoch,
    kind: 'file',
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    body,
    ...(ttl && { expiresAt: ts + ttl * 1000 }),
    ...(replyTo && { replyTo }),
  })
}

/**
 * Opens a file message into a Blob.
 * @returns {Promise<Blob|null>} null when this peer cannot read it
 */
export const readFile = async (keys, message) => {
  const base64 = await readBody(keys, message)
  return base64 === null ? null : new Blob([base64ToBytes(base64)], { type: message.value.mime })
}

/**
 * Subscribes to one thread, oldest first. The caller unsubscribes when the view
 * is torn down, which keeps a closed space from repainting a dead panel.
 */
export const watchThread = (spaceId, callback) =>
  db.map({ query: { t: T.MSG, conv: spaceId }, field: 'ts', order: 'asc' }, callback)

/** Subscribes to every message, newest first — the sidebar's preview column. */
export const watchAllMessages = (callback) =>
  db.map({ query: { t: T.MSG }, field: 'ts', order: 'desc' }, callback)

/**
 * Decrypts a message with the epoch key it was sealed under.
 * @param {string[]} keys every epoch key this session holds for the space
 * @returns {Promise<string|null>} null when this peer cannot read it
 */
export const readBody = (keys, message) => {
  const key = keys?.[message.value.epoch ?? 0]
  return key ? openBody(key, message.value.body) : Promise.resolve(null)
}

/** Removes a message. Every peer refuses this for anyone but its owner. */
export const remove = (id) => db.remove(id)
