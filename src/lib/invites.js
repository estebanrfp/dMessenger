/**
 * Invites — a link (and its QR) that carries an address into this room.
 *
 * There is nothing to redeem and nothing a server hands out: the link is the
 * inviter's address plus the room, and opening it starts the conversation
 * from the invitee's side. The key still travels the only way it can — an
 * envelope granted by the conversation's owner once both have signed in.
 */
import { ROOM, RELAY_PARAM } from './db.js'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** The invite link for an address, keeping the room and the relay in use. */
export const inviteLink = (address) => {
  const url = new URL(location.origin + location.pathname)
  url.searchParams.set('room', ROOM)
  if (RELAY_PARAM) url.searchParams.set('relay', RELAY_PARAM)
  url.hash = `invite=${address}`
  return url.toString()
}

/** The address an invite link or a scanned code points at, or null. */
export const parseInvite = (text = location.hash) => {
  const raw = String(text ?? '')
  const match = raw.match(/invite=(0x[0-9a-fA-F]{40})/) ?? raw.match(/(0x[0-9a-fA-F]{40})/)
  const address = match?.[1]
  return address && ADDRESS.test(address) ? address : null
}

/** Removes a consumed invite from the URL without a reload. */
export const clearInviteHash = () => {
  if (!location.hash.includes('invite=')) return
  history.replaceState(null, '', location.pathname + location.search)
}
