/** Deterministic identicon for an address, the same in every peer's browser. */
import { minidenticon } from 'minidenticons'
import { el } from './dom.js'

const cache = new Map()

/**
 * @param {string} address
 * @param {number} [size] pixels
 */
export const avatar = (address, size = 40) => {
  const key = address ?? ''
  if (!cache.has(key)) cache.set(key, `data:image/svg+xml;utf8,${encodeURIComponent(minidenticon(key || 'anon', 70, 55))}`)
  const node = el('img', 'rounded-full bg-field flex-shrink-0', {
    src: cache.get(key), alt: '', draggable: false,
  })
  node.width = size
  node.height = size
  return node
}
