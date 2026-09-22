# dMessenger

**Live: [estebanrfp.github.io/dMessenger](https://estebanrfp.github.io/dMessenger/)** — open it in two browsers, or on two devices, and paste one address into the other's *New chat*.

A private messenger that runs entirely between its users: **one GenosDB graph**, no relays holding messages, no server anywhere in the data path, and a constitution every peer enforces on its own copy.

It exists to answer a specific question — can a full messenger be expressed in GenosDB's own primitives, with nothing added underneath? — and to show what each part of the ecosystem is for when it is: the graph, the Security Manager, ACLs, governance, GenosRTC and the Fallback Server. Everything below is verified by the test suite, in real browsers, over real WebRTC.

What it does: identity with a recovery phrase and a passkey; conversations and groups with a roster and admins; replies and reactions; messages with a lifetime; attachments and voice notes; names, invites by link or QR; a role ladder earned through governance; and it installs as an app that opens with no network.

## One database, three axes of separation

There is exactly one `gdb()` instance for the whole application. A second one in the same page re-initialises the Security Manager and drops the active signer — measurable as an address that turns `null` mid-session — so every aspect is separated *inside* the graph instead:

| axis | mechanism | what it separates |
|---|---|---|
| **kind** | `value.t` + a `db.map` query per view | conversations, messages, identities, keys, vouches |
| **ownership** | `value.owner`, id `${owner}:…` | who may write, link or delete a node — checked by every peer |
| **confidentiality** | an encrypted record + `acls.grant` | who may *read*, enforced by an envelope rather than by topology |

The queries are the routing: a view subscribes to what it paints and the engine sorts, windows and streams it. No router, no store, no parallel array.

## Groups: a roster with a policy

A group is the same private space, plus a roster and a rule about who may change it. The application enforces nothing of its own — it mirrors three engine guarantees:

- **The ladder.** Creating a group needs the `publish` permission, so a `user` cannot and a `manager` can. That is the only thing in the app that makes the role ladder *mean* something, and the tier is reached through governance rather than handed out.
- **Ownership.** The roster is a node owned by its creator; admins are collaborators with `write`. Every peer refuses a roster written by anyone else. A collaborator writes content, never policy — spreading the value is what keeps `owner` and the envelope table intact, and that is what makes their write acceptable everywhere.
- **The envelope.** Membership is a key, not a flag.

### Removal, and why keys come in epochs

Removing a member has to do two incompatible things: stop them reading what comes next, without destroying what came before for everyone else. So the key record holds an **array** of keys and every message carries the epoch it was sealed under:

1. `acls.revoke` takes the member's envelope — which also rotates the record's own key, so they cannot reach the array at all any more.
2. A fresh epoch key is appended, readable only by whoever still holds an envelope.
3. The roster node is updated.

Whoever stayed reads the whole history, before and after. Whoever left reads nothing further — and keeps whatever they already read, which no rotation can take back. Both halves are asserted in `groups.spec.js`.

### A lesson the constitution taught us

The first version of the group test promoted Alice to `manager` with a superadmin's signed decision. It passed, then failed a minute later: the governance rules **govern** the `manager` tier, so the floor rule overwrote the manual assignment on the next 4s cycle. That is the documented behaviour, not a bug — a rule decides over a term. Either keep standing rules to the tiers below the ones you assign by hand, or earn the tier the way the rule describes. The suite now earns it: two signed vouches, published by the subject, and the rule does the rest.

## Disappearing messages: expiry without trusting deletion

The obvious implementation — delete the node when it expires — is wrong here, and the engine says why: **a tombstone lives only in the operation window** (`oplogSize`, 200 by default). A peer that held the message, went away, and comes back after the tombstone has rolled out replicates its full state, and the deleted node walks straight back in. That is documented behaviour, not a bug to patch.

So expiry is a property of the *receiver* — the same place authorization lives — enforced at three points that do not trust each other:

1. **Render.** No honest peer paints a message past its `expiresAt`. A countdown sits on each bubble and the bubble leaves the moment it hits zero.
2. **Ingress.** A `db.use` middleware drops an expired message before it enters the graph, on every sync path — live, delta, and a laggard's `fullStateSync`, which arrives as one operation carrying every node it holds and is filtered node by node. A resurrected message lands nowhere.
3. **Sweep.** Every second the author removes its own expired nodes (the only `remove` every peer will sign off on), and every peer forgets what it holds locally — a foreign node's removal is refused everywhere else, which is exactly right: forgetting is local.

The policy is a `ttl` on the space node. In a 1:1 the initiator owns the node and grants the other side `write` on it, so either may change it and every peer accepts the change; in a group the admins already hold `write`. The message carries its own `expiresAt`, stamped from the policy at send time, so the author's peer needs nobody's cooperation for it to mean something.

What a modified client keeps is out of scope, as it is in every messenger: the guarantee is about honest peers, and it holds without any of them needing the others.

`expiry.spec.js` pins all three points. The third test shrinks the window to three operations, lets a returning device bring the expired node back through its full state, sends a sentinel to prove it is connected, and asserts that nothing expired exists on the honest peer.

## Attachments and voice notes: the honest limit of "the graph is the store"

A file — or a voice note recorded with `MediaRecorder` — is a message whose body is the sealed bytes; name, type and size stay public metadata, like a text message's length. The room replicates every byte of a node to every peer, so attachments are **capped at 512 KB** rather than streamed. That is not a shortcoming to hide: it is what storing in a replicated graph means, and anything larger belongs on an ephemeral channel (the engine's `file-streaming` pattern), not in the graph. The suite sends a real PNG and checks it renders on the other side, checks the cap is refused before anything is sealed, and records a voice note with Chromium's fake audio device and plays it on the other peer.

