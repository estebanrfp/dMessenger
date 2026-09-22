import { test, expect } from '@playwright/test'

/**
 * Platform check, not an application test.
 *
 * Playwright documents context isolation for cookies, localStorage,
 * sessionStorage and IndexedDB — but not for OPFS, which is exactly where this
 * application's graph lives. It does isolate it; because that is undocumented,
 * this asserts it instead of assuming it, so a browser update that changes it
 * fails loudly here rather than silently invalidating every other test.
 */
test('OPFS is isolated per BrowserContext, shared between tabs of one', async ({ browser }) => {
  const write = (page, content) => page.evaluate(async (text) => {
    const root = await navigator.storage.getDirectory()
    const file = await root.getFileHandle('probe.txt', { create: true })
    const writable = await file.createWritable()
    await writable.write(text)
    await writable.close()
  }, content)

  const read = (page) => page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory()
      const file = await root.getFileHandle('probe.txt')
      return (await file.getFile()).text()
    } catch { return null }
  })

  const alice = await browser.newContext()
  const bob = await browser.newContext()
  const a1 = await alice.newPage()
  await a1.goto('/')
  await write(a1, 'alice-only')

  const a2 = await alice.newPage()          // same context, second tab
  await a2.goto('/')
  expect(await read(a2)).toBe('alice-only')  // tabs share the partition

  const b1 = await bob.newPage()
  await b1.goto('/')
  expect(await read(b1)).toBeNull()          // contexts do not

  await alice.close()
  await bob.close()
})
