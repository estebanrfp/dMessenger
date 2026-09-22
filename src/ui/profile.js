/**
 * Profile — an identity as the graph sees it: address, name, role.
 *
 * Editing the name is only offered on one's own profile; anyone else's is
 * read-only not as a UI courtesy but because every peer would refuse the
 * write. The name is a claim only its owner can make.
 */
import { el, clear, say, shortAddress } from './dom.js'
import { avatar } from './avatar.js'
import { session, setDisplayName } from '../lib/identity.js'
import { db } from '../lib/db.js'
import { nameOf } from '../lib/names.js'
import { toast } from './toast.js'

const roleBadge = (role) => el('span', `text-xs px-2 py-0.5 rounded-full bg-role-${role}/20 text-role-${role} font-medium`, { textContent: role })

let stop = null

/**
 * @param {HTMLElement} root
 * @param {string} address
 * @param {{onBack: () => void, onMessage: (address: string) => void}} handlers
 */
export const renderProfile = async (root, address, handlers) => {
  stop?.()
  clear(root)
  root.className = 'flex-1 flex flex-col min-h-0 bg-page'
  const mine = address.toLowerCase() === session.address?.toLowerCase()

  const header = el('header', 'h-14 px-4 flex items-center gap-3 border-b border-line flex-shrink-0 bg-card')
  const back = el('button', 'btn-ghost p-2', { title: 'Back', onclick: handlers.onBack })
  back.append(el('span', 'i-carbon-arrow-left text-xl'))
  header.append(back, el('h1', 'text-xl font-semibold', { textContent: 'Profile' }))

  const scroll = el('div', 'flex-1 overflow-y-auto overscroll-contain p-4')
  const column = el('div', 'max-w-lg mx-auto space-y-6')
  const card = el('div', 'bg-card rounded-lg p-6 text-center', { dataset: { testid: 'profile-card' } })

  const face = el('div', 'flex justify-center mb-4')
  face.append(avatar(address, 96))
  const name = el('h2', 'text-2xl font-bold mb-1', { dataset: { testid: 'profile-name' } })
  const role = el('div', 'mb-4 flex justify-center')
  const addr = el('button', 'btn-secondary w-full mono text-sm truncate', {
    textContent: address, title: 'Copy address', dataset: { testid: 'profile-address' },
    onclick: async () => { await navigator.clipboard.writeText(address).catch(() => {}); toast('Address copied', 'ok') },
  })
  card.append(face, name, role, addr)

  const paintName = () => {
    const known = nameOf(address)
    say(name, known ?? 'No name yet')
    name.classList.toggle('italic', !known)
    name.classList.toggle('opacity-70', !known)
  }
  paintName()

  if (mine) {
    const form = el('form', 'mt-4 flex gap-2')
    const input = el('input', 'input-box', { placeholder: 'Your name', maxLength: 48, dataset: { testid: 'name-input' }, value: nameOf(address) ?? '' })
    const save = el('button', 'btn-primary flex-shrink-0', { type: 'submit', textContent: 'Save', dataset: { testid: 'name-save' } })
    form.append(input, save)
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      save.disabled = true
      try { await setDisplayName(input.value.trim()); toast('Name published — only you can write it', 'ok') }
      catch (error) { toast(error.message ?? 'Refused', 'error') }
      finally { save.disabled = false }
    })
    card.append(form, el('p', 'text-xs text-faint mt-3', {
      textContent: 'Your name lives on your identity node, the one governance reads. Every peer refuses anyone else writing it.',
    }))
  } else {
    const message = el('button', 'btn-primary w-full mt-4 flex items-center justify-center gap-2', {
      dataset: { testid: 'profile-message' }, onclick: () => handlers.onMessage(address),
    })
    message.append(el('span', 'i-carbon-chat'), document.createTextNode('Message'))
    card.append(message)
  }

  column.append(card)
  scroll.append(column)
  root.append(header, scroll)

  // The role and the name both live on the same node: one live read.
  const { unsubscribe } = await db.get(`user:${address}`, (node) => {
    clear(role).append(roleBadge(node?.value?.role ?? 'guest'))
    paintName()
  })
  stop = () => unsubscribe?.()
  return stop
}
