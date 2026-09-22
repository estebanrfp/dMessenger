/**
 * Message lifetime.
 *
 * Deletion cannot be the mechanism. A tombstone lives only in the operation
 * window, so a laggard that held the message before it was removed can bring
 * it back through its full state once the tombstone has rolled out. That is
 * the documented shape of the engine, not a defect to patch around.
 *
 * So expiry is a property of the receiver — the same place authorization lives
 * — and it is enforced at three points, none of which trusts the others:
 *
 *   1. render   — no honest peer paints an expired message;
 *   2. ingress  — `db.use` drops an expired message before it enters the graph,
 *                 which is what makes a resurrected node land nowhere;
 *   3. sweep    — the author removes its own expired nodes (only the owner can
 *                 sign that), and every peer forgets what it holds locally.
 *
 * What a modified client keeps is out of scope, as it is in every messenger:
 * the guarantee is about honest peers, and it holds without any of them
 * needing the others to cooperate.
 */
import { db } from './db.js'
import { T } from './constitution.js'
import { session } from './identity.js'

/** The lifetime ladder, in seconds. `null` is off. */
export const TTL_OPTIONS = [
  { label: '1 hour', value: 60 * 60 },
  { label: '8 hours', value: 8 * 60 * 60 },
  { label: '1 day', value: 24 * 60 * 60 },
  { label: '1 week', value: 7 * 24 * 60 * 60 },
  { label: '30 days', value: 30 * 24 * 60 * 60 },
]

/** Ingress tolerance for a receiver whose clock runs slightly ahead. */
const CLOCK_SLACK_MS = 60_000

/** Human label for a TTL in seconds. */
export const ttlLabel = (seconds) => {
  const known = TTL_OPTIONS.find(o => o.value === seconds)
  if (known) return known.label
  if (!seconds) return 'Off'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h`
  return `${Math.round(seconds / 86_400)} d`
}

/** Normalises a TTL: a positive finite number of seconds, or null for off. */
export const normalizeTtl = (seconds) =>
  typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : null

/** The instant a message stops existing for honest peers, or null. */
export const expiresAt = (message) =>
  typeof message?.value?.expiresAt === 'number' ? message.value.expiresAt : null

/** Whether a message is past its expiry, with optional tolerance. */
export const isExpired = (message, now = Date.now(), slackMs = 0) => {
  const at = expiresAt(message)
  return at !== null && at < now - slackMs
}

/**
 * Sets the disappearing-messages policy of a space. Spreading keeps `owner`,
 * `collaborators` and the envelope table intact, so a `write` collaborator's
 * change is accepted by every peer — and a non-collaborator's is refused.
 */
export const setSpaceTtl = async (space, seconds) => {
  const { result } = await db.get(space.id)
  const value = result?.value ?? space.value
  await db.put({ ...value, ttl: normalizeTtl(seconds) }, space.id)
}

/**
 * Point 2 — ingress. An expired message never enters this peer's graph, on
 * any path: live, delta or a laggard's full state. Filtering only; the
 * authorship gate still runs on everything that passes.
 */
export const installExpiryGuard = () => {
  db.use(async (operations) => {
    const now = Date.now()
    // A reaction inherits its message's expiry, so it is guarded the same way.
    const dead = (value) => (value?.t === T.MSG || value?.t === T.REACT) && typeof value.expiresAt === 'number' && value.expiresAt < now - CLOCK_SLACK_MS
    return operations.flatMap((op) => {
      if (op?.type === 'upsert') return dead(op.value) ? [] : [op]
      // A laggard's full state is one operation carrying every node it holds.
      // This is the path a removed message comes back through once its
      // tombstone has rolled out of the window — so it is filtered here too.
      if (op?.type === 'fullStateSync' && op.graphData) {
        const graphData = Object.fromEntries(Object.entries(op.graphData).filter(([, node]) => !dead(node?.value)))
        return [{ ...op, graphData }]
      }
      return [op]
    })
  })
}

const listeners = new Set()

/** Subscribes to messages expiring on this peer; the UI drops them from the DOM. */
export const onExpire = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

/**
 * Point 3 — sweep. Every second: expired messages leave the screen, the
 * author removes its own from the graph (the only remove every peer will sign
 * off on), and a foreign one is dropped from the local copy — that write is
 * refused everywhere else, which is exactly right: forgetting is local.
 */
export const startSweeper = (everyMs = 1000) => {
  const tick = async () => {
    const now = Date.now()
    const { results } = await db.map({ query: { t: { $in: [T.MSG, T.REACT] }, expiresAt: { $lt: now } } })
    for (const node of results) {
      if (node.value.t === T.MSG) listeners.forEach(fn => fn(node.id, node.value.conv))
      try { await db.remove(node.id) } catch { /* not ours: forgotten locally at most */ }
    }
  }
  const timer = setInterval(tick, everyMs)
  tick()
  return () => clearInterval(timer)
}

/** Milliseconds of life left, floored at zero. */
export const remaining = (message, now = Date.now()) => Math.max(0, (expiresAt(message) ?? now) - now)

/** Compact countdown: 4d · 3h · 12m · 45s. */
export const countdown = (ms) => {
  const s = Math.ceil(ms / 1000)
  if (s >= 86_400) return `${Math.floor(s / 86_400)}d`
  if (s >= 3600) return `${Math.floor(s / 3600)}h`
  if (s >= 60) return `${Math.floor(s / 60)}m`
  return `${s}s`
}

/** Whether this session may change the policy of a space. */
export const canSetTtl = async (space) => {
  const me = session.address?.toLowerCase()
  if (!me) return false
  if (space.value.owner?.toLowerCase() === me) return true
  const permissions = await db.sm.acls.getPermissions(space.id).catch(() => null)
  const level = permissions?.collaborators?.[session.address] ?? permissions?.collaborators?.[me]
  return level === 'write' || level === 'delete'
}
