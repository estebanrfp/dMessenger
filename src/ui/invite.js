/**
 * The invite modal, as a picker: a QR and a link to
 * share, or the camera to scan someone else's. What the code carries is an
 * address and this room — nothing a server issued, nothing to redeem.
 */
import { el, clear } from './dom.js'
import { session } from '../lib/identity.js'
import { inviteLink, parseInvite } from '../lib/invites.js'
import { toast } from './toast.js'

/**
 * @param {{onAddress: (address: string) => void}} handlers called with a scanned address
 */
export const inviteDialog = async ({ onAddress }) => {
  const link = inviteLink(session.address)
  const dialog = el('dialog', 'w-full max-w-sm', { dataset: { testid: 'invite-dialog' } })
  const close = el('button', 'absolute top-4 right-4 btn-ghost p-2 rounded-full', { title: 'Close', onclick: () => dialog.close() })
  close.append(el('span', 'i-carbon-close text-xl'))
  const title = el('h2', 'text-xl font-bold mb-4 text-center', { textContent: 'Your invite' })
  const body = el('div', 'flex flex-col items-center gap-4')
  const footer = el('div', 'mt-4 pt-4 border-t border-line')
  const toggle = el('button', 'btn-ghost w-full flex items-center justify-center gap-2')
  footer.append(toggle)
  dialog.classList.add('relative')
  dialog.append(close, title, body, footer)

  let scanning = false
  let stream = null
  let frame = null

  const stopCamera = () => {
    cancelAnimationFrame(frame)
    stream?.getTracks().forEach(t => t.stop())
    stream = null
  }

  const showCode = async () => {
    stopCamera()
    scanning = false
    clear(body)
    clear(toggle).append(el('span', 'i-carbon-camera'), document.createTextNode('Scan a code'))
    title.textContent = 'Your invite'
    const { toDataURL } = await import('qrcode')
    const src = await toDataURL(link, { width: 200, margin: 0, color: { dark: '#000000', light: '#ffffff' } })
    const frameNode = el('div', 'bg-white p-4 rounded-md')
    frameNode.append(el('img', '', { src, alt: 'Invite QR code', width: 200, height: 200, dataset: { testid: 'invite-qr' } }))
    const copy = el('button', 'btn-primary w-full flex items-center justify-center gap-2', {
      dataset: { testid: 'invite-copy' },
      onclick: async () => {
        await navigator.clipboard.writeText(link).catch(() => {})
        clear(copy).append(el('span', 'i-carbon-checkmark'), document.createTextNode('Copied'))
      },
    })
    copy.append(el('span', 'i-carbon-copy'), document.createTextNode('Copy link'))
    const actions = el('div', 'w-full space-y-2')
    actions.append(copy)
    if (navigator.share) {
      const share = el('button', 'btn-secondary w-full flex items-center justify-center gap-2', {
        onclick: () => navigator.share({ title: 'dMessenger', url: link }).catch(() => {}),
      })
      share.append(el('span', 'i-carbon-share'), document.createTextNode('Share'))
      actions.append(share)
    }
    body.append(
      el('p', 'text-sm text-dim text-center', { textContent: 'Whoever opens this link or scans this code lands in a conversation with you' }),
      frameNode,
      el('p', 'text-xs mono text-faint break-all text-center', { textContent: link, dataset: { testid: 'invite-link' } }),
      actions,
    )
  }

  const showScanner = async () => {
    scanning = true
    clear(body)
    clear(toggle).append(el('span', 'i-carbon-qr-code'), document.createTextNode('Show my code'))
    title.textContent = 'Scan a code'
    const box = el('div', 'aspect-square w-full rounded-md overflow-hidden bg-black')
    const video = el('video', 'w-full h-full object-cover', { autoplay: true, playsInline: true, muted: true })
    const canvas = el('canvas', 'is-hidden')
    box.append(video, canvas)
    body.append(box)
    if (!navigator.mediaDevices?.getUserMedia) { toast('No camera available here', 'error'); return }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    } catch {
      toast('Camera permission was not granted', 'error')
      return
    }
    video.srcObject = stream
    const { default: jsQR } = await import('jsqr')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const scan = () => {
      if (!scanning) return
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0)
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })
        const address = code && parseInvite(code.data)
        if (address) { dialog.close(); onAddress(address); return }
      }
      frame = requestAnimationFrame(scan)
    }
    frame = requestAnimationFrame(scan)
  }

  toggle.addEventListener('click', () => (scanning ? showCode() : showScanner()))
  dialog.addEventListener('close', () => { stopCamera(); dialog.remove() }, { once: true })
  document.body.append(dialog)
  dialog.showModal()
  await showCode()
}
