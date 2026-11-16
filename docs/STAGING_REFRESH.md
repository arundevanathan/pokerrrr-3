# Staging refresh

Staging uses branch `staging/prod-refresh`, based on deployed production v2.1.4
(`b04f6507d42b40c57064c6037a85bcf5daa1fabd`) and its release receipt on main.
It replaces the current staging build without merging the old staging experiments.
Cloudflare builds and deploys this branch only to `dunzo-club-staging`. The
staging Durable Object and player roster stay isolated from production. Production
game records and credentials are not part of the copy. See
[CLOUDFLARE_STAGING.md](CLOUDFLARE_STAGING.md) for the build and rollback workflow.

## Game and table changes

- The session length is selected at setup. The default is 60 minutes, with 30 and
  90 minute options. The server starts the timer at the first deal. Any signed-in
  player viewing the table can extend a running session by 15 or 30 minutes from
  Table Menu, including spectators and sitting-out players. Expiry uses the
  same end-of-session path as manual termination. The current hand and payouts
  complete before cash-out. Existing untimed games remain untimed.
- Two consecutive personal turn timeouts while disconnected schedule Sit Out
  after the hand. A successful action or a connected timeout resets the streak.
  Returning players choose Sit In to rejoin the action.
- A player sitting out and outside the current hand can stand up immediately.
  A player participating in the current hand finishes it before the seat is
  released. Rejoining the same game requires the most recent positive cash-out
  amount. Zero cash-outs and new games use normal buy-in rules.
- The acting seat shows a high-contrast countdown, red for the last five
  seconds. Hole cards sort from 2 through Ace. The player's cards and board
  cards use brighter, larger suit symbols.
- The table keeps a fixed-height header and a reserved action-control area
  across showdown. Tied shares within a pot and run animate simultaneously,
  including odd chips. A split names each winner and displays each share.
  Showdown holds the revealed cards for one additional second per run.
- The first table view on initial load and after returning from the background
  is silent. New events play normally once that view arrives.
- Chat no longer closes when the input loses focus briefly. A close button
  remains available, and visible tables reconcile chat over HTTP if a
  WebSocket message is missed. Failed sends retain their draft and retry ID.

## Validation and promotion

Run `pnpm test`, `pnpm typecheck`, `pnpm test:staging`, and
`pnpm build:staging` followed by `pnpm test:staging:smoke`.
Check the staging health endpoint for the branch commit. In two browser
profiles, check chat with the socket available and unavailable, session
extension permissions, reconnect after two timeouts, and tied main and side pots.
Test small mobile layouts and background audio on a physical phone before
promoting the changes to production.
