/**
 * Results speak in a toast, questions in a <dialog>. Never alert(), confirm()
 * or prompt(): they block the thread, and the thread is what is syncing.
 */
import { el } from './dom.js'

const stack = el('div', 'toast-stack')
document.body.append(stack)

/**
 * Shows a transient message.
 * @param {string} message
 * @param {'info'|'ok'|'error'} [kind]
 */
export const toast = (message, kind = 'info') => {
  const node = el('div', 'toast', { textContent: message, dataset: { kind } })
  stack.append(node)
  setTimeout(() => node.remove(), kind === 'error' ? 6000 : 3200)
}

/**
 * Asks a yes/no question in a modal dialog.
 * @returns {Promise<boolean>}
 */
export const confirmDialog = (title, detail, confirmLabel = 'Confirm') => new Promise((resolve) => {
  const dialog = el('dialog', '', { })
  const actions = el('div', 'flex gap-2 justify-end mt-5')
  const cancel = el('button', 'btn-ghost', { textContent: 'Cancel', onclick: () => { dialog.close(); resolve(false) } })
  const ok = el('button', 'btn-primary', { textContent: confirmLabel, onclick: () => { dialog.close(); resolve(true) } })
  actions.append(cancel, ok)
  dialog.append(
    el('h2', 'text-lg font-bold mb-1', { textContent: title }),
    el('p', 'text-sm text-dim', { textContent: detail }),
    actions,
  )
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  document.body.append(dialog)
  dialog.showModal()
})

/** Shows a one-time secret (the mnemonic) with a copy button. */
export const secretDialog = (title, detail, secret) => new Promise((resolve) => {
  const dialog = el('dialog')
  const box = el('p', 'mono text-sm p-3 my-3 rounded-md bg-field border border-line break-words', { textContent: secret })
  const actions = el('div', 'flex gap-2 justify-end mt-2')
  const copy = el('button', 'btn-secondary', {
    textContent: 'Copy',
    onclick: async () => { await navigator.clipboard.writeText(secret).catch(() => {}); copy.textContent = 'Copied' },
  })
  const done = el('button', 'btn-primary', { textContent: 'I saved it', onclick: () => { dialog.close(); resolve(true) } })
  actions.append(copy, done)
  dialog.append(
    el('h2', 'text-lg font-bold mb-1', { textContent: title }),
    el('p', 'text-sm text-dim', { textContent: detail }),
    box,
    actions,
  )
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  document.body.append(dialog)
  dialog.showModal()
})
