# Dunzo Club

Private mixed poker for one group of 6–8 friends. One active session at a time;
NLH → PLO4 → PLO5, rotating every 2–4 completed hands. Defaults: 25/50 blinds and
2,500 starting chips, with player-selected starting stacks and automatic reloads.

## Current implementation

One URL serves both the React/PWA client and the authoritative Cloudflare server.
The Worker routes HTTP commands and WebSockets to one SQLite-backed `ClubTable`
Durable Object. It serializes commands, saves state and command receipts before
acknowledging, filters private player snapshots, and advances timers using alarms.
The browser runs the engine only for explicitly local practice.

Players select their name from a fixed roster and enter their own **4-digit PIN**.
The server keeps a 30-day HttpOnly login session and a stable database player ID,
so signing in on a different phone recovers the same seat. Players can change their
PIN in the account menu; this signs out their other devices. No club access code,
room-code entry, registration, or public game directory is needed.

The owner manages the static roster directly in the existing SQLite database.
See [player administration](docs/PLAYERS.md) for safe INSERT/reset instructions.
No new database, login provider or shared access secret is required.

Completed sessions remain stored when another session starts. Completed hands
are archived separately from the live room's latest-100-hand view. Closed-session
data remains stored under its internal session ID. Cross-session balance aggregation,
partial external payments, host handover and a full history browser/export remain
backlog work.
Do not treat per-session payment toggles as the planned weekly ledger.

The Cloudflare target is `dunzo-club-staging`:
https://dunzo-club-staging.arun-devanathan.workers.dev/.
The repository remains `arundevanathan/pokerrrr-3`; changing the app's name does not
rename its GitHub URL. No deployment or live-data migration is performed by local
builds. See [Cloudflare setup and release instructions](docs/CLOUDFLARE_STAGING.md).

## Local setup

Use Node >=22.13.0 on PATH and pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm dev:staging
```

Open the printed local URL. Provision your static players using
[the database instructions](docs/PLAYERS.md), select your name and sign in.
Any logged-in player can start the sole game when none is active. Every other
logged-in player sees it immediately and can join with their own starting stack.
There is no access code or game code to share. Practice runs locally without login.
The automatic smoke runner provisions disposable local test accounts itself.

No D1 migration is needed for this multiplayer implementation. The Durable Object
SQLite migration is declared in `wrangler.staging.jsonc`. Local Wrangler manages
a separate local database. Existing D1 migrations remain for provenance; they do
not import original Site balances into the new coordinator.

To preview the built Worker:

```sh
pnpm build:staging
pnpm preview:staging
```

Legacy `pnpm dev` / `pnpm build` framework entry points remain available and route
poker traffic through the same coordinator; login uses the same static player
records. The original Site hosting identity remains in `.openai/hosting.json`.

## Checks

```sh
pnpm test
pnpm test:staging
pnpm typecheck
pnpm build
pnpm build:staging
pnpm check:staging
pnpm test:staging:smoke
```

The smoke runner creates an isolated temporary local database, starts the built
Worker, exercises HTTP/WebSocket multiplayer, restarts the server, checks an
independent alarm and retained sessions, and cleans up. It does not use deployed
storage. It needs a free loopback port 8787. To test another **disposable local**
server, explicitly set `POKER_TEST_URL`, then run
`pnpm test:api`. Both API test paths reject remote URLs. Never point tests at a
live group. Physical 6–8-device/PWA/network-loss acceptance remains required.

## Code map

| Path | Responsibility |
| --- | --- |
| `app/page.tsx` | UI, sounds, animations and local practice controls |
| `lib/client/poker-client.ts` | HTTP command retries, WebSocket snapshots and reconnects |
| `lib/client/practice.mjs` | Explicitly local engine adapter |
| `lib/protocol/poker.mjs` | Versioned, runtime-validated action contract |
| `server/worker-router.ts` | Same-origin API/socket routing and readiness |
| `server/club-table.ts` | Durable Object, serialization, access, private push, alarms |
| `server/table-service.mjs` | Transactional state, idempotency, session/hand archive |
| `server/player-auth.mjs` | Fixed roster, hashed PINs and revocable player sessions |
| `lib/poker.mjs` | Shared tested pure poker rules, secure shuffle and private views |
| `docs/ISSUES.md`, `docs/BACKLOG.md` | Remaining work and acceptance criteria |

Use feature branches and reviewed PRs. A merge can trigger Cloudflare's configured
Git build: review that external automation before merging. Preserve existing
hosting/data until a deliberate release is approved. Never commit secrets or real
player balances. See CONTRIBUTING.md and MIGRATION.md for workflow and provenance.
