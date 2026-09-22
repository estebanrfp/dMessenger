/**
 * The install banner. The browser decides when the app is installable and
 * hands us the prompt; we only decide whether to show it, and remember a
 * dismissal on this device so it is not asked again for a week.
 */
import { el } from './dom.js'

const KEY = 'dmessenger-install-dismissed'
const WEEK = 7 * 86_400_000

export const mountInstallPrompt = () => {
  let deferred = null
  const banner = el('div', 'fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-40 bg-card border border-line rounded-lg shadow-card p-4 flex items-center gap-3 is-hidden', {
    dataset: { testid: 'install-banner' },
  })
  const text = el('div', 'flex-1 min-w-0')
  text.append(
    el('p', 'font-medium text-sm', { textContent: 'Install dMessenger' }),
    el('p', 'text-xs text-dim', { textContent: 'Opens like an app and works with no network' }),
  )
  const later = el('button', 'btn-ghost text-sm px-3', {
    textContent: 'Not now',
    onclick: () => { try { localStorage.setItem(KEY, String(Date.now())) } catch {} ; banner.classList.add('is-hidden') },
  })
  const install = el('button', 'btn-primary text-sm px-3', {
    textContent: 'Install', dataset: { testid: 'install-accept' },
    onclick: async () => {
      if (!deferred) return
      deferred.prompt()
      await deferred.userChoice.catch(() => null)
      deferred = null
      banner.classList.add('is-hidden')
    },
  })
  banner.append(el('img', 'w-10 h-10', { src: '/logo.svg', alt: '' }), text, later, install)
  document.body.append(banner)

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    let dismissed = 0
    try { dismissed = Number(localStorage.getItem(KEY)) || 0 } catch {}
    if (Date.now() - dismissed < WEEK) return
    deferred = event
    banner.classList.remove('is-hidden')
  })
  window.addEventListener('appinstalled', () => banner.classList.add('is-hidden'))
}
