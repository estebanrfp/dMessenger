/**
 * Group creation and roster.
 *
 * Nothing here enforces anything: the buttons mirror what the engine will
 * accept. Creating needs `publish`; changing the roster needs ownership or a
 * `write` collaboration on the node; removing a member is an envelope revoke
 * plus a new epoch. A peer running modified code can press all of them and
 * every other peer will still refuse what it is not entitled to.
 */
import { el, clear, shortAddress } from './dom.js'
import { avatar } from './avatar.js'
import { session } from '../lib/identity.js'
import { db } from '../lib/db.js'
import { createGroup, addMember, removeMember, promoteToAdmin, isAdmin } from '../lib/groups.js'
import { toast, confirmDialog } from './toast.js'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** Dialog: name the group and list the first members. */
export const newGroupDialog = (onCreated) => {
  const dialog = el('dialog')
  const name = el('input', 'input-box mt-3', { placeholder: 'Group name', dataset: { testid: 'group-name' }, autocomplete: 'off' })
  const members = el('textarea', 'input-box rounded-lg h-24 py-2 mt-2 resize-none', {
    placeholder: 'Member addresses, one per line', dataset: { testid: 'group-members' },
  })
  const actions = el('div', 'flex gap-2 justify-end mt-5')
  const cancel = el('button', 'btn-ghost', { textContent: 'Cancel', onclick: () => dialog.close() })
  const create = el('button', 'btn-primary', {
    textContent: 'Create', dataset: { testid: 'create-group' },
    onclick: async () => {
      const title = name.value.trim()
      if (!title) { toast('The group needs a name', 'error'); return }
      const list = members.value.split(/\s+/).map(a => a.trim()).filter(Boolean)
      const invalid = list.find(a => !ADDRESS.test(a))
      if (invalid) { toast(`Not an address: ${invalid.slice(0, 12)}…`, 'error'); return }
      create.disabled = true
      try {
        const { id } = await createGroup(title, list)
        dialog.close()
        toast('Group created and keys shared', 'ok')
        onCreated?.(id)
      } catch (error) {
        // The ladder speaking: `publish` is a manager's permission.
        toast(`Refused: ${error.message ?? error}`, 'error')
      } finally {
        create.disabled = false
      }
    },
  })
  actions.append(cancel, create)
  dialog.append(
    el('h2', 'text-lg font-bold', { textContent: 'New group' }),
    el('p', 'text-sm text-dim', { textContent: 'Creating a group needs the publish permission, which arrives with the manager role.' }),
    name, members, actions,
  )
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  document.body.append(dialog)
  dialog.showModal()
  name.focus()
}

let stop = null

/**
 * The group detail panel: roster, admins, and the two operations that change
 * who can read what.
 * @param {HTMLElement} root
 * @param {object} group
 * @param {{onBack: () => void}} handlers
 */
