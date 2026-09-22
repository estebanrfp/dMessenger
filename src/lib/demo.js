/**
 * Demo identities — the canonical set of the GenosDB design guide (§4.5),
 * copied verbatim and never extended. They are public, throwaway identities
 * (they protect nothing) so that any two windows of the demo can sign in with
 * a single click and already know each other: the trust model, shown working.
 *
 * They exist only for the demo constitution. A deployment with its own
 * `VITE_SUPERADMINS` gets no demo buttons — the canonical superadmin would not
 * be in that constitution, and a production app has no mnemonic in its source.
 */
export const SUPERADMIN = {
  name: 'Superadmin', emoji: '🛡️',
  // TESTING ONLY: one-button governance authority for this demo.
  mnemonic: 'panic now afford carbon donate lecture drift excite collect essay stuff prosper',
  address: '0xbfDe0eCEC5332Fd86D2570085571D6051Df098dA',
}
export const ALICE = {
  name: 'Alice', emoji: '👩‍🦰',
  mnemonic: 'prosper fossil kitten crisp view spread jeans shield prosper myself awake usage',
  address: '0x3546D4BA0ac3bfDea3F1511F82a078DDdb3F4931',
}
export const BOB = {
  name: 'Bob', emoji: '👨‍🦱',
  mnemonic: 'salmon grant recall neutral banner glow pluck divert cactus theory rally ship captain shaft cactus',
  address: '0x8089C0480139d85D82c1E20eeF08a77EF8cD7DEC',
}
export const DEMO_IDENTITIES = [SUPERADMIN, ALICE, BOB]
