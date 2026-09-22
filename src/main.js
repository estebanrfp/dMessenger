/**
 * dMessenger — a messenger on a single GenosDB graph.
 *
 * The database is opened once, at module load, and no second instance is ever
 * created: a second `gdb()` in the same page re-initialises the Security
 * Manager and drops the active signer. Session state drives every branch
 * through `onSession`, so the shell is rebuilt from the engine's truth.
 */
import 'virtual:uno.css'
import './app.css'
import { registerSW } from 'virtual:pwa-register'
import { mountInstallPrompt } from './ui/install.js'
import { ROOM } from './lib/db.js'
import { onSession, logout, abbr } from './lib/identity.js'
import { startConversation } from './lib/conversations.js'
import { createGroup } from './lib/groups.js'
import { send } from './lib/messages.js'
import { sealBody, openBody, mintConversationKey } from './lib/crypto.js'
import { startKeyring, onKey } from './lib/keyring.js'
import { installExpiryGuard, startSweeper, setSpaceTtl } from './lib/expiry.js'
import { publishOwnVouchCount } from './lib/vouches.js'
import { renderLogin } from './ui/login.js'
import { renderSidebar, markRead, highlight, refreshPreview, spaceById } from './ui/sidebar.js'
import { renderThread, renderEmpty } from './ui/thread.js'
import { renderGroupDetails, newGroupDialog } from './ui/group.js'
import { renderGovernance } from './ui/governance.js'
import { renderProfile } from './ui/profile.js'
import { renderSettings } from './ui/settings.js'
import { inviteDialog } from './ui/invite.js'
import { startNames } from './lib/names.js'
import { parseInvite, clearInviteHash } from './lib/invites.js'
import { db } from './lib/db.js'
import { el, clear, shortAddress } from './ui/dom.js'
import { toast } from './ui/toast.js'
import { session } from './lib/identity.js'

const app = document.getElementById('app')

// Point 2 of expiry, installed before any peer traffic is applied: an expired
// message is dropped at the door on every sync path, resurrection included.
installExpiryGuard()

// The app shell and the engine are cached by the service worker, so the page
// opens with no network; the graph itself was already on this device.
registerSW({ immediate: true })
mountInstallPrompt()

let shell = null
let teardownSidebar = null
let openSpaceId = null
let mobilePanel = 'sidebar'
/** Which panel owns the main column: 'empty' | 'thread' | 'details' | 'governance' | 'profile' | 'settings'. */
let view = 'empty'

/**
 * Visibility and content are different nodes on purpose: the responsive
 * toggles live on the outer one, so they can never override the `flex flex-col`
 * the panels need to lay themselves out.
 */
const layout = () => {
  const main = el('main', 'min-h-[100dvh] h-[100dvh] bg-page text-ink overflow-hidden')
  const frame = el('div', 'h-full flex flex-col')
  const split = el('div', 'flex flex-1 min-h-0')
  const asideSlot = el('div', 'md:w-80 lg:w-[22rem] flex-shrink-0 h-full w-full')
  const panelSlot = el('div', 'flex-1 h-full min-h-0 min-w-0 flex')
  const aside = el('div', 'h-full')
  const panel = el('div', 'flex-1 flex flex-col bg-page min-h-0 min-w-0')
  asideSlot.append(aside)
  panelSlot.append(panel)
  split.append(asideSlot, panelSlot)
  frame.append(split)
  main.append(frame)
  return { main, asideSlot, panelSlot, aside, panel }
}

const applyMobilePanel = () => {
  if (!shell) return
  shell.asideSlot.classList.toggle('hidden', mobilePanel !== 'sidebar')
  shell.panelSlot.classList.toggle('hidden', mobilePanel !== 'main')
  shell.asideSlot.classList.add('md:block')
  shell.panelSlot.classList.add('md:flex')
}

const showDetails = async (group) => {
  view = 'details'
  await renderGroupDetails(shell.panel, group, { onBack: () => showSpace(spaceById(group.id) ?? group) })
}

