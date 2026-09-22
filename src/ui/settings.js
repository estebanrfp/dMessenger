/**
 * Settings — what is this device's and what is the room's, kept apart.
 *
 * Appearance and typing announcements are local preferences; the passkey is
 * this device's protection of the identity; the room, its constitution and the
 * engine version are shared facts every peer must agree on, shown read-only.
 */
import { el, clear, say, shortAddress } from './dom.js'
import { avatar } from './avatar.js'
import { session, onSession, PASSKEYS_AVAILABLE, protectWithPasskey, logout } from '../lib/identity.js'
import { db, ROOM, RELAY_PARAM, ENGINE_VERSION } from '../lib/db.js'
import { SUPERADMINS } from '../lib/constitution.js'
import { typingEnabled } from '../lib/live.js'
import { toast, confirmDialog } from './toast.js'

const section = (title) => {
  const node = el('div', 'bg-card rounded-lg p-4')
  node.append(el('h2', 'font-medium mb-3', { textContent: title }))
  return node
}

const row = (label, control, hint) => {
  const node = el('div', 'flex items-center justify-between gap-3 py-2')
  const text = el('div', 'min-w-0')
  text.append(el('p', 'text-sm', { textContent: label }))
  if (hint) text.append(el('p', 'text-xs text-dim', { textContent: hint }))
  node.append(text, control)
  return node
}

const applyTheme = (preference) => {
  const systemLight = window.matchMedia('(prefers-color-scheme: light)').matches
  const resolved = preference === 'system' ? (systemLight ? 'light' : 'dark') : preference
  document.documentElement.dataset.themePreference = preference
  document.documentElement.dataset.theme = resolved
  try { preference === 'system' ? localStorage.removeItem('dmessenger-theme') : localStorage.setItem('dmessenger-theme', preference) } catch {}
}

let stopSession = null
let peersTimer = null

/**
 * @param {HTMLElement} root
 * @param {{onBack: () => void, onProfile: () => void}} handlers
 */
export const renderSettings = (root, handlers) => {
  stopSession?.()
  clearInterval(peersTimer)
  clear(root)
  root.className = 'flex-1 flex flex-col min-h-0 bg-page'

  const header = el('header', 'h-14 px-4 flex items-center gap-3 border-b border-line flex-shrink-0 bg-card')
  const back = el('button', 'btn-ghost p-2', { title: 'Back', onclick: handlers.onBack })
  back.append(el('span', 'i-carbon-arrow-left text-xl'))
  header.append(back, el('h1', 'text-xl font-semibold', { textContent: 'Settings' }))

  const scroll = el('div', 'flex-1 overflow-y-auto overscroll-contain p-4')
  const column = el('div', 'max-w-lg mx-auto space-y-4')

  // ── identity ──
  const identity = el('button', 'w-full bg-card rounded-lg p-4 flex items-center gap-3 text-left hover:bg-field transition-colors', {
    dataset: { testid: 'settings-identity' }, onclick: handlers.onProfile,
  })
  const who = el('div', 'flex-1 min-w-0')
  const whoAddress = el('p', 'font-medium text-lg truncate mono')
  const whoStatus = el('p', 'text-xs text-dim')
  who.append(whoAddress, whoStatus)
  identity.append(avatar(session.address, 48), who, el('span', 'i-carbon-chevron-right text-dim'))

  // ── appearance ──
  const appearance = section('Appearance')
  const themeSelect = el('select', 'bg-field text-sm rounded-md px-2 py-1 border border-line', { dataset: { testid: 'theme-select' } })
  for (const value of ['system', 'light', 'dark']) themeSelect.append(el('option', '', { value, textContent: value[0].toUpperCase() + value.slice(1) }))
  themeSelect.value = document.documentElement.dataset.themePreference ?? 'system'
  themeSelect.addEventListener('change', () => applyTheme(themeSelect.value))
  appearance.append(row('Theme', themeSelect, 'A preference of this device'))

  // ── privacy ──
  const privacy = section('Privacy')
  const typingToggle = el('input', 'w-5 h-5 accent-accent', { type: 'checkbox', checked: typingEnabled(), dataset: { testid: 'typing-toggle' } })
  typingToggle.addEventListener('change', () => { try { localStorage.setItem('dmessenger-typing', typingToggle.checked ? 'on' : 'off') } catch {} })
  privacy.append(row('Announce when I am typing', typingToggle, 'Signed, ephemeral, and only sent while this is on'))

  const shield = el('button', 'btn-secondary text-sm', { dataset: { testid: 'settings-passkey' } })
  shield.addEventListener('click', async () => {
    const address = await protectWithPasskey().catch(() => null)
    toast(address ? 'Identity protected: this session survives a reload' : 'This authenticator has no PRF extension, so nothing was stored', address ? 'ok' : 'error')
  })
  const shieldRow = row('Passkey', shield, PASSKEYS_AVAILABLE ? 'Wraps your key under a secret only the authenticator yields' : 'Needs a secure context and a real domain')
  privacy.append(shieldRow)

  // ── network ──
  const network = section('Network')
  const peers = el('span', 'text-sm mono', { dataset: { testid: 'peer-count' } })
  network.append(
    row('Signaling', el('span', 'text-sm mono truncate max-w-[12rem]', { textContent: RELAY_PARAM ?? 'public relay list' }), 'Relays only introduce peers; data travels over WebRTC'),
    row('Connected peers', peers),
  )
  const paintPeers = () => say(peers, String(Object.keys(db.room.getPeers()).length))
  paintPeers()
  peersTimer = setInterval(paintPeers, 2000)

  // ── about ──
  const about = section('About dMessenger')
  about.append(
    row('Room', el('span', 'text-sm mono truncate max-w-[12rem]', { textContent: ROOM }), 'Everyone opening this name replicates the graph'),
    row('Constitution', el('span', 'text-sm mono', { textContent: SUPERADMINS.map(shortAddress).join(', ') }), 'Identical on every peer'),
    row('Engine', el('span', 'text-sm mono', { textContent: `genosdb ${ENGINE_VERSION}` }), 'Pinned on the CDN'),
  )

  // ── logout ──
  const danger = el('div', 'pt-2')
  const out = el('button', 'btn-danger w-full flex items-center justify-center gap-2', {
    dataset: { testid: 'logout' },
    onclick: async () => {
      const ok = await confirmDialog('Log out?', session.protectedByWebAuthn
        ? 'Your passkey keeps the identity on this device; you can sign back in with it.'
        : 'This is a mnemonic session: without the phrase there is no way back into this identity.', 'Log out')
      if (ok) logout()
    },
  })
  out.append(el('span', 'i-carbon-logout'), document.createTextNode('Log out'))
  danger.append(out)

  column.append(identity, appearance, privacy, network, about, danger)
  scroll.append(column)
  root.append(header, scroll)

  stopSession = onSession((state) => {
    say(whoAddress, state.address ?? '—')
    say(whoStatus, `${state.role} · ${state.protectedByWebAuthn ? 'passkey session' : 'mnemonic session — ends on reload'}`)
    say(shield, state.protectedByWebAuthn ? 'Protected' : 'Protect now')
    shield.disabled = !PASSKEYS_AVAILABLE || state.protectedByWebAuthn
  })

  return () => { stopSession?.(); clearInterval(peersTimer) }
}
