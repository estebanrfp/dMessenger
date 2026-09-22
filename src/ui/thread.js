/**
 * One space — a conversation or a group. The thread does not care which: the
 * difference is who holds the key and what the header says.
 *
 * Two subscriptions, each owning what it paints and torn down with the view:
 * one over the messages of this space, one over its reactions. Four actions
 * handled explicitly, ordering delegated to the engine, the DOM as the state.
 */
import { el, clear, say, shortAddress, formatTime, formatDay, asset } from './dom.js'
import { avatar } from './avatar.js'
import { session } from '../lib/identity.js'
import { counterpart } from '../lib/conversations.js'
import { keysFor, cachedKeys } from '../lib/keyring.js'
import { watchThread, send, sendFile, readBody, readFile, remove, MAX_FILE_BYTES } from '../lib/messages.js'
import { QUICK_EMOJIS, react, unreact, watchReactions, readEmoji } from '../lib/reactions.js'
import { typing as announceTyping, on as onLive } from '../lib/live.js'
import { db } from '../lib/db.js'
import { TTL_OPTIONS, ttlLabel, normalizeTtl, setSpaceTtl, canSetTtl, isExpired, remaining, countdown, onExpire } from '../lib/expiry.js'
import { toast, confirmDialog } from './toast.js'
import { label, nameOf, onName } from '../lib/names.js'

/**
 * Bubble geometry: one radius everywhere, and a short tail on the corner that
 * points at whoever wrote it — the sender's side, bottom row.
 */
const bubbleClass = (mine) => mine
  ? 'bg-accent text-on-accent rounded-md rounded-br-sm'
  : 'bg-field text-ink rounded-md rounded-bl-sm'

const ACTION = 'w-7 h-7 rounded-full hover:bg-field flex items-center justify-center text-dim hover:text-ink transition-colors'

/**
 * The disappearing-messages picker, as a picker. Items
 * are disabled, never hidden, when this session may not change the policy.
 */
const ttlDialog = async (space, current) => {
  const allowed = await canSetTtl(space)
  const dialog = el('dialog', 'w-full max-w-sm')
  const head = el('div', 'flex justify-between items-center mb-4')
  const close = el('button', 'btn-ghost p-2', { title: 'Close', onclick: () => dialog.close() })
  close.append(el('span', 'i-carbon-close text-xl'))
  head.append(el('h3', 'text-lg font-semibold', { textContent: 'Message lifetime' }), close)
  const list = el('div', 'flex flex-col gap-1', { dataset: { testid: 'ttl-options' } })
  const option = (label, value) => {
    const item = el('button', 'w-full text-left px-4 py-3 rounded-md hover:bg-field transition-colors flex items-center justify-between disabled:opacity-50', {
      dataset: { testid: 'ttl-option', value: String(value ?? 'off') }, disabled: !allowed,
      title: allowed ? '' : 'Only a member with write on this space can change its policy',
      onclick: async () => {
        try { await setSpaceTtl(space, value); dialog.close() } catch (error) { toast(error.message ?? 'Refused', 'error') }
      },
    })
    item.append(el('span', 'text-sm', { textContent: label }))
    if ((current ?? null) === (value ?? null)) item.append(el('span', 'i-carbon-checkmark text-accent'))
    return item
  }
  list.append(option('Off', null))
  for (const o of TTL_OPTIONS) list.append(option(o.label, o.value))
  dialog.append(
    head,
    el('p', 'text-sm text-dim mb-4', { textContent: 'How long a message lives before it is gone. Every honest peer enforces it on its own copy; the author cleans up the graph.' }),
    list,
  )
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  document.body.append(dialog)
  dialog.showModal()
}

let stop = null
let typingTimer = null

/**
 * Renders a space into the main panel.
 * @param {HTMLElement} root
 * @param {object} space conversation or group node
 * @param {{onBack: () => void, onDetails: (group: object) => void}} handlers
 */