const showSpace = async (space) => {
  openSpaceId = space.id
  view = 'thread'
  mobilePanel = 'main'
  applyMobilePanel()
  highlight(space.id)
  markRead(space.id)
  await renderThread(shell.panel, space, {
    onBack: () => { mobilePanel = 'sidebar'; applyMobilePanel() },
    onDetails: showDetails,
    onProfile: showProfile,
  })
}

const reopen = () => {
  const space = openSpaceId ? spaceById(openSpaceId) : null
  if (space) return showSpace(space)
  view = 'empty'
  return renderEmpty(shell.panel)
}

/** Starts (or finds) the conversation with an address and opens it. */
const openWith = async (address) => {
  const { id } = await startConversation(address)
  const { result } = await db.get(id)
  if (result) await showSpace(result)
}

const showProfile = async (address) => {
  view = 'profile'
  mobilePanel = 'main'
  applyMobilePanel()
  await renderProfile(shell.panel, address, {
    onBack: reopen,
    onMessage: (other) => openWith(other).catch(error => toast(error.message ?? 'Could not start it', 'error')),
  })
}

const showSettings = () => {
  view = 'settings'
  mobilePanel = 'main'
  applyMobilePanel()
  renderSettings(shell.panel, { onBack: reopen, onProfile: () => showProfile(session.address) })
}

const newChatDialog = () => {
  const dialog = el('dialog')
  const input = el('input', 'field mt-3', { placeholder: '0x…', dataset: { testid: 'peer-address' }, autocomplete: 'off' })
  const mine = el('button', 'text-xs mono text-accent mt-2 block', {
    textContent: `Copy my address · ${shortAddress(session.address)}`,
    onclick: async () => { await navigator.clipboard.writeText(session.address).catch(() => {}); toast('Address copied', 'ok') },
  })
  const actions = el('div', 'flex gap-2 justify-end mt-5')
  const cancel = el('button', 'btn-ghost', { textContent: 'Cancel', onclick: () => dialog.close() })
  const start = el('button', 'btn-primary', {
    textContent: 'Start', dataset: { testid: 'start-chat' },
    onclick: async () => {
      const other = input.value.trim()
      if (!/^0x[0-9a-fA-F]{40}$/.test(other)) { toast('That is not an address', 'error'); return }
      start.disabled = true
      try {
        const { granted } = await startConversation(other)
        dialog.close()
        toast(granted ? 'Conversation created and key shared' : 'Conversation created — the key travels once that identity signs in', granted ? 'ok' : 'info')
      } catch (error) {
        toast(error.message ?? 'Could not start it', 'error')
      } finally {
        start.disabled = false
      }
    },
  })
  const invite = el('button', 'btn-ghost w-full flex items-center justify-center gap-2 mt-3', {
    dataset: { testid: 'open-invite' },
    onclick: () => { dialog.close(); inviteDialog({ onAddress: (address) => openWith(address).catch(error => toast(error.message ?? 'Could not start it', 'error')) }) },
  })
  invite.append(el('span', 'i-carbon-qr-code'), document.createTextNode('Share my invite or scan one'))
  actions.append(cancel, start)
  dialog.append(
    el('h2', 'text-lg font-bold', { textContent: 'New chat' }),
    el('p', 'text-sm text-dim', { textContent: 'Paste the address of the peer you want to talk to.' }),
    input, mine, invite, actions,
  )
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  document.body.append(dialog)
  dialog.showModal()
  input.focus()
}

