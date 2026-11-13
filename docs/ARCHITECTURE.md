# Architecture

Dunzo Club serves a React PWA and its multiplayer API from the same Cloudflare
Worker. Vinext/Vite builds the app. One SQLite-backed `ClubTable` Durable Object,
selected by the fixed name `dunzo-club`, coordinates the private group.

## Request flow

1. `worker/staging.ts` sends API and WebSocket requests to `server/worker-router.ts`; other requests go to the app renderer.
2. The router validates the origin and forwards to the group's Durable Object.
3. `server/club-table.ts` authenticates the player and serializes HTTP, socket callbacks and alarms.
4. `lib/protocol/poker.mjs` validates commands, including protocol version, unique command ID and state/hand guards.
5. `server/table-service.mjs` applies `lib/poker.mjs` rules within a storage transaction and saves the state, command receipt, archives and next alarm before acknowledgement.
6. Each socket receives a separately filtered snapshot. The browser ignores older state versions and retries unconfirmed commands with the same command ID.

Player actions use HTTP; WebSockets push snapshots and handle ping/resync.
Alarms drive action timeouts, runout voting and the next deal without connected clients.

## Storage

All multiplayer data lives in the same Durable Object's SQLite-backed storage.

| Record | Contents |
| --- | --- |
| SQL `players` | Stable UUID, unique name, salted PIN hash, account status and lockout state |
| SQL `player_sessions` | Hashed login tokens, expiry and authentication version |
| `active` | The sole active room code |
| `room:<code>` | Full authoritative room, including the private deck and current hand |
| `command:<player>:<id>` | Payload signature and acknowledgement for retry deduplication |
| `hand:<code>:<number>` | Completed hand archive |
| `session:<code>` | Completed session results, independent of the active room |

The D1/Drizzle files preserve the original hosting integration and are not used
by the multiplayer coordinator. Local Wrangler state is separate from deployed data.

## Rules and invariants

- Chips are integers. Buy-ins, stacks and cash-outs must reconcile.
- Only one session is active. Seat claims and buy-ins commit together.
- The engine handles NLH, PLO4 and PLO5; Omaha uses exactly two hole cards and three board cards.
- Shuffling uses cryptographic Fisher–Yates with rejection sampling.
- Side pots follow contribution levels. Uncalled excess is returned; odd chips are distributed deterministically.
- Two runouts require every eligible voter to choose Twice and enough undealt cards. Missing choices default to Once.
- Payout animation deadlines are enforced by the server before another deal or pending termination.
- `view()` removes the deck, hides unrevealed cards and sealed votes, and aliases other players' IDs. Never broadcast the stored room directly.
- Four-digit PINs use salted PBKDF2 hashes. Login sessions use HttpOnly cookies and expire after 30 days; changing a PIN revokes other sessions.

## Client and presentation

`app/page.tsx` coordinates the table. Lobby, history, runout voting and chip motion
have separate components. `lib/table-presentation.mjs` defines shared timing;
`lib/use-table-effects.ts` and `lib/poker-audio.ts` handle browser effects.

`lib/client/poker-client.ts` owns multiplayer transport and pending-command recovery.
The server runs the game engine for all tables.

The service worker caches install assets only. Private game responses stay on the
network. History and settlement use India calendar dates; suggested transfers
aggregate completed sessions and apply the Dunzo/Ishita offset first.

## Verification

`pnpm test` covers rules, presentation, transactional server behavior, authentication
and history. `pnpm test:staging` checks readiness and deployment guards. The local
smoke runner checks HTTP/WebSocket play, restart recovery and independent alarms
using disposable storage. See [deployment instructions](CLOUDFLARE_STAGING.md)
for the build and release commands.