## Installable, and open with no network

The app is a PWA. The service worker precaches the shell **and the engine** — the five files it is made of, from the CDN — at install time. That matters more than it looks: on a first load the `import` of the engine fires before the worker controls the page, so runtime caching alone would leave the cache empty and the app would not open offline. The suite proves it against the production build: manifest, active worker, engine in the precache, then `setOffline(true)` and a reload that still shows the app. Push notifications are the one thing a serverless design cannot offer: with no server, nothing wakes a closed page.

## Names, invites and settings: what is shared and what is not

A **display name** lives on `user:<address>` — the node the Security Manager maintains and governance reads — and only its owner may write it. So a name is a claim nobody can make on your behalf: a peer that renames somebody else's identity node writes into its own copy and every other peer refuses it. The suite forges exactly that and checks a third, uninvolved peer still knows Alice as Alice — after a sentinel proves the forger's own writes do arrive.

An **invite** is a link (and its QR) carrying an address and this room. Nothing is issued and nothing is redeemed: opening it starts the conversation from the invitee's side, and the key travels the only way it can, as an envelope granted by the owner once both have signed in. Scanning uses the camera and `jsqr`; generation uses `qrcode`.

**Settings** keep two kinds of things apart on purpose. Theme and typing announcements are preferences of this device, in `localStorage`, and survive the session (a mnemonic session does not survive a reload; the theme does). The room, the constitution and the engine version are shared facts every peer must agree on, shown read-only. The passkey is this device's protection of the identity — offered, never assumed.

## Replies and reactions: authorship the graph can vouch for

A **reply** is a `replyTo` field on the message node. No separate edge is needed: the whole value travels under its author's signature, so the reference is as trustworthy as the text. The quote is rendered from what each peer has already decrypted — an original a peer cannot read stays honestly "unavailable" rather than leaking through the reply.

A **reaction** is its own node with a deterministic id, `${reactor}:react:${messageId}`, which does three jobs at once:

- reacting again **replaces** the earlier reaction — one per reactor, by construction;
- removing it is a `remove` that only its owner can sign;
- the id carries the owner prefix the gate enforces on every peer, so **nobody can react in somebody else's name**. A forged reaction lands in the forger's own copy and nowhere else — asserted with a sentinel reaction sent by the same path afterwards, so a missing forgery is a refusal and not a disconnection.

The emoji is sealed under the space key at the current epoch: an outsider sees that a reaction exists, never which one. It inherits its message's expiry and disappears with it.

## How a private conversation works

1. The initiator mints a conversation key and seals it with `db.sm.put` — an encrypted record.
2. `acls.grant(keyId, member, 'read')` wraps that record for each member. Read control is cryptographic: revoking rotates the key.
3. Each message is an ordinary **public, reactive** node whose `body` is ciphertext under that key. Public keeps `db.map` realtime, ordering and pagination working — which `db.sm.map` cannot offer — while the content stays unreadable.
4. The other member never writes to a node it does not own. It *discovers* the conversation, because `members: { $in: [me] }` matches on overlap.