const mountApp = async () => {
  clear(app)
  shell = layout()
  app.append(shell.main)
  renderEmpty(shell.panel)

  await startNames()
  teardownSidebar = await renderSidebar(shell.aside, {
    onSelect: showSpace,
    onNewChat: newChatDialog,
    onNewGroup: () => newGroupDialog(),
    onSettings: showSettings,
    onProfile: showProfile,
    onGovernance: async () => {
      view = 'governance'
      mobilePanel = 'main'
      applyMobilePanel()
      await renderGovernance(shell.panel, { onBack: reopen })
    },
  })

  applyMobilePanel()
  await publishOwnVouchCount().catch(() => {})

  startKeyring()
  startSweeper()

  // An invite link carries an address into this room: open the conversation.
  const invited = parseInvite()
  if (invited && invited.toLowerCase() !== session.address.toLowerCase()) {
    clearInviteHash()
    openWith(invited).catch(error => toast(error.message ?? 'Could not open the invite', 'error'))
  }
  onKey((spaceId) => {
    refreshPreview(spaceId)
    // A new epoch (or a first key) changes what this peer can read, so the
    // thread is repainted — but only when the thread is the panel on screen.
    // Rotating a key is itself something the roster panel does, and repainting
    // over it would tear down the view mid-operation.
    if (view === 'thread' && openSpaceId === spaceId) reopen()
  })
}

const mountLogin = () => {
  teardownSidebar?.()
  teardownSidebar = null
  openSpaceId = null
  shell = null
  clear(app)
  const main = el('main', 'min-h-[100dvh] h-[100dvh] bg-page text-ink overflow-hidden')
  const host = el('div', 'h-full')
  main.append(host)
  app.append(main)
  renderLogin(host)
}

let mounted = null
onSession((state) => {
  const next = state.isActive && state.address ? 'app' : 'login'
  if (next === mounted) return
  mounted = next
  next === 'app' ? mountApp() : mountLogin()
})

document.title = ROOM === 'dmessenger' ? 'dMessenger' : `dMessenger · ${ROOM}`
window.app.logout = logout
window.app.abbr = abbr
// Test surface: a policy shorter than the picker offers, through the real path.
window.app.setTtl = async (spaceId, seconds) => {
  const { result } = await db.get(spaceId)
  return setSpaceTtl(result, seconds)
}
// Test surface: lets the suite assert the ladder's refusal directly, not only
// that the button is disabled.
window.app.createGroup = (name, members) => createGroup(name, members).then(
  (result) => ({ ok: true, ...result }),
  (error) => ({ ok: false, error: String(error?.message ?? error) }),
)

// Measurement surface for the performance suite. Arrivals are stamped in the
// receiver's own map callback — the same path the UI paints from — against the
// sender's `ts`, which on one machine shares the receiver's clock.
window.app.perf = (() => {
  let arrivals = []
  let stop = null
  return {
    watchArrivals: async (spaceId) => {
      stop?.()
      arrivals = []
      const { unsubscribe } = await db.map({ query: { t: 'msg', conv: spaceId } }, (event) => {
        if (event.action === 'added') arrivals.push({ id: event.id, ts: event.value.ts, at: Date.now() })
      })
      stop = unsubscribe
      return true
    },
    arrivals: () => arrivals,
    reset: () => { arrivals = [] },
    /** Sends n messages one after another; each waits for its own put. */
    sendMany: async (spaceId, n, prefix) => {
      const out = []
      for (let i = 0; i < n; i++) {
        const t = Date.now()
        const id = await send(spaceId, `${prefix} ${i}`)
        out.push({ id, putMs: Date.now() - t })
      }
      return out
    },
    /** Sends n messages at once — the worst case for the engine's batching. */
    sendBurst: async (spaceId, n, prefix) => {
      const t = Date.now()
      const ids = await Promise.all(Array.from({ length: n }, (_, i) => send(spaceId, `${prefix} ${i}`)))
      return { sent: ids.length, ms: Date.now() - t }
    },
    /** AES-GCM seal/open of a `bytes`-long text, n times, in microseconds. */
    crypto: async (n = 200, bytes = 1024) => {
      const key = mintConversationKey()
      const text = 'x'.repeat(bytes)
      let t = performance.now()
      const sealed = []
      for (let i = 0; i < n; i++) sealed.push(await sealBody(key, text))
      const sealUs = ((performance.now() - t) * 1000) / n
      t = performance.now()
      for (const s of sealed) await openBody(key, s)
      const openUs = ((performance.now() - t) * 1000) / n
      return { n, bytes, sealUs: Math.round(sealUs), openUs: Math.round(openUs) }
    },
  }
})()