export const renderGroupDetails = async (root, group, handlers) => {
  stop?.()
  clear(root)
  root.className = 'flex-1 flex flex-col min-h-0 bg-page'

  const header = el('header', 'h-14 px-4 flex items-center gap-3 border-b border-line flex-shrink-0')
  const back = el('button', 'btn-ghost p-2 rounded-full', { onclick: handlers.onBack, title: 'Back' })
  back.append(el('span', 'i-carbon-arrow-left text-xl'))
  header.append(back, el('h2', 'font-bold text-lg', { textContent: 'Group details' }))

  const scroll = el('div', 'flex-1 overflow-y-auto overscroll-contain p-4 space-y-6')

  const identity = el('section', 'flex items-center gap-3')
  const face = avatar(group.id, 56)
  face.className += ' rounded-lg'
  const titles = el('div', 'min-w-0')
  const nameNode = el('h3', 'text-xl font-bold truncate', { textContent: group.value.name })
  const countNode = el('p', 'text-sm text-dim')
  titles.append(nameNode, countNode)
  identity.append(face, titles)

  const roster = el('section', 'space-y-2')
  roster.append(el('h4', 'text-sm font-bold text-dim uppercase tracking-wide', { textContent: 'Members' }))
  const table = el('div', 'rounded-md border border-line bg-card divide-y divide-line', {
    dataset: { testid: 'roster' },
  })
  roster.append(table)

  const invite = el('section', 'space-y-2')
  const inviteRow = el('div', 'flex gap-2')
  const inviteInput = el('input', 'input-box', { placeholder: '0x…', dataset: { testid: 'invite-address' }, autocomplete: 'off' })
  const inviteButton = el('button', 'btn-primary flex-shrink-0', {
    textContent: 'Add', dataset: { testid: 'invite-add' },
    onclick: async () => {
      const address = inviteInput.value.trim()
      if (!ADDRESS.test(address)) { toast('That is not an address', 'error'); return }
      inviteButton.disabled = true
      try {
        const shared = await addMember(current(), address)
        inviteInput.value = ''
        toast(shared ? 'Member added and key shared' : 'Member added — the key travels once that identity signs in', shared ? 'ok' : 'info')
      } catch (error) {
        toast(error.message ?? 'Could not add', 'error')
      } finally {
        inviteButton.disabled = false
      }
    },
  })
  inviteRow.append(inviteInput, inviteButton)
  invite.append(
    el('h4', 'text-sm font-bold text-dim uppercase tracking-wide', { textContent: 'Add a member' }),
    inviteRow,
  )

  const epochNote = el('p', 'text-xs text-faint', {
    textContent: 'Removing a member revokes their envelope and opens a new key epoch: they cannot read what follows. What they read while they were in, they may have kept — no rotation takes that back.',
  })

  scroll.append(identity, roster, invite, epochNote)
  root.append(header, scroll)

  // The node changes under us (roster edits, epochs), so keep a live copy.
  let latest = group
  const current = () => latest

  const paint = () => {
    const value = latest.value
    nameNode.textContent = value.name
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
    countNode.textContent = `${plural(value.members.length, 'member')} · ${plural((value.admins ?? []).length, 'admin')}`
    const admin = isAdmin(latest)
    invite.classList.toggle('hidden', !admin)

    clear(table)
    for (const address of value.members) {
      const mine = address.toLowerCase() === session.address?.toLowerCase()
      const owner = address.toLowerCase() === value.owner.toLowerCase()
      const isMemberAdmin = (value.admins ?? []).some(a => a.toLowerCase() === address.toLowerCase())

      const rowNode = el('div', 'px-4 py-3 flex items-center gap-3', { dataset: { testid: 'member-row', address } })
      const info = el('div', 'flex-1 min-w-0')
      info.append(
        el('p', 'text-sm mono truncate', { textContent: shortAddress(address) + (mine ? ' · you' : '') }),
        el('p', 'text-xs text-faint', { textContent: owner ? 'owner' : isMemberAdmin ? 'admin' : 'member' }),
      )
      const actions = el('div', 'flex items-center gap-1')

      if (admin && !owner && !mine) {
        const kick = el('button', 'btn-ghost text-xs px-3 py-1 text-danger', {
          textContent: 'Remove', dataset: { testid: 'remove-member' },
          onclick: async () => {
            const ok = await confirmDialog(
              'Remove member?',
              'Their envelope is revoked and a new key epoch opens. They keep what they already read.',
              'Remove',
            )
            if (!ok) return
            try {
              await removeMember(current(), address)
              toast('Removed — new epoch open', 'ok')
            } catch (error) {
              toast(error.message ?? 'Could not remove', 'error')
            }
          },
        })
        actions.append(kick)
      }

      if (!isMemberAdmin && !mine && value.owner.toLowerCase() === session.address?.toLowerCase()) {
        const promote = el('button', 'btn-ghost text-xs px-3 py-1', {
          textContent: 'Make admin', dataset: { testid: 'make-admin' },
          onclick: async () => {
            try {
              await promoteToAdmin(current(), address)
              toast('Granted write on the roster node', 'ok')
            } catch (error) {
              toast(error.message ?? 'Could not promote', 'error')
            }
          },
        })
        actions.append(promote)
      }

      rowNode.append(avatar(address, 32), info, actions)
      table.append(rowNode)
    }
  }

  const { unsubscribe } = await db.get(group.id, (node) => {
    if (!node) { handlers.onBack(); return }
    latest = node
    paint()
  })

  paint()
  stop = () => unsubscribe?.()
  return stop
}