export const renderThread = async (root, space, handlers) => {
  stop?.()
  clear(root)
  root.className = 'flex-1 flex flex-col min-h-0'

  const isGroup = space.value.t === 'group'
  const keys = await keysFor(space)
  const readable = keys.length > 0
  const me = session.address?.toLowerCase()
  const isMine = (address) => address?.toLowerCase() === me

  // ── header ───────────────────────────────────────────────────────
  const header = el('header', 'h-14 px-4 flex items-center gap-3 border-b border-line flex-shrink-0 bg-page')
  const back = el('button', 'btn-ghost p-2 rounded-full md:hidden', { onclick: handlers.onBack, title: 'Back' })
  back.append(el('span', 'i-carbon-arrow-left text-xl'))

  const other = isGroup ? null : counterpart(space)
  const who = el('button', 'flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity', {
    dataset: { testid: 'space-header' },
    onclick: () => (isGroup ? handlers.onDetails(space) : handlers.onProfile?.(other)),
  })
  const whoText = el('div', 'flex-1 min-w-0')
  const heading = el('p', `font-medium truncate ${isGroup || nameOf(other) ? '' : 'mono text-sm'}`, {
    textContent: isGroup ? space.value.name : label(other), dataset: { testid: 'space-title' },
  })
  const status = el('p', 'text-xs text-faint')
  whoText.append(heading, status)
  const face = isGroup ? avatar(space.id, 40) : avatar(counterpart(space), 40)
  if (isGroup) face.className += ' rounded-md'
  who.append(face, whoText)

  let currentTtl = normalizeTtl(space.value.ttl)
  const ttlBadge = el('span', 'ml-auto text-xs text-accent', { dataset: { testid: 'ttl-badge' } })
  const menuWrap = el('div', 'relative')
  const menu = el('div', 'absolute right-0 top-full mt-1 w-56 bg-card border border-line rounded-md shadow-card z-50 is-hidden')
  const menuButton = el('button', 'p-2 rounded-full text-dim hover:bg-field hover:text-ink transition-colors', {
    title: 'Chat menu', dataset: { testid: 'chat-menu' }, onclick: () => menu.classList.toggle('is-hidden'),
  })
  menuButton.append(el('span', 'i-carbon-overflow-menu-horizontal text-xl'))
  const ttlItem = el('button', 'btn-ghost w-full text-left flex items-center gap-2 rounded-md border-0', {
    dataset: { testid: 'menu-disappearing' },
    onclick: () => { menu.classList.add('is-hidden'); ttlDialog(space, currentTtl) },
  })
  ttlItem.append(el('span', 'i-carbon-time'), document.createTextNode('Message lifetime'), ttlBadge)
  menu.append(ttlItem)
  menuWrap.append(menuButton, menu)
  header.append(back, who, menuWrap)

  const notice = el('div', 'px-4 py-2 border-b border-line bg-card text-sm text-accent is-hidden', { dataset: { testid: 'ttl-notice' } })
  let noticeTimer = null
  const paintPolicy = (announce) => {
    ttlBadge.textContent = currentTtl ? ttlLabel(currentTtl) : ''
    status.textContent = !readable
      ? 'No key for this space yet'
      : `${isGroup ? `${space.value.members.length} member${space.value.members.length === 1 ? '' : 's'} · ` : ''}sealed for members${currentTtl ? ` · expire after ${ttlLabel(currentTtl)}` : ''}`
    if (!announce) return
    notice.textContent = currentTtl ? `Messages now live for ${ttlLabel(currentTtl)}` : 'Messages now live forever'
    notice.classList.remove('is-hidden')
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => notice.classList.add('is-hidden'), 4000)
  }

  // ── feed ─────────────────────────────────────────────────────────
  const feed = el('div', 'flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-4 min-h-0', { dataset: { testid: 'thread' } })
  const intro = el('div', 'text-center py-8')
  intro.append(
    el('div', 'i-carbon-locked text-4xl text-accent mx-auto mb-2'),
    el('p', 'text-dim', { textContent: 'Sealed for its members' }),
    el('p', 'text-sm text-faint', {
      textContent: isGroup
        ? 'The group key is sealed in the graph and wrapped for each member. Removing one opens a new epoch.'
        : 'The key for this conversation is sealed in the graph and wrapped for its members only',
    }),
  )
  feed.append(intro)

  const typingRow = el('div', 'flex items-end gap-2 mt-1 px-4 is-hidden', { dataset: { testid: 'typing' } })
  const dots = el('div', 'bg-field rounded-lg rounded-bl-sm px-4 py-3 flex items-center gap-1')
  dots.append(el('span', 'typing-dot'), el('span', 'typing-dot'), el('span', 'typing-dot'))
  dots.children[1].style.animationDelay = '0.15s'
  dots.children[2].style.animationDelay = '0.3s'
  typingRow.append(dots)

  // ── composer, with the reply bar above it ────────────────────────
  let replyTarget = null
  const composerWrap = el('div', 'border-t border-line flex-shrink-0 bg-page')
  const replyBar = el('div', 'px-4 pt-2 flex items-center gap-2 is-hidden', { dataset: { testid: 'reply-bar' } })
  const replyQuote = el('div', 'flex-1 min-w-0 text-xs px-3 py-1.5 border-l-2 border-accent/60 bg-accent/10 rounded-sm overflow-hidden')
  const replyWho = el('div', 'font-semibold mb-0.5 text-accent')
  const replyText = el('div', 'text-dim truncate')
  replyQuote.append(replyWho, replyText)
  const replyClose = el('button', ACTION, { title: 'Cancel reply', dataset: { testid: 'reply-bar-close' }, onclick: () => setReply(null) })
  replyClose.append(el('span', 'i-carbon-close text-sm'))
  replyBar.append(replyQuote, replyClose)

  // A pending attachment shows above the composer until sent or dropped.
  let pendingFile = null
  const attachBar = el('div', 'px-4 pt-3 pb-1 is-hidden', { dataset: { testid: 'attach-bar' } })
  const setAttachment = (file) => {
    pendingFile = file
    clear(attachBar)
    attachBar.classList.toggle('is-hidden', !file)
    if (!file) return
    const holder = el('div', 'relative inline-block')
    if (file.type.startsWith('image/')) {
      holder.append(el('img', 'max-h-32 max-w-48 rounded-md object-cover', { src: URL.createObjectURL(file), alt: file.name }))
    } else {
      const chip = el('div', 'flex items-center gap-2 px-3 py-2 bg-field rounded-md')
      chip.append(el('span', `${file.type.startsWith('audio/') ? 'i-carbon-microphone' : 'i-carbon-document'} text-xl text-dim`), el('span', 'text-sm text-dim max-w-32 truncate', { textContent: file.name }))
      holder.append(chip)
    }
    const drop = el('button', 'absolute -top-2 -right-2 w-6 h-6 rounded-full bg-card border border-line flex items-center justify-center text-dim hover:text-ink', {
      title: 'Remove attachment', dataset: { testid: 'attach-drop' }, onclick: () => setAttachment(null),
    })
    drop.append(el('span', 'i-carbon-close text-xs'))
    holder.append(drop)
    attachBar.append(holder)
  }

  const composer = el('form', 'flex items-center gap-2 p-3')
  const picker = el('input', 'is-hidden', { type: 'file', dataset: { testid: 'file-input' } })
  picker.addEventListener('change', () => {
    const file = picker.files?.[0]
    picker.value = ''
    if (!file) return
    if (file.size > MAX_FILE_BYTES) { toast(`Files are capped at ${MAX_FILE_BYTES / 1024} KB: the room replicates every byte to every peer`, 'error'); return }
    setAttachment(file)
  })
  const attach = el('button', ACTION + ' w-11 h-11 flex-shrink-0', {
    type: 'button', title: 'Attach a file', dataset: { testid: 'attach' }, disabled: !readable, onclick: () => picker.click(),
  })
  attach.append(el('span', 'i-carbon-attachment text-xl'))
  const mic = el('button', ACTION + ' w-11 h-11 flex-shrink-0', {
    type: 'button', title: 'Record a voice note', dataset: { testid: 'record' }, disabled: !readable || !navigator.mediaDevices?.getUserMedia,
  })
  mic.append(el('span', 'i-carbon-microphone text-xl'))
  const input = el('input', 'input-box', {
    type: 'text', placeholder: readable ? 'Message' : 'Waiting for the key…', autocomplete: 'off',
    dataset: { testid: 'composer' }, disabled: !readable,
  })
  const submit = el('button', 'btn-primary flex items-center justify-center w-11 h-11 !p-0 flex-shrink-0', {
    type: 'submit', title: 'Send', dataset: { testid: 'send' }, disabled: !readable,
  })
  submit.append(el('span', 'i-carbon-send-alt text-xl'))
  composer.append(picker, attach, mic, input, submit)

  // Voice notes: the recorder takes the composer row while recording —
  // cancel, a red dot with the elapsed time, send.
  const recorderRow = el('div', 'flex items-center gap-2 p-3 is-hidden', { dataset: { testid: 'recorder' } })
  let recorder = null, chunks = [], recordTimer = null, recordStart = 0
  const stopRecorder = () => {
    clearInterval(recordTimer)
    recorder?.stream.getTracks().forEach(track => track.stop())
    recorder = null
    recorderRow.classList.add('is-hidden')
    composer.classList.remove('is-hidden')
  }
  const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(1, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
  const cancelRecording = el('button', 'w-11 h-11 p-0 flex items-center justify-center flex-shrink-0 text-danger hover:opacity-80 hover:bg-field rounded-full transition-colors', {
    title: 'Cancel', dataset: { testid: 'record-cancel' }, onclick: () => { if (recorder) { recorder.onstop = null; recorder.stop() } stopRecorder() },
  })
  cancelRecording.append(el('span', 'i-carbon-close text-xl'))
  const elapsed = el('span', 'text-sm text-dim', { textContent: '0:00', dataset: { testid: 'record-time' } })
  const meter = el('div', 'flex-1 flex items-center gap-3 px-3 py-2 bg-field rounded-full')
  const bar = el('div', 'flex-1 h-1 bg-raised rounded-full overflow-hidden')
  bar.append(el('div', 'h-full w-full bg-danger animate-pulse'))
  meter.append(el('span', 'w-2 h-2 bg-danger rounded-full animate-pulse'), elapsed, bar)
  const sendRecording = el('button', 'btn-primary w-11 h-11 !p-0 flex items-center justify-center flex-shrink-0', {
    title: 'Send voice note', dataset: { testid: 'record-send' }, onclick: () => recorder?.stop(),
  })
  sendRecording.append(el('span', 'i-carbon-send text-xl'))
  recorderRow.append(cancelRecording, meter, sendRecording)

  mic.addEventListener('click', async () => {
    let stream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) }
    catch { toast('Microphone permission was not granted', 'error'); return }
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(m => MediaRecorder.isTypeSupported(m)) ?? ''
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    chunks = []
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    recorder.onstop = async () => {
      const type = recorder.mimeType || mimeType || 'audio/webm'
      const ext = type.includes('webm') ? 'webm' : type.includes('mp4') ? 'm4a' : 'ogg'
      const file = new File(chunks, `voice-${Date.now()}.${ext}`, { type })
      stopRecorder()
      if (!file.size) return
      if (file.size > MAX_FILE_BYTES) { toast(`Voice notes are capped at ${MAX_FILE_BYTES / 1024} KB`, 'error'); return }
      try { await sendFile(space.id, file, { ttl: currentTtl, replyTo: replyTarget?.id }); setReply(null) }
      catch (error) { toast(error.message ?? 'Could not send', 'error') }
    }
    recorder.start(250)
    recordStart = Date.now()
    say(elapsed, '0:00')
    recordTimer = setInterval(() => say(elapsed, mmss(Date.now() - recordStart)), 500)
    composer.classList.add('is-hidden')
    recorderRow.classList.remove('is-hidden')
  })

  composerWrap.append(replyBar, attachBar, composer, recorderRow)

  const setReply = (message) => {
    replyTarget = message
    replyBar.classList.toggle('is-hidden', !message)
    if (!message) return
    say(replyWho, `Replying to ${isMine(message.value.owner) ? 'you' : shortAddress(message.value.owner)}`)
    say(replyText, texts.get(message.id) ?? 'Encrypted message')
    input.focus()
  }

  root.append(header, notice, feed, typingRow, composerWrap)
  paintPolicy(false)

  // The policy lives on the space node; watch it so a change by the other
  // side shows up here, and so the next send stamps the right expiry.
  const { unsubscribe: stopPolicy } = await db.get(space.id, (node) => {
    if (!node) return
    space.value = node.value
    const next = normalizeTtl(node.value.ttl)
    if (next === currentTtl) return
    currentTtl = next
    paintPolicy(true)
  })

  // ── state the DOM cannot hold by itself ──────────────────────────
  const seen = new Map()        // message id -> wrapper element
  const texts = new Map()       // message id -> plaintext, for quotes and the reply bar
  const clocks = new Map()      // message id -> countdown span + message
  const pillRows = new Map()    // message id -> reactions row element
  const urls = new Set()        // object URLs of decrypted files, revoked on teardown
  const reactions = new Map()   // message id -> Map(reaction id -> { emoji, owner })
  let openPicker = null
  let lastDay = null
  let lastAuthor = null

  const closePicker = () => { openPicker?.remove(); openPicker = null }

  /** Groups a message's reactions into pills: emoji · count, mine highlighted. */
  const paintPills = (messageId) => {
    const row = pillRows.get(messageId)
    if (!row) return
    clear(row)
    const groups = new Map()
    for (const { emoji, owner } of reactions.get(messageId)?.values() ?? []) {
      if (!emoji) continue
      const group = groups.get(emoji) ?? { count: 0, mine: false }
      group.count += 1
      if (isMine(owner)) group.mine = true
      groups.set(emoji, group)
    }
    row.classList.toggle('is-hidden', groups.size === 0)
    for (const [emoji, { count, mine }] of groups) {
      const pill = el('button', `text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 transition-colors ${mine ? 'bg-accent/20 border-accent text-accent' : 'bg-card border-line text-dim hover:bg-field'}`, {
        dataset: { testid: 'reaction-pill', emoji, mine: String(mine) },
        title: mine ? 'Remove your reaction' : `React with ${emoji}`,
        onclick: async () => {
          const message = seen.get(messageId)?.message
          if (!message) return
          try { await (mine ? unreact(messageId) : react(space.id, message, emoji)) } catch (error) { toast(error.message ?? 'Refused', 'error') }
        },
      })
      pill.append(el('span', '', { textContent: emoji }), el('span', '', { textContent: String(count) }))
      row.append(pill)
    }
  }

  /** The quick emoji picker, anchored to a bubble's action row. */
  const pickerFor = (message, anchor) => {
    closePicker()
    const picker = el('div', 'absolute bottom-full mb-1 z-50 bg-card border border-line rounded-full px-1.5 py-1 flex gap-0.5 shadow-card', {
      dataset: { testid: 'emoji-picker' },
    })
    for (const emoji of QUICK_EMOJIS) {
      picker.append(el('button', 'w-8 h-8 rounded-full hover:bg-field flex items-center justify-center text-lg transition-colors', {
        textContent: emoji, dataset: { testid: 'quick-emoji', emoji },
        onclick: async () => {
          closePicker()
          try { await react(space.id, message, emoji) } catch (error) { toast(error.message ?? 'Refused', 'error') }
        },
      }))
    }
    anchor.append(picker)
    openPicker = picker
  }

  const paint = async (event) => {
    if (event.action === 'removed') {
      seen.get(event.id)?.remove(); seen.delete(event.id); clocks.delete(event.id); texts.delete(event.id); pillRows.delete(event.id)
      if (replyTarget?.id === event.id) setReply(null)
      return
    }
    if (seen.has(event.id)) return
    if (isExpired(event)) return                  // never painted
    intro.remove()

    const mine = isMine(event.value.owner)
    const isFile = event.value.kind === 'file'
    const text = isFile ? null : await readBody(cachedKeys(space.id), event)
    const blob = isFile ? await readFile(cachedKeys(space.id), event) : null
    if (text !== null) texts.set(event.id, text)
    if (isFile) texts.set(event.id, `📎 ${event.value.name}`)
    const day = new Date(event.value.ts).toDateString()

    const wrap = el('div', 'mt-0.5', { dataset: { testid: 'message', id: event.id } })
    wrap.message = event
    if (day !== lastDay) {
      lastDay = day
      const separator = el('div', 'date-divider flex justify-center py-2')
      separator.append(el('span', 'px-3 py-1 rounded-full text-xs text-dim bg-page/60 shadow-sm', { textContent: formatDay(event.value.ts) }))
      feed.append(separator)
      lastAuthor = null
    }
    const first = lastAuthor !== event.value.owner
    lastAuthor = event.value.owner
    if (first) wrap.className = 'mt-3'
    if (isGroup && first && !mine) {
      wrap.append(el('p', `text-xs text-dim mb-1 ml-1 ${nameOf(event.value.owner) ? '' : 'mono'}`, { textContent: label(event.value.owner) }))
    }

    const line = el('div', `group flex min-w-0 ${mine ? 'justify-end' : ''}`)
    const holder = el('div', 'flex items-end gap-1 max-w-[85%]')
    const column = el('div', 'min-w-0')
    const bubble = el('div', `${bubbleClass(mine)} overflow-hidden`)

    // A reply quotes the original. The quote comes from what this peer has
    // already decrypted; an original it cannot read stays honestly unavailable.
    if (event.value.replyTo) {
      const original = seen.get(event.value.replyTo)?.message
      const quote = el('button', `text-xs text-left w-full px-3 py-1.5 mx-2 mt-2 border-l-2 rounded-sm cursor-pointer overflow-hidden ${mine ? 'border-on-accent/40 bg-on-accent/10 text-on-accent/70' : 'border-accent/60 bg-accent/10 text-dim'}`, {
        dataset: { testid: 'reply-quote' },
        onclick: () => seen.get(event.value.replyTo)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      })
      quote.style.width = 'calc(100% - 1rem)'
      quote.append(
        el('div', 'font-semibold mb-0.5', { textContent: original ? (isMine(original.value.owner) ? 'You' : label(original.value.owner)) : 'Original' }),
        el('div', 'truncate', { textContent: original ? (texts.get(original.id) ?? 'Encrypted message') : 'Message unavailable' }),
      )
      bubble.append(quote)
    }

    let body
    if (isFile && blob) {
      const url = URL.createObjectURL(blob)
      urls.add(url)
      const mime = event.value.mime ?? ''
      if (mime.startsWith('image/')) {
        body = el('img', 'max-h-64 max-w-full rounded-md object-cover mx-2 mt-2 block', { src: url, alt: event.value.name, dataset: { testid: 'file-image' } })
      } else if (mime.startsWith('audio/')) {
        body = el('audio', 'mx-2 mt-2 block max-w-full', { src: url, controls: true, dataset: { testid: 'file-audio' } })
      } else {
        body = el('a', 'flex items-center gap-2 px-4 pt-2 hover:underline', { href: url, download: event.value.name, dataset: { testid: 'file-link' } })
        body.append(el('span', 'i-carbon-document text-xl'), el('span', 'text-sm truncate', { textContent: `${event.value.name} · ${Math.ceil((event.value.size ?? 0) / 1024)} KB` }))
      }
    } else {
      body = el('p', 'whitespace-pre-wrap break-words px-4 pt-2', { textContent: text ?? '🔒 Encrypted — this peer holds no key for it' })
      if (text === null) body.className += ' italic text-dim'
    }
    const meta = el('div', `text-[0.65rem] px-4 pb-2 mt-1 flex items-center gap-1 ${mine ? 'text-on-accent/70' : 'text-faint'}`, { textContent: formatTime(event.value.ts) })
    if (typeof event.value.expiresAt === 'number') {
      const clock = el('span', 'inline-flex items-center gap-0.5', { dataset: { testid: 'countdown' } })
      clock.append(el('span', 'i-carbon-time text-[0.7rem]'), document.createTextNode(countdown(remaining(event))))
      meta.append(el('span', '', { textContent: '·' }), clock)
      clocks.set(event.id, { clock, message: event })
    }
    bubble.append(body, meta)

    const pills = el('div', `flex flex-wrap gap-1 mt-1 is-hidden ${mine ? 'justify-end' : ''}`, { dataset: { testid: 'reactions', for: event.id } })
    pillRows.set(event.id, pills)
    column.append(bubble, pills)

    // Hover actions: reply and react for everyone, delete for the author.
    const actions = el('div', 'relative opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 flex-shrink-0')
    const reply = el('button', ACTION, { title: 'Reply', dataset: { testid: 'reply-action' }, onclick: () => setReply(event) })
    reply.append(el('span', 'i-carbon-reply text-sm'))
    const emoji = el('button', ACTION, {
    title: 'React', dataset: { testid: 'react-action' },
    onclick: (e) => { e.stopPropagation(); pickerFor(event, actions) },   // or the feed would close it in the same click
  })
    emoji.append(el('span', 'i-carbon-face-add text-sm'))
    actions.append(reply, emoji)
    if (mine) {
      const del = el('button', ACTION, {
        title: 'Delete', dataset: { testid: 'delete-message' },
        onclick: async () => {
          if (!await confirmDialog('Delete message?', 'It disappears for every peer that accepts the operation — and only its owner can sign one.')) return
          await remove(event.id)
          toast('Message deleted', 'ok')
        },
      })
      del.append(el('span', 'i-carbon-trash-can text-sm'))
      actions.append(del)
    }

    mine ? holder.append(actions, column) : holder.append(column, actions)
    line.append(holder)
    wrap.append(line)
    feed.append(wrap)
    seen.set(event.id, wrap)
    paintPills(event.id)
    feed.scrollTop = feed.scrollHeight
  }

  const { unsubscribe } = await watchThread(space.id, paint)

  // Reactions may arrive before their message; they are kept and painted
  // when it does. A reaction this peer cannot open simply has no emoji.
  const { unsubscribe: stopReactions } = await watchReactions(space.id, async (event) => {
    const messageId = event.value?.msg ?? [...reactions.entries()].find(([, m]) => m.has(event.id))?.[0]
    if (!messageId) return
    if (event.action === 'removed') {
      reactions.get(messageId)?.delete(event.id)
    } else {
      if (!reactions.has(messageId)) reactions.set(messageId, new Map())
      reactions.get(messageId).set(event.id, { emoji: await readEmoji(cachedKeys(space.id), event), owner: event.value.owner })
    }
    paintPills(messageId)
  })

  // One interval for every countdown on screen; an expired bubble leaves at once.
  const ticker = setInterval(() => {
    const now = Date.now()
    for (const [id, { clock, message }] of clocks) {
      if (isExpired(message, now)) { seen.get(id)?.remove(); seen.delete(id); clocks.delete(id); continue }
      clock.lastChild.textContent = countdown(remaining(message, now))
    }
  }, 1000)
  const offExpire = onExpire((id) => { seen.get(id)?.remove(); seen.delete(id); clocks.delete(id) })

  const offName = onName((address) => {
    if (!other || other.toLowerCase() !== address) return
    say(heading, label(other))
    heading.classList.toggle('mono', !nameOf(other))
    heading.classList.toggle('text-sm', !nameOf(other))
  })

  const offTyping = onLive('typing', (payload, from) => {
    if (payload.conv !== space.id || isMine(from)) return
    typingRow.classList.remove('is-hidden')
    clearTimeout(typingTimer)
    typingTimer = setTimeout(() => typingRow.classList.add('is-hidden'), 2500)
  })

  input.addEventListener('input', () => announceTyping(space.id))
  feed.addEventListener('click', (e) => { if (openPicker && !openPicker.contains(e.target)) closePicker() })

  composer.addEventListener('submit', async (event) => {
    event.preventDefault()
    const text = input.value.trim()
    const file = pendingFile
    if (!text && !file) return
    input.value = ''
    const replyTo = replyTarget?.id
    setReply(null)
    setAttachment(null)
    try {
      if (file) await sendFile(space.id, file, { ttl: currentTtl, replyTo })
      if (text) await send(space.id, text, { ttl: currentTtl, replyTo: file ? undefined : replyTo })
    } catch (error) {
      toast(error.message ?? 'Could not send', 'error')
    }
  })

  input.focus()
  stop = () => {
    unsubscribe?.(); stopReactions?.(); stopPolicy?.(); offTyping(); offExpire(); offName(); closePicker()
    if (recorder) { recorder.onstop = null; recorder.stop() }
    stopRecorder()
    urls.forEach(url => URL.revokeObjectURL(url))
    clearTimeout(typingTimer); clearTimeout(noticeTimer); clearInterval(ticker)
  }
  return stop
}

/** The empty state shown when no space is open. */
export const renderEmpty = (root) => {
  clear(root)
  root.className = 'flex-1 flex flex-col items-center justify-center bg-page p-8 text-center'
  root.append(
    el('img', 'w-16 h-12 mb-4 opacity-40', { src: asset('logo.svg'), alt: '', draggable: false }),
    el('h2', 'text-xl font-bold mb-1', { textContent: 'No conversation open' }),
    el('p', 'text-dim max-w-sm', { textContent: 'Start one with another address, or create a group. The key is sealed in the graph and shared only with its members.' }),
  )
}