An outsider in the same room replicates every byte of all of it and reads none of it. That is a test, not a claim.

## What each part of the ecosystem is doing here

- **The graph** replaces Dexie/IndexedDB, the sync protocol and the linked-device protocol at once. Messages converge by themselves; there is no delivery code.
- **The Security Manager** is identity (mnemonic + passkey), the role ladder, and ownership enforced on every peer.
- **ACLs** are the key distribution: one envelope per reader, rotated on revoke.
- **Governance** promotes a guest to user by a rule keyed on time the engine itself observed — the one metric a modified client cannot forge — and the decision is a signed node every peer agrees on.
- **GenosRTC** carries typing and presence on a single multiplexed channel, each payload signed with `db.sm.sign` and dropped unless `verify` returns the address it claims.
- **The Fallback Server** is the always-on peer and the local signaling relay the test suite runs against.

## Run it

```bash
pnpm install
pnpm exec playwright install chromium   # once, for the suite
pnpm mint       # a local superadmin for governance (pnpm test does this on its own)
pnpm dev        # http://localhost:5605
pnpm build && pnpm preview   # the production build, as a PWA, on :5608
```

Open two different browsers (or two profiles) on `http://localhost:5605`, join in each, and paste one address into the other's **New chat**.

Two tabs of one browser are **one peer**: they share OPFS, localStorage and a BroadcastChannel, so anything that appears to sync between them proves nothing.

### Availability without a second browser open

```bash
pnpm relay
```

Runs the Fallback Server as an always-on peer with an embedded signaling relay on `:8080`. It holds the graph in SQLite and serves discovery locally, so nothing leaves the machine.

### The constitution

`src/lib/constitution.js` holds it, and it must be identical on every peer and on the Fallback Server. The superadmin addresses come from `VITE_SUPERADMINS` in `.env.local`, compiled into the bundle. `pnpm mint` creates a local one for you — its mnemonic goes to `.secrets/superadmin.json` and its address to `.env.local`, both ignored by git — and `pnpm test` runs it on its own when nothing has been minted yet. Neither file is in the repository: a public demo room with a public superadmin would have no constitution at all.

The base role writes, links and deletes on purpose — an open platform. Every node carries an owner the gate enforces on every peer, so deleting at the floor only ever means deleting your own: the residual risk is spam, never takeover. This was learned the hard way — a `guest` retracting a reaction had its `remove` refused by every other peer until `delete` moved down the ladder.

## Tests

```bash
pnpm test
```

Nineteen specs, one worker, a fresh room per test, discovery on a local relay (and a production build on `vite preview` for the PWA spec):

- **sync** — a message crosses to the other peer *and* the transport is asserted: the busiest succeeded ICE candidate pair across every connection, with bytes on it, read only after the UI assertion. (The *first* succeeded pair is not enough: ICE holds several and only the nominated one carries traffic — a lesson from a test that passed by luck for a week.)
- **crypto** — the negative, with a sentinel: the outsider first proves it is replicating, and only then is its inability to read asserted.
- **governance** — a guest is promoted by a signed decision and a third peer, never involved, agrees.
- **groups** — the ladder refuses a group to a `guest` (in the UI *and* in the engine) and allows it once vouches earn `manager`; and a removed member keeps the past while losing the future, with the outsider sentinel again.
- **attachments** — an image travels sealed and renders on the other peer, the cap is refused before sealing, and a voice note recorded on a fake device is playable on the other side.
- **pwa** — against the production build: manifest, active worker, engine precached, and the app opens with no network.
- **profile** — a name resolves everywhere it is shown and a forged rename of someone else's identity is refused by every peer; an invite link opens the conversation with its author on a fresh device; the theme survives a reload that the session does not.
- **reactions** — a reply quotes the original on both sides; reactions are counted per reactor, replaced on change and removed only by their owner; and a forged reaction in someone else's name is refused by every peer, sentinel included.
- **expiry** — either side of a 1:1 sets the policy and both see it; an expiring message leaves every honest screen and its author removes it from the graph; and a returning device cannot resurrect it once its tombstone has rolled out of a 3-op window — asserted after a sentinel proves the device is replicating.
- **isolation** — a platform check: OPFS is isolated per `BrowserContext` and shared between tabs of one. Undocumented by Playwright, so it is asserted rather than assumed.

