/**
 * The identity door. Every button here is derived from the security state, not
 * from a local flag, so the panel can never claim a session the engine does not
 * have — including the case where an authenticator has no PRF extension and the
 * passkey silently protects nothing.
 */
import { el, $, clear, asset } from './dom.js'
import { toast, secretDialog } from './toast.js'
import { PASSKEYS_AVAILABLE, register, loginWithMnemonic, loginWithPasskey, hasPasskey, setDisplayName } from '../lib/identity.js'
import { DEMO_MODE } from '../lib/constitution.js'
import { DEMO_IDENTITIES } from '../lib/demo.js'

/**
 * Renders the login screen into a container.
 * @param {HTMLElement} root
 */
export const renderLogin = (root) => {
  clear(root)
  root.className = 'h-full flex flex-col items-center justify-center p-4'

  const brand = el('div', 'mb-8 text-center flex flex-col items-center select-none')
  const logo = el('img', 'w-16 h-12 mb-4', { src: asset('logo.svg'), alt: '', draggable: false })
  const title = el('h1', 'text-4xl font-bold')
  title.append(el('span', 'text-accent', { textContent: 'd' }), document.createTextNode('Messenger'))
  brand.append(logo, title, el('p', 'text-dim mt-2', { textContent: 'Serverless, private messaging' }))

  const card = el('div', 'w-full max-w-md mx-auto p-6 bg-card rounded-lg shadow-card')
  const form = el('div', 'space-y-4')

  const nameField = el('div')
  const nameInput = el('input', 'input-box', { id: 'displayName', type: 'text', placeholder: 'Name', autocomplete: 'nickname' })
  nameField.append(
    el('label', 'block text-sm text-dim mb-1', { htmlFor: 'displayName', textContent: 'Your name (optional)' }),
    nameInput,
  )

  const errorBox = el('div', 'p-3 bg-danger/15 border border-danger rounded-md text-danger text-sm hidden')
  const actions = el('div', 'space-y-3 pt-2')

  const busy = (on) => actions.querySelectorAll('button').forEach(b => { b.disabled = on })
  const fail = (message) => { errorBox.textContent = message; errorBox.classList.remove('hidden') }

  const join = el('button', 'btn-primary w-full flex items-center justify-center gap-2', {
    dataset: { testid: 'join' },
    onclick: async () => {
      errorBox.classList.add('hidden')
      busy(true)
      try {
        const { mnemonic } = await register()
        await loginWithMnemonic(mnemonic)
        if (nameInput.value.trim()) await setDisplayName(nameInput.value.trim())
        await secretDialog(
          'Your recovery phrase',
          'This is the only way back into this identity. A mnemonic session ends on reload — protect it with a passkey from the session bar to keep it.',
          mnemonic,
        )
      } catch (error) {
        fail(error.message ?? String(error))
      } finally {
        busy(false)
      }
    },
  })
  join.append(el('span', 'i-carbon-user-avatar'), document.createTextNode('Create an identity'))

  const passkey = el('button', 'btn-secondary w-full flex items-center justify-center gap-2', {
    dataset: { testid: 'passkey-login' },
    onclick: async () => {
      busy(true)
      try { await loginWithPasskey() } catch (error) { fail(error.message ?? String(error)) } finally { busy(false) }
    },
  })
  passkey.append(el('span', 'i-carbon-fingerprint-recognition'), document.createTextNode('Sign in with passkey'))

  const recoverBox = el('div', 'space-y-2 hidden')
  const phrase = el('textarea', 'input-box rounded-lg h-20 py-2 resize-none', {
    placeholder: 'twelve words, separated by spaces', dataset: { testid: 'mnemonic' },
  })
  const confirm = el('button', 'btn-secondary w-full', {
    textContent: 'Recover',
    dataset: { testid: 'recover-confirm' },
    onclick: async () => {
      busy(true)
      try { await loginWithMnemonic(phrase.value) } catch (error) { fail('That phrase did not open a session') } finally { busy(false) }
    },
  })
  recoverBox.append(phrase, confirm)

  const recover = el('button', 'btn-ghost w-full flex items-center justify-center gap-2', {
    onclick: () => recoverBox.classList.toggle('hidden'),
  })
  recover.append(el('span', 'i-carbon-password'), document.createTextNode('Recover with a phrase'))

  actions.append(join)
  if (PASSKEYS_AVAILABLE && hasPasskey()) actions.append(passkey)
  actions.append(recover, recoverBox)

  // The demo shortcut of the design guide (§4.1, §4.5): one quiet button per
  // canonical identity, on the same action row, so two windows can meet in a
  // click — Superadmin's window runs the governance engine, Alice and Bob
  // arrive as guests and get promoted by its rules.
  if (DEMO_MODE) {
    const demo = el('div', 'pt-3 border-t border-line space-y-2')
    demo.append(el('p', 'text-xs text-faint text-center', { textContent: 'Demo identities — public, throwaway, shared by every GenosDB example' }))
    const rowNode = el('div', 'grid grid-cols-3 gap-2')
    for (const identity of DEMO_IDENTITIES) {
      const button = el('button', 'btn-ghost text-sm px-2', {
        title: `${identity.name} (demo) · ${identity.address}`,
        dataset: { testid: `demo-${identity.name.toLowerCase()}` },
        onclick: async () => {
          busy(true)
          try { await loginWithMnemonic(identity.mnemonic) } catch (error) { fail(error.message ?? String(error)) } finally { busy(false) }
        },
      })
      button.append(el('span', '', { textContent: identity.emoji }), document.createTextNode(` ${identity.name}`))
      rowNode.append(button)
    }
    demo.append(rowNode)
    actions.append(demo)
  }

  form.append(nameField, errorBox, actions)
  card.append(form)

  if (!PASSKEYS_AVAILABLE) {
    card.append(el('p', 'text-xs text-faint mt-4 text-center', {
      textContent: 'Passkeys need a secure context and a real domain, so on this host a session ends when the page reloads.',
    }))
  }

  root.append(brand, card)
  nameInput.focus()
}
