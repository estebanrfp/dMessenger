/**
 * Identity — the door, and the live role.
 *
 * Every session branch is derived from `setSecurityStateChangeCallback`, which
 * fires immediately and on every change, so each branch is idempotent and no
 * local flag can drift out of step with the Security Manager.
 */
import { db } from './db.js'
import { RANK } from './constitution.js'

/** Passkeys need a secure context *and* a domain: an IP fails at registration. */
export const PASSKEYS_AVAILABLE =
  window.isSecureContext &&
  !!window.PublicKeyCredential &&
  !/^\d{1,3}(\.\d{1,3}){3}$/.test(location.hostname)

const listeners = new Set()

/** @type {{isActive: boolean, address: string|null, abbr: string|null, protectedByWebAuthn: boolean, hasVolatileIdentity: boolean, hasHardware: boolean, role: string}} */
export let session = {
  isActive: false, address: null, abbr: null,
  protectedByWebAuthn: false, hasVolatileIdentity: false, hasHardware: false,
  role: 'guest',
}

let roleUnsubscribe = null

const emit = () => listeners.forEach(fn => fn(session))

/** Subscribes to session changes. Fires once immediately with the current state. */
export const onSession = (fn) => { listeners.add(fn); fn(session); return () => listeners.delete(fn) }

/** Watches `user:<address>` so the badge shows the role every peer agrees on. */
const watchRole = async (address) => {
  roleUnsubscribe?.()
  roleUnsubscribe = null
  if (!address) { session.role = 'guest'; return }
  const { unsubscribe } = await db.get(`user:${address}`, (node) => {
    const next = node?.value?.role ?? 'guest'
    if (next === session.role) return
    session.role = next
    emit()
  })
  roleUnsubscribe = unsubscribe
}

db.sm.setSecurityStateChangeCallback((state) => {
  const changedAddress = state.activeAddress !== session.address
  session = {
    ...session,
    isActive: state.isActive,
    address: state.activeAddress ?? null,
    abbr: state.abbrAddr ?? null,
    protectedByWebAuthn: !!state.isWebAuthnProtected,
    hasVolatileIdentity: !!state.hasVolatileIdentity,
    hasHardware: !!state.hasWebAuthnHardwareRegistration,
    role: state.activeAddress ? session.role : 'guest',
  }
  emit()
  if (changedAddress) watchRole(state.activeAddress ?? null)
})

/** True when the session may perform an action of at least this tier. */
export const atLeast = (role) => RANK[session.role] >= RANK[role]

/**
 * Creates a volatile identity. The mnemonic is shown once and is the only way
 * back in until a passkey protects it.
 * @returns {Promise<{address: string, mnemonic: string}>}
 */
export const register = async () => {
  const identity = await db.sm.startNewUserRegistration()
  if (!identity) throw new Error('Could not generate an identity')
  return { address: identity.address, mnemonic: identity.mnemonic }
}

/** Opens a session from a mnemonic. It lives in memory and dies on reload. */
export const loginWithMnemonic = (mnemonic) => db.sm.loginOrRecoverUserWithMnemonic(mnemonic.trim())

/**
 * Protects the current identity with a passkey. Returns null when the
 * authenticator has no PRF extension — nothing is stored and the session stays
 * a mnemonic session, which the UI must say rather than imply otherwise.
 */
export const protectWithPasskey = () => db.sm.protectCurrentIdentityWithWebAuthn()

/** Resumes a passkey session. Must be triggered by the user, never on load. */
export const loginWithPasskey = () => db.sm.loginCurrentUserWithWebAuthn()

export const hasPasskey = () => db.sm.hasExistingWebAuthnRegistration()

export const logout = () => db.sm.clearSecurity()

export const abbr = (address) => db.sm.abbrAddr(address)

/**
 * Writes the display name onto `user:<address>` — the same node governance
 * reads. Spreading the current value keeps `role` and `expiresAt` intact; a
 * write that dropped them would be refused by every peer anyway.
 */
export const setDisplayName = async (displayName) => {
  const id = `user:${session.address}`
  const { result } = await db.get(id)
  await db.put({ ...(result?.value ?? {}), displayName }, id)
}
