/**
 * One database for the whole application.
 *
 * Every aspect — conversations, messages, profiles, keys — lives in this single
 * graph and is separated by what it *is* (`value.t`), who owns it
 * (`value.owner`, enforced by the gate on every peer) and who can read it (an
 * envelope, never a topology). No second instance is ever created: a second
 * `gdb()` in the same page re-initialises the Security Manager and drops the
 * active signer, which is measurable as an address that turns null mid-session.
 */
import { gdb } from 'https://cdn.jsdelivr.net/npm/genosdb@0.36.3/dist/index.min.js'
import { SUPERADMINS, ROLES, GOVERNANCE } from './constitution.js'

const params = new URLSearchParams(location.search)

/** The room is the sharing scope: everyone opening this name replicates the graph. */
export const ROOM = params.get('room') ?? 'dmessenger'

const relay = params.get('relay')

/** The signaling relay this page was told to use, if any (kept in invite links). */
export const RELAY_PARAM = relay

/** The engine version pinned on the CDN import above. */
export const ENGINE_VERSION = '0.36.3'

/** @type {Awaited<ReturnType<typeof gdb>>} */
/** Test hook: a smaller operation window makes a tombstone roll out sooner. */
const oplogSize = Number(params.get('oplog')) || undefined

export const db = await gdb(ROOM, {
  rtc: relay ? { relayUrls: [relay] } : true,
  sm: { superAdmins: SUPERADMINS, acls: true, customRoles: ROLES, governanceRules: GOVERNANCE },
  debug: params.has('debug'),
  ...(oplogSize && { oplogSize }),
})

/** The single ephemeral channel: presence, typing and receipts multiplex here. */
export const live = db.room.channel('live')

/**
 * Test surface — the running application's own module instance, exposed on
 * purpose. The suite reads this and never re-imports a module from the console:
 * a dynamic import can resolve to a different instance and report state the app
 * does not have.
 */
window.app = {
  room: ROOM,
  peerCount: () => Object.keys(db.room.getPeers()).length,
  address: () => db.sm.getActiveEthAddress(),
  role: async () => (await db.get(`user:${db.sm.getActiveEthAddress()}`)).result?.value?.role ?? 'guest',
  nodes: async (query) => (await db.map({ query })).results.map(({ id, value }) => ({ id, value })),
  /** Writes an arbitrary node through this session, so a spec can attempt a forgery and watch the gate refuse it. */
  rawPut: (value, id) => db.put(value, id).then(
    (result) => ({ ok: true, id: result }),
    (error) => ({ ok: false, error: String(error?.message ?? error) }),
  ),
  /** Whether this session holds an envelope for an encrypted record. */
  canOpen: async (id) => {
    const got = await db.sm.get(id).catch(() => null)
    const value = got?.result?.value
    return typeof value === 'object' && value !== null
  },
}
