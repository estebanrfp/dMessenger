/**
 * The constitution — local configuration every peer and the Fallback Server
 * must ship identically. It is never derived from the graph, a channel message
 * or a URL: a peer that reads its rules from the network has no rules.
 */

/**
 * The superadmins, from build-time configuration (`VITE_SUPERADMINS` in
 * `.env.local`, comma-separated; `pnpm mint` writes one for a fresh clone).
 * Compiled into the bundle, so every peer built from it agrees — and never
 * read from a URL, a channel or the graph. An empty list means nobody can ever
 * be promoted, which is the safe failure.
 */
export const SUPERADMINS = (import.meta.env.VITE_SUPERADMINS ?? '')
  .split(',').map(a => a.trim()).filter(a => /^0x[0-9a-fA-F]{40}$/.test(a))

/**
 * Open platform: the base role writes, links and deletes, so a brand-new
 * identity can speak — and take back what it said — before any promotion
 * arrives. Deleting at the floor is safe because ownership already scopes it:
 * every node carries an `owner` the gate enforces on every peer, so the
 * residual risk is spam, never takeover, and nobody removes what is not theirs.
 * Moderation of unowned nodes (`deleteAny`) starts at `admin`.
 */
export const ROLES = {
  superadmin: { can: ['assignRole'], inherits: ['admin'] },
  admin: { can: ['deleteAny'], inherits: ['manager'] },
  manager: { can: ['publish'], inherits: ['user'] },
  user: { can: [], inherits: ['guest'] },
  guest: { can: ['read', 'sync', 'write', 'link', 'delete'] },
}

/**
 * Governance — evaluated every 4s, last match wins, superadmins immune.
 * Runs while a superadmin is signed in, or 24/7 on the Fallback Server.
 *
 * Rule 1 keys on time, the one metric a modified client cannot forge: the
 * engine measures how long *it* has observed the node unchanged, never a
 * timestamp the peer signed for itself.
 *
 * Rule 3 keys on `vouches`, which lives on `user:<address>` — a node its own
 * subject may rewrite. That makes it self-service by design (SECURITY.md), so
 * the tier it grants is deliberately weak: `manager` may publish, never delete.
 */
export const GOVERNANCE = [
  { if: { role: 'guest' }, offsetTimestamp: 8000, then: { assignRole: 'user' } },
  { if: { role: { $in: ['user', 'manager'] } }, then: { assignRole: 'user' } },
  { if: { role: { $in: ['user', 'manager'] }, vouches: { $gte: 2 } }, then: { assignRole: 'manager' } },
]

/** Node kinds. The discriminator that separates every aspect inside one graph. */
export const T = {
  PROFILE: 'profile',
  CONV: 'conv',
  GROUP: 'group',
  MSG: 'msg',
  KEY: 'convkey',
  REACT: 'react',
  VOUCH: 'vouch',
}

/** Role order, for badges and gating. */
export const RANK = { guest: 0, user: 1, manager: 2, admin: 3, superadmin: 4 }
