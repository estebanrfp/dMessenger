/** Tiny DOM helpers. Styling lives in CSS and utility classes, never inline. */

/**
 * Creates an element.
 * @param {string} tag
 * @param {string} [className]
 * @param {object} [props] assigned onto the node (textContent, dataset entries, handlers)
 */
export const el = (tag, className = '', props = {}) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  for (const [key, value] of Object.entries(props)) {
    if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value)
    else node[key] = value
  }
  return node
}

export const $ = (selector, root = document) => root.querySelector(selector)

/** Renders peer-written content as text. Never innerHTML: no server sits in between. */
export const say = (node, value) => { node.textContent = value ?? '' ; return node }

export const clear = (node) => { node.replaceChildren(); return node }

/** A short, monospace address, the way every GenosDB surface shows one. */
export const shortAddress = (address) => address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const day = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

export const formatTime = (ts) => time.format(new Date(ts))

export const formatDay = (ts) => {
  const date = new Date(ts)
  const today = new Date()
  const isToday = date.toDateString() === today.toDateString()
  if (isToday) return 'Today'
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return day.format(date)
}

/** A public asset's URL, wherever the app is mounted (root or a sub-path). */
export const asset = (name) => `${import.meta.env.BASE_URL}${name}`
