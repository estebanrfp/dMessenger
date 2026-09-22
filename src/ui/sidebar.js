/**
 * The space list — conversations and groups in one column.
 *
 * Subscriptions are per view and live for the life of the page: one over
 * `t: 'conv'`, one over `t: 'group'`, one over `t: 'msg'` for the preview
 * column. The engine sorts and windows; the DOM is the state.
 */
import { el, clear, say, shortAddress, formatTime } from './dom.js'
import { avatar } from './avatar.js'
import { session, onSession, abbr, atLeast, PASSKEYS_AVAILABLE, protectWithPasskey } from '../lib/identity.js'
import { watchConversations, counterpart } from '../lib/conversations.js'
import { watchGroups } from '../lib/groups.js'
import { cachedKeys } from '../lib/keyring.js'
import { watchAllMessages, readBody } from '../lib/messages.js'
import { isExpired, onExpire } from '../lib/expiry.js'
import { label, nameOf, onName } from '../lib/names.js'
import { db } from '../lib/db.js'
import { toast } from './toast.js'

const rows = new Map()          // spaceId -> row parts
const lastSeen = new Map()

/** Role badge on the trust ramp. */
const roleBadge = (role) => el('span', `text-xs px-2 py-0.5 rounded-full bg-role-${role}/20 text-role-${role} font-medium`, {
  textContent: role, dataset: { testid: 'role-badge' },
})

/** What a space shows in the list, whichever kind it is. */
export const describe = (space) => space.value.t === 'group'
  ? { kind: 'group', title: space.value.name, seed: space.id, members: space.value.members.length, other: null }
  : { kind: 'conv', title: label(counterpart(space)), seed: counterpart(space), members: 2, other: counterpart(space) }

const groupAvatar = (seed) => {
  const node = avatar(seed, 40)
  node.className += ' rounded-md'                // groups read as squares, people as circles
  return node
}

const row = (space, onSelect) => {
  const info = describe(space)
  const node = el('button', 'w-full px-4 py-3 flex items-center gap-3 hover:bg-field transition-colors text-left', {
    dataset: { testid: info.kind === 'group' ? 'group-row' : 'chat-row', space: space.id },
    onclick: () => onSelect(space),
  })
  const body = el('div', 'flex-1 min-w-0')
  const top = el('div', 'flex items-center justify-between gap-2')
  const name = el('p', `font-medium truncate text-sm ${info.kind === 'group' || nameOf(info.other) ? '' : 'mono'}`, { textContent: info.title, dataset: { testid: 'row-title' } })
  const time = el('span', 'text-xs text-faint flex-shrink-0')
  const preview = el('p', 'text-sm text-dim truncate', {
    textContent: info.kind === 'group' ? `${info.members} members` : 'No messages yet',
  })
  const badge = el('span', 'min-w-5 h-5 px-1.5 rounded-full bg-accent text-on-accent text-xs flex items-center justify-center is-hidden')
  top.append(name, time)
  const bottom = el('div', 'flex items-center justify-between gap-2')
  bottom.append(preview, badge)
  body.append(top, bottom)
  node.append(info.kind === 'group' ? groupAvatar(info.seed) : avatar(info.seed, 40), body)
  return { node, name, preview, time, badge, unread: 0, space, other: info.other }
}

/**
 * Renders the sidebar and keeps it live.
 * @param {HTMLElement} root
 * @param {{onSelect, onNewChat, onNewGroup, onGovernance}} handlers
 */
