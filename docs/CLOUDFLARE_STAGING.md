# Dunzo Club on Cloudflare

## One app, one URL

`dunzo-club-staging` serves the browser client and the authoritative multiplayer
server at https://dunzo-club-staging.arun-devanathan.workers.dev/.
The GitHub repository remains **arundevanathan/pokerrrr-3**. Preserve both existing
resource identifiers when changing the app's display name.

The Worker exports `ClubTable`, a SQLite-backed Durable Object. One fixed object
name (`dunzo-club`) owns the group's active-session pointer, room snapshots,
command receipts and archived hands/completed sessions. A single transaction saves
an accepted action, its retry receipt and alarm. Alarms continue while every phone
is disconnected. WebSockets receive individually filtered views; no raw deck or
other player's bearer identity is broadcast. HTTP mutations carry protocol version,
command ID, state version and hand ID. Writes are acknowledged only after storage.

## Local verification

Use Node >=22.13.0 and the packageManager pnpm version. No auth secret or
`.dev.vars` is required. Players are inserted into the coordinator's SQLite
`players` table; see [PLAYERS.md](PLAYERS.md).

```sh
pnpm test
pnpm test:staging
pnpm typecheck
pnpm build:staging
pnpm check:staging
pnpm test:staging:smoke
```

The automated smoke test supplies its own disposable player accounts and database,
checks HTTP and private WebSocket updates, restarts the server against that same
local database, waits for a server alarm without client requests, then cleans up.
It refuses remote URLs. Use `pnpm dev:staging` for HMR or `pnpm preview:staging`
for the built Worker. Local testing does not provision or migrate remote storage.

## Deployment preparation (separate from local implementation)

The existing `ClubTable` namespace was introduced by the `dunzo-club-v1`
`new_sqlite_classes` migration. Keep that namespace and migration unchanged.
There is no automatic import from the original Site/D1 database. No D1, R2,
connector or production bindings are allowed in the staging artifact. Never
repurpose a real player's historical balance as staging test data.

Player authentication uses the existing namespace, with additive `players` and
`player_sessions` SQL tables initialized when the object starts. There is no new
namespace or binding migration for PIN login. Existing game/history keys stay
unchanged. `CLUB_ACCESS_KEY` is no longer read; an old configured value can be
removed later. Legacy access cookies and browser bearer IDs no longer authorize
requests. Provision player records before inviting anyone to sign in. If an old
game exists, follow the identity-mapping notes in [PLAYERS.md](PLAYERS.md) before
creating fresh player IDs. No live records are modified by a local build.

Cloudflare build configuration:

- Repository: `arundevanathan/pokerrrr-3`, branch `main`, root `/`.
- Build: `pnpm run build:staging`.
- Deploy: `pnpm run deploy:staging`.
- Runtime: Node 22 (>=22.13.0), pnpm 11.25.0.

The build selects `CLOUDFLARE_ENV=staging` before the Vite plugin runs. The generated
`dist/server/wrangler.json` already contains the selected environment: do not pass
`--env` or alternate binding overrides when deploying it. `dist/` is overwritten
by each build; always rebuild staging before deploying staging. The artifact guard
requires the expected Worker name/environment, one local `ClubTable` binding and
its SQLite migration, and rejects D1, R2 and service bindings. Compatibility date
remains 2026-05-15 for the pinned Wrangler/workerd runtime.

GitHub CI validates builds and performs a dry-run; it does not deploy. Cloudflare's
Git integration may deploy automatically after merge and is an independent pipeline.
Check its state before merging. A production environment, its secrets and storage
must be separately provisioned; never rename this staging namespace to production.

## Release checks and recovery

- `/api/health`: app `Dunzo Club`, environment `staging`, expected commit,
  `mode: multiplayer`, and actual `multiplayerReady`.
- Lobby/installed app show Dunzo Club. Sign-in requires an enabled player and their four-digit PIN;
  unrelated origins and requests without a valid player session are rejected.
- Two independent browser profiles can join, see only their own cards, act,
  refresh/resume and see synchronized versioned state.
- Only one session can be active. End it between hands, start a new one and reopen
  the old session with its original player identity; its results must remain.
- Test phones backgrounded, offline/reconnected and a server restart before real
  use. Confirm all chips and final cash-outs reconcile.

Deployments now contain persistent state. Do not delete/recreate the namespace or
cross a migration boundary as a casual rollback. Stop automatic builds and rehearse
code rollback with schema-compatible state in isolated staging; snapshot/export and
restoration procedures remain issue #15. Keep the immutable source history bundle.

## Remaining limits

There is no public registration or admin API. The owner adds/enables/disables
players directly in the database. PIN recovery/reset is an owner database operation.
Host transfer and a one-active-device policy remain future work. Multiple devices
signed into the same player currently share control of that player's seat.
The current UI shows the latest 100 hands; the server archives every completed hand.
Weekly cross-session aggregation, partial external payments, audited corrections
and archive export/reconciliation remain follow-up work. No claim of full production
acceptance is made by a passing local smoke suite.
