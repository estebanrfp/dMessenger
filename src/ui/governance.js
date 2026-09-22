/**
 * Governance panel — the constitution, the ladder, and who sits where.
 *
 * It also shows the gap the model is honest about: `vouches` is declared on a
 * node its subject can rewrite, while the vouch nodes themselves are signed and
 * countable. Declared versus verifiable, side by side.
 */
import { el, clear, say, shortAddress } from './dom.js'
import { avatar } from './avatar.js'
import { session, atLeast } from '../lib/identity.js'
import { db } from '../lib/db.js'
import { SUPERADMINS, GOVERNANCE, ROLES } from '../lib/constitution.js'
import { vouch, countVouches, watchIdentities, publishOwnVouchCount } from '../lib/vouches.js'
import { toast } from './toast.js'

const ROLE_ORDER = ['guest', 'user', 'manager', 'admin', 'superadmin']

const badge = (role) => el('span', `text-xs px-2 py-0.5 rounded-full bg-role-${role}/20 text-role-${role} font-medium`, { textContent: role })

let stop = null

/**
 * @param {HTMLElement} root
 * @param {{onBack: () => void}} handlers
 */
export const renderGovernance = async (root, handlers) => {
  stop?.()
  clear(root)
  root.className = 'flex-1 flex flex-col min-h-0 bg-page'

  const header = el('header', 'h-14 px-4 flex items-center gap-3 border-b border-line flex-shrink-0')
  const back = el('button', 'btn-ghost p-2 rounded-full', { onclick: handlers.onBack, title: 'Back' })
  back.append(el('span', 'i-carbon-arrow-left text-xl'))
  header.append(back, el('h2', 'font-bold text-lg', { textContent: 'Governance' }))

  const scroll = el('div', 'flex-1 overflow-y-auto overscroll-contain p-4 space-y-6')

  // ── the constitution ──
  const constitution = el('section', 'space-y-2')
  constitution.append(el('h3', 'text-sm font-bold text-dim uppercase tracking-wide', { textContent: 'The constitution' }))
  const rules = el('div', 'rounded-md border border-line bg-card p-4 space-y-3')
  rules.append(el('p', 'text-sm text-dim', {
    textContent: 'Local configuration, identical on every peer and on the Fallback Server. It is never read from the graph, a channel or the URL.',
  }))
  const admins = el('p', 'text-sm mono break-words', { textContent: SUPERADMINS.map(shortAddress).join(', ') })
  rules.append(el('p', 'text-xs text-faint uppercase tracking-wide', { textContent: 'Superadmins' }), admins)

  const ladder = el('div', 'flex flex-wrap gap-2 pt-1')
  for (const role of ROLE_ORDER) {
    const chip = el('div', 'flex items-center gap-2 px-2 py-1 rounded-md bg-field')
    chip.append(badge(role), el('span', 'text-xs text-dim', { textContent: (ROLES[role]?.can ?? []).join(' · ') }))
    ladder.append(chip)
  }
  rules.append(el('p', 'text-xs text-faint uppercase tracking-wide pt-2', { textContent: 'Ladder' }), ladder)

  const ruleList = el('ul', 'space-y-1 pt-2')
  for (const rule of GOVERNANCE) {
    const item = el('li', 'text-xs mono text-dim break-words')
    const when = rule.offsetTimestamp ? ` after ${rule.offsetTimestamp / 1000}s stable` : ''
    item.textContent = `if ${JSON.stringify(rule.if)}${when} → ${rule.then.assignRole}`
    ruleList.append(item)
  }
  rules.append(el('p', 'text-xs text-faint uppercase tracking-wide pt-2', { textContent: 'Rules — evaluated every 4s, last match wins' }), ruleList)
  constitution.append(rules)

  // ── identities ──
  const people = el('section', 'space-y-2')
  people.append(el('h3', 'text-sm font-bold text-dim uppercase tracking-wide', { textContent: 'Identities' }))
  const table = el('div', 'rounded-md border border-line bg-card divide-y divide-line', {
    dataset: { testid: 'identity-table' },
  })
  people.append(table)

  const note = el('p', 'text-xs text-faint', {
    textContent: 'Declared vouches live on the identity node its own subject may rewrite; the vouch nodes are signed and counted independently. A gap between the two is self-promotion, in the open.',
  })
  people.append(note)

  scroll.append(constitution, people)
  root.append(header, scroll)

  const rows = new Map()

  const rowFor = (address) => {
    if (rows.has(address)) return rows.get(address)
    const node = el('div', 'px-4 py-3 flex items-center gap-3', { dataset: { testid: 'identity-row', address } })
    const info = el('div', 'flex-1 min-w-0')
    const name = el('p', 'text-sm mono truncate', { textContent: shortAddress(address) })
    const meta = el('p', 'text-xs text-faint')
    info.append(name, meta)
    const roleSlot = el('div')
    const actions = el('div', 'flex items-center gap-1')
    node.append(avatar(address, 32), info, roleSlot, actions)
    table.append(node)
    const entry = { node, meta, roleSlot, actions }
    rows.set(address, entry)
    return entry
  }

  const { unsubscribe } = await watchIdentities(async (event) => {
    const address = event.id.slice('user:'.length)
    if (event.action === 'removed') { rows.get(address)?.node.remove(); rows.delete(address); return }
    const entry = rowFor(address)
    const role = event.value?.role ?? 'guest'
    clear(entry.roleSlot).append(badge(role))

    const declared = event.value?.vouches ?? 0
    const real = await countVouches(address)
    say(entry.meta, `declared ${declared} · verifiable ${real}${declared > real ? '  ⚠ overstated' : ''}`)
    entry.meta.classList.toggle('text-danger', declared > real)

    clear(entry.actions)
    const isMe = address.toLowerCase() === session.address?.toLowerCase()
    if (!isMe) {
      const give = el('button', 'btn-ghost text-xs px-3 py-1', {
        textContent: 'Vouch', dataset: { testid: 'vouch' },
        onclick: async () => { await vouch(address); toast('Vouch signed', 'ok') },
      })
      entry.actions.append(give)
    }
    if (atLeast('superadmin') && !isMe) {
      const promote = el('select', 'bg-field text-xs rounded-md px-2 py-1 border border-line')
      for (const option of ROLE_ORDER) promote.append(el('option', '', { value: option, textContent: option, selected: option === role }))
      promote.addEventListener('change', async () => {
        await db.sm.assignRole(address, promote.value)
        toast(`Signed decision: ${shortAddress(address)} → ${promote.value}`, 'ok')
      })
      entry.actions.append(promote)
    }
  })

  const refresh = el('button', 'btn-secondary text-sm', {
    textContent: 'Publish my vouch count', dataset: { testid: 'publish-vouches' },
    onclick: async () => { const n = await publishOwnVouchCount(); toast(`Declared ${n} vouches`, 'ok') },
  })
  people.append(refresh)

  stop = () => unsubscribe?.()
  return stop
}
