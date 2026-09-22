/**
 * Conversation content encryption.
 *
 * GenosDB decides *who may read* a record (an envelope per reader, rotated on
 * revoke). This module decides *what the bytes look like* for a message that
 * must stay public and reactive under `db.map` — the sealed-field pattern, with
 * a key shared by more than one reader.
 *
 * The conversation key itself never travels in the clear: it lives in an
 * encrypted record (`db.sm.put`) and reaches each member through `acls.grant`.
 * WebCrypto is the browser's own; no third-party crypto library is involved.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

/** Generates a fresh 256-bit conversation key, as a hex string. */
export const mintConversationKey = () =>
  [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('')

const hexToBytes = (hex) => Uint8Array.from(hex.match(/.{2}/g).map(b => parseInt(b, 16)))

/** Base64 in chunks: a spread over a large array would overflow the call stack. */
export const bytesToBase64 = (bytes) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export const base64ToBytes = (s) => {
  const binary = atob(s)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const toB64 = bytesToBase64
const fromB64 = base64ToBytes

const importKey = (hexKey) =>
  crypto.subtle.importKey('raw', hexToBytes(hexKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])

/**
 * Seals a message body under the conversation key.
 * @param {string} hexKey conversation key
 * @param {string} text plaintext
 * @returns {Promise<string>} `iv.ciphertext`, both base64 — safe in a public node
 */
export const sealBody = async (hexKey, text) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await importKey(hexKey)
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)))
  return `${toB64(iv)}.${toB64(cipher)}`
}

/**
 * Opens a sealed body. Returns null when the key does not fit — which is what a
 * peer holding the ciphertext without an envelope sees, and what the UI renders
 * as an unreadable message rather than as an error.
 * @param {string} hexKey conversation key
 * @param {string} sealed value produced by `sealBody`
 * @returns {Promise<string|null>}
 */
export const openBody = async (hexKey, sealed) => {
  try {
    const [ivB64, cipherB64] = String(sealed).split('.')
    if (!ivB64 || !cipherB64) return null
    const key = await importKey(hexKey)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(cipherB64))
    return dec.decode(plain)
  } catch {
    return null
  }
}

/** Deterministic conversation id for a pair of addresses, order-independent. */
export const pairId = async (a, b) => {
  const seed = [a.toLowerCase(), b.toLowerCase()].sort().join('|')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(seed)))
  return [...digest.slice(0, 16)].map(x => x.toString(16).padStart(2, '0')).join('')
}