export const renderSidebar = async (root, handlers) => {
  clear(root)
  rows.clear()
  root.className = 'h-full flex flex-col bg-card border-r border-line'

  const header = el('header', 'h-14 px-4 flex items-center justify-between border-b border-line flex-shrink-0')
  const brand = el('div', 'flex items-center gap-2 select-none')
  const title = el('h1', 'text-xl font-bold')
  title.append(el('span', 'text-accent', { textContent: 'd' }), document.createTextNode('Messenger'))
  brand.append(el('img', 'w-8 h-8', { src: '/logo.svg', alt: '', draggable: false }), title)

  const tools = el('div', 'flex items-center gap-1')
  const settings = el('button', 'p-2 rounded-full text-dim hover:bg-field hover:text-ink transition-colors', {
    title: 'Settings', dataset: { testid: 'open-settings' }, onclick: handlers.onSettings,
  })
  settings.append(el('span', 'i-carbon-settings text-xl'))
  const governance = el('button', 'p-2 rounded-full text-dim hover:bg-field hover:text-ink transition-colors', {
    title: 'Governance', dataset: { testid: 'open-governance' }, onclick: handlers.onGovernance,
  })
  governance.append(el('span', 'i-carbon-rule text-xl'))
  const theme = el('button', 'p-2 rounded-full text-dim hover:bg-field hover:text-ink transition-colors', {
    title: 'Theme',
    onclick: () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
      document.documentElement.dataset.theme = next
      try { localStorage.setItem('dmessenger-theme', next) } catch {}
    },
  })
  theme.append(el('span', 'i-carbon-sun text-xl'))
  tools.append(settings, governance, theme)
  header.append(brand, tools)

  const bar = el('div', 'p-3 border-b border-line flex-shrink-0 flex gap-2')
  const newChat = el('button', 'btn-primary flex-1 flex items-center justify-center gap-2', {
    dataset: { testid: 'new-chat' }, onclick: handlers.onNewChat,
  })
  newChat.append(el('span', 'i-carbon-add'), document.createTextNode('New chat'))
  // Gated by degrees: disabled with a title, never hidden, so the ladder is legible.
  const newGroup = el('button', 'btn-secondary flex items-center justify-center gap-2 px-3', {
    dataset: { testid: 'new-group' }, onclick: handlers.onNewGroup,
  })
  newGroup.append(el('span', 'i-carbon-group'))
  bar.append(newChat, newGroup)

  const list = el('div', 'flex-1 overflow-y-auto overscroll-contain', { dataset: { testid: 'chat-list' } })
  const empty = el('div', 'text-center py-8 px-4')
  empty.append(
    el('div', 'i-carbon-chat text-4xl text-faint mx-auto mb-2'),
    el('p', 'text-dim text-sm', { textContent: 'Nothing here yet' }),
  )
  list.append(empty)

  const footer = el('footer', 'px-4 py-3 border-t border-line flex items-center gap-3 flex-shrink-0')
  const me = el('button', 'flex-1 min-w-0 text-left hover:opacity-80 transition-opacity', {
    title: 'Your profile', dataset: { testid: 'open-profile' }, onclick: () => handlers.onProfile(session.address),
  })
  const meAddress = el('p', 'text-sm mono truncate', { dataset: { testid: 'session-address' } })
  const meRole = el('div', 'mt-0.5')
  me.append(meAddress, meRole)
  const shield = el('button', 'p-2 rounded-full text-dim hover:bg-field hover:text-ink transition-colors', {
    title: 'Protect this identity with a passkey', dataset: { testid: 'protect-passkey' },
    onclick: async () => {
      const address = await protectWithPasskey().catch(() => null)
      toast(
        address ? 'Identity protected: this session now survives a reload' : 'This authenticator has no PRF extension, so nothing was stored and the session stays unprotected',
        address ? 'ok' : 'error',
      )
    },
  })
  shield.append(el('span', 'i-carbon-fingerprint-recognition text-xl'))
  footer.append(avatar(session.address, 32), me, shield)

  onSession((state) => {
    say(meAddress, state.address ? abbr(state.address) : '—')
    clear(meRole).append(roleBadge(state.role))
    shield.classList.toggle('hidden', !PASSKEYS_AVAILABLE || state.protectedByWebAuthn)
    shield.classList.toggle('text-role-user', state.protectedByWebAuthn)
    // `publish` is what creating a group costs, and it arrives with `manager`.
    const allowed = atLeast('manager')
    newGroup.disabled = !allowed
    newGroup.title = allowed
      ? 'New group'
      : `Creating a group needs the publish permission, which arrives with the manager role — you are ${state.role}`
  })

  root.append(header, bar, list, footer)

  const addRow = (event) => {
    if (rows.has(event.id)) {
      const entry = rows.get(event.id)
      if (event.value.t === 'group') say(entry.name, event.value.name)
      return
    }
    empty.remove()
    const entry = row(event, handlers.onSelect)
    rows.set(event.id, entry)
    list.append(entry.node)
  }

  const dropRow = (id) => { rows.get(id)?.node.remove(); rows.delete(id) }

  const { unsubscribe: stopConversations } = await watchConversations((event) =>
    event.action === 'removed' ? dropRow(event.id) : addRow(event))

  const { unsubscribe: stopGroups } = await watchGroups((event) =>
    event.action === 'removed' ? dropRow(event.id) : addRow(event))

  const { unsubscribe: stopMessages } = await watchAllMessages(async (event) => {
    if (event.action === 'removed' || isExpired(event)) return
    const entry = rows.get(event.value.conv)
    if (!entry) return
    const text = event.value.kind === 'file' ? `📎 ${event.value.name}` : await readBody(cachedKeys(event.value.conv), event)
    say(entry.preview, text ?? 'Encrypted message')
    say(entry.time, formatTime(event.value.ts))
    if (event.action === 'added' && event.value.ts > (lastSeen.get(event.value.conv) ?? 0)) {
      entry.unread += 1
      say(entry.badge, String(entry.unread)).classList.remove('is-hidden')
    }
  })

  const offExpire = onExpire((_, spaceId) => refreshPreview(spaceId))
  const offName = onName((address) => {
    for (const entry of rows.values()) {
      if (entry.other?.toLowerCase() !== address) continue
      say(entry.name, label(entry.other))
      entry.name.classList.toggle('mono', !nameOf(entry.other))
    }
  })
  return () => { stopConversations?.(); stopGroups?.(); stopMessages?.(); offExpire(); offName() }
}

/** Clears the unread badge of a space the user just opened. */
export const markRead = (spaceId) => {
  const entry = rows.get(spaceId)
  lastSeen.set(spaceId, Date.now())
  if (!entry) return
  entry.unread = 0
  entry.badge.classList.add('is-hidden')
}

/** Highlights the open space. */
export const highlight = (spaceId) => {
  for (const [id, entry] of rows) entry.node.classList.toggle('bg-field', id === spaceId)
}

/** Re-reads the newest message of a row, for when its key arrives late. */
export const refreshPreview = async (spaceId) => {
  const entry = rows.get(spaceId)
  if (!entry) return
  const { results } = await db.map({ query: { t: 'msg', conv: spaceId }, field: 'ts', order: 'desc', $limit: 3 })
  const newest = results.find(m => !isExpired(m))
  if (!newest) { say(entry.preview, 'No messages'); say(entry.time, ''); return }
  const text = newest.value.kind === 'file' ? `📎 ${newest.value.name}` : await readBody(cachedKeys(spaceId), newest)
  say(entry.preview, text ?? 'Encrypted message')
  say(entry.time, formatTime(newest.value.ts))
}

/** The live node for a space id, as the list currently holds it. */
export const spaceById = (id) => rows.get(id)?.space ?? null