## Deploying

The app is static: a build and a place to serve it from. It is published on **GitHub Pages** by `.github/workflows/pages.yml` on every push to `main`. Two build-time settings do all the work:

- `BASE_PATH` — a project site is mounted under its name, so the workflow builds with `/dMessenger/`. Locally and in the test suites it stays at `/`. Every public asset goes through `import.meta.env.BASE_URL`, the manifest and the service worker scope follow it.
- `VITE_SUPERADMINS` — the constitution, as a **repository variable** (an address is public; only the mnemonic is secret, and it never leaves its owner). Without it the public build would have an empty superadmin list, and nobody could ever be promoted.

There is no server to deploy. The public site uses the engine's default signaling relays; run `pnpm relay` anywhere for an always-on peer that also holds the graph while everyone else is away.

## Performance, measured

```bash
pnpm perf
```

A second suite, with numbers instead of booleans, writes `perf-results/report.md`. It measures the application — DOM included — in real Chromium over real WebRTC, with a local signaling relay. On this machine:

| What | Result |
|---|---|
| Cold start — first load, engine from the CDN, until the identity door is on screen | 640 ms |
| Warm start — reload, engine from the browser cache | 226 ms |
| Identity — key pair, mnemonic and volatile session | 97 ms |
| Peer discovery — relay introduction + ICE, until the other peer is seen | ~4 s |
| Key exchange — a conversation opened, envelope granted and delivered | 125 ms |
| Delivery latency, 50 messages one by one | p50 95 · p95 117 ms |
| Burst — 100 messages sent at once, until all are on the other peer | 242 ms total · 2 ms per message |
| HTTP requests made by either peer during 150 messages | **0** |
| **Relay killed after the introduction — messages still delivered** | **20/20**, p50 50 ms |
| Catch-up after a partition — a returning device, 30 messages missed | 452 ms from page load |
| AES-GCM seal / open, 1 KB, per message | 19 µs / 19 µs |

### What "no intermediary" means, and how it is proved

A relay in GenosDB does one thing: it introduces peers. It carries the WebRTC offers and answers so two browsers can find each other, and nothing else — no message ever passes through it, whether it is the public Nostr relays the engine uses by default or one of your own. The suite proves that the only honest way: it runs a relay it can kill. Two peers meet through it, it is killed with `SIGKILL`, the port is checked closed, and twenty more messages arrive at 50 ms. That is only possible if the relay was the introducer and never the carrier. A public relay could not be killed, and with a list of several, killing one would prove nothing.

The other half is the zero: during 150 messages neither peer makes a single HTTP request. Delivery is a WebRTC data channel between the two browsers, and the bytes on the busiest ICE candidate pair say so.

Latency is read the honest way too: the sender stamps `ts` before sealing, the receiver stamps arrival inside the same `db.map` callback the UI paints from. Both peers run on one machine, so their clocks agree and the difference is the whole one-way path — seal, batch, WebRTC, verify, apply, notify.

## What this is not

Honest boundaries, since the point is a technical demonstration:

- **It is not interoperable with anything else.** Identities are GenosDB addresses; there is no federation, no bridge, no native client on the other end.
- **Envelope encryption is not a double ratchet.** A conversation key rotated on revoke gives forward-only access control, not per-message forward secrecy or post-compromise security.
- **A room replicates to everyone in it.** The scope of a database is a community, not a public network of strangers — confidentiality is cryptographic, and metadata (ids, timestamps, the set of readers) is not hidden.
- **Delivery while everyone is offline needs the Fallback Server.** Peers converge when they meet; an always-on peer is what makes them meet at different times.

## Built with

- [GenosDB](https://github.com/estebanrfp/gdb) — the serverless, peer-to-peer graph database with a zero-trust Security Manager this app is built on.
- [minidenticons](https://github.com/laurentpayot/minidenticons) for avatars, [qrcode](https://github.com/soldair/node-qrcode) and [jsqr](https://github.com/cozmo/jsQR) for invites.

## License

[MIT](LICENSE). The engine it runs on, [GenosDB](https://github.com/estebanrfp/gdb), carries its own license.

## Author

Esteban Fuster Pozzi (@estebanrfp) - Full Stack JavaScript Developer
