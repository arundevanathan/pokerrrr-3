# Dunzo Club: verification and staged implementation plan

Historical verification/proposal below describes the pre-multiplayer baseline.
For the current same-origin implementation, see README.md and
[CLOUDFLARE_STAGING.md](CLOUDFLARE_STAGING.md). Independent client deployment is
not required. Fixed-roster PIN identities now replace the shared-code prototype;
the weekly ledger remains open. See [PLAYERS.md](PLAYERS.md).

Baseline inspected: `82227b55ee5197259cb3c23aa3539e792ef95a96`.
Updated against main `804c4f5` after its practice-only staging changes landed
during verification. The staging source and documentation were also inspected.
Scope: one private group of 6–8 friends, one active session, retained completed
sessions and settlement across sessions (usually weekly). This is a proposal,
not a claim that the architecture below has been implemented.

## Fresh-clone verification

Verified from an empty macOS checkout using Node 24.22.1 and pnpm 11.25.0:

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed after putting Node on PATH |
| `pnpm test` | 39 passed, zero failures |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed; Vinext warns that `/` cannot be statically classified |
| README local D1 migration | Passed against local placeholder database |
| `pnpm start` | Ready on `http://127.0.0.1:8787` |
| `POKER_TEST_URL=http://127.0.0.1:8787 pnpm test:api` | Passed |
| `pnpm dev` | Ready on `http://127.0.0.1:5173/` |
| Browser practice smoke check | Home loaded; practice opened a six-player local hand |

After incorporating main `804c4f5`, reran the 39 engine/presentation tests,
TypeScript and standard production build successfully; the three new staging unit
tests also passed. Local API and browser smoke results above were obtained before
that merge. They are not proof of the staging deployment's behavior.
The new `build:staging`, `check:staging` and local `test:staging:smoke` also passed:
health/version, blocked multiplayer GET/POST, rendered lobby and PWA assets.
No deploy command was run.

The machine initially had pnpm but no Node on PATH; dependency lifecycle scripts
failed until Node was supplied. Registry access and loopback listeners required
desktop sandbox approval. These were environment constraints, not application
failures. No lockfile update was needed. No production credentials, hosting or
data were changed. Local generated databases/builds remain ignored.

Reproduce with the README commands and a supported Node executable on PATH.
Apply the schema only once to a fresh local database. Run API tests only against
the explicitly selected disposable server. The API script currently defaults to
loopback port 4173 if the variable is omitted, so always set it explicitly.

Limits: the API suite uses two independent bearer identities, not two physical
devices or browser contexts. It covers seven hands, three variants, private card
views, chip totals and per-session payment marking. It does not establish restart
recovery, concurrent command safety, timer independence, persistent account login,
cross-session accounting, or installed-PWA behavior. Browser practice was a smoke
check, not a full game acceptance run. CI targets Node 22; this local run used 24.

## What the code actually implements

Inspected all 15 GitHub issue bodies alongside README, CONTRIBUTING, MIGRATION,
ISSUES and BACKLOG. Their acceptance checkboxes remain work to verify; the
documentation alone is not completion evidence.

| Area | Evidence and remaining gap |
| --- | --- |
| Boundaries | `app/page.tsx` imports engine functions for practice and calls same-origin `/api/poker` for multiplayer. `worker/index.ts` routes through Vinext; no independent poker service or versioned wire schema. |
| State | `app/api/poker/route.ts` stores whole room JSON in D1 with version compare-and-swap and up to five retries. Create allows multiple room codes; there is no atomic sole-session constraint. |
| Identity | Page generates `hg-player` in localStorage; API accepts a syntactically valid bearer ID. Engine uses it as player ID and host authority. No account provider, refresh, revocation or group allowlist. |
| Sync/timers | Page polls at 1000ms or 200ms and skips polling when hidden. Route calls engine `tick` on incoming requests; worker has no durable alarm handler. |
| Privacy | Engine `view` removes deck and aliases other bearer IDs, filters cards and sealed votes. Reuse and regression-test this boundary; never broadcast raw room JSON. |
| Retry safety | Some actions check state version; there is no persisted command deduplication. `paid` toggles a per-session payment index, so retrying it can reverse the effect. |
| History | `finish` truncates history to 100 hands in room JSON. Only `poker_rooms` exists in the migration. Closed rooms remain stored, but there is no normalized history or cross-session ledger. |
| Client/CI | Service worker caches only named install assets. CI runs locked install, unit tests, types and build; API integration is absent. |

Main now also includes a standalone practice-only staging target
(`vite.staging.ts`, `worker/staging.ts`, `lib/staging-handler.mjs`) and staging CI
checks. It disables multiplayer and returns 503 for `/api/poker`; it is evidence
of client packaging progress, not an implemented independent multiplayer server.
The existing staging name/configuration is preserved. No remote deployment was
inspected or changed. `docs/CLOUDFLARE_STAGING.md` mentions future PIN sessions;
this is still a proposal, with no PIN authentication implementation in the code.
Resolve that direction alongside the login-provider decision below.

## Stages and review gates

Each stage should be a small sequence of reviewed feature PRs. Keep the existing
Site running until an explicitly approved cutover; none of these stages implies
permission to provision, migrate or publish production resources.

### 0. Reproducible baseline (#12, #11)

Use this verification report as the baseline. Next add a disposable local API CI
fixture, explicit test-target safeguards, and a reproducible start/migrate/test
runner with cleanup. Keep engine and presentation tests intact. Gate: clean
locked install, tests, types, build and isolated API run on CI with no live secrets.
Do not mark #12 complete: multi-device checks and bounded UI extraction remain.

### 1. Contracts and separation (#1, foundation of #4/#14)

Extract client UI/effects, a practice adapter, server command handling, and a
shared protocol package. Preserve `lib/poker.mjs` as the tested engine; browser
practice may import it, but multiplayer clients only send intents and render
server views. Avoid changing game rules during extraction.

Define runtime-validated v1 command envelopes: protocol version, command ID,
session ID, expected state version, hand/turn identifier, command type and payload.
Actor identity comes from authentication, never a trusted client player field.
Define per-player snapshots with state version/server time, acknowledgements,
recoverable stale-state errors and a resync response. Use public player IDs
distinct from credentials. Gate: protocol, privacy and parity tests plus a build
boundary check that multiplayer UI cannot mutate authoritative state.

### 2. Stable identity and private membership (#4, #10, #14)

Select provider and allowlisted membership first. Proposed model: stable internal
user IDs mapped to provider subjects; server-managed renewable sessions in
Secure/HttpOnly cookies, explicit logout/revocation, and account recovery through
the provider. Prefer serving client and API under one origin to simplify cookie
and WebSocket authentication. Enforce membership and host/admin permissions on
every HTTP command and socket connection; validate origin and protect cookie
authenticated writes against CSRF. Never persist bearer secrets in client state.

Provide a reviewed mapping of legacy player IDs to users without changing chips;
do not infer identity from display names. Preserve the source and reconcile
balances before import. Gate: revoked/nonmember access rejected, refresh/logout
tested, seat recovered on a second device, installed iOS/Android persistence tested.

### 3. Durable authoritative coordinator (#2, #8, #9)

Proposed implementation: one Cloudflare Durable Object keyed by this fixed group,
with transactional local storage for table state, accepted command outcomes,
deadlines and an archive outbox. Route all session creation and mutation through
it. Atomically enforce one active session, serialize asynchronous mutations and
persist before acknowledgement. Use cryptographic server shuffling and persist
the remaining deck privately so restart never reshuffles a live hand.

Deduplicate by user/session/command ID with a payload digest; a repeated ID returns
the original outcome, and changed payload reuse fails. Persist hand/turn guards
to reject delayed actions. Alarms process action, sealed vote and next-deal
deadlines idempotently, including after restart. Preserve default Once/unanimous
Twice and sequential payout presentation; enforce payout completion on the server
before manual or automatic deal. Gate: simultaneous start/join/actions, lost-ack
reload retries, restart recovery, alarm races and all-phones-disconnected tests
with invariant chip totals. Implement these guarantees before enabling push play.

### 4. Authenticated real-time client (#3, #10)

Authenticate WebSocket upgrades, authorize membership/seat, validate origin and
bound payload size/rate. Push a separately filtered snapshot to each connection
after a committed change. At this scale full snapshots are simpler than deltas.
Use monotonic state versions and command acknowledgements; ignore older snapshots,
resync gaps and reconnect with bounded exponential backoff/jitter. Disable actions
until resync completes. Define explicit same-player device takeover and authorized
host handover. Timers belong to stage 3 regardless of socket availability.
Gate: no hidden-card/token leakage, refresh/background/offline recovery, stale
messages ignored, and one player cannot control another seat.

### 5. Durable history and cross-session settlement (#5, #6)

Use stable records for sessions, participants, hands, actions, chip transactions,
external transfers and audited reversals. Snapshot display names, rules, blinds
and conversion at session time. Keep completed results independent of active
table JSON and never truncate them when the next session starts.

Proposed archive/query store: D1. A coordinator transaction records an immutable
event/outbox entry together with state; idempotent archive consumers use unique
event IDs and retry on failure. Do not pretend coordinator storage and D1 share
one transaction. Keep the durable source/outbox until archive delivery is proven;
block final settlement publication until archived totals reconcile. Design schema
and outbox before enabling the first new live session so stage 3 cannot lose
history while stage 5 is being completed.

Compute zero-sum player positions across closed sessions using integer chips and
integer money units with an explicit conversion/rounding policy. Record actual
payer/payee/amount/date/recorder transfers with idempotent IDs, partial payments
and reversals; suggestions do not mark payments complete. Carry unpaid balances
forward across weeks. Gate: multiple sessions, partial/retried payments, corrections,
exports and restored backups reconcile exactly. Keep folded cards out of public
history/logs; agree private-card retention before storing additional detail.

### 6. Group UX, operations and release rehearsal (#7, #11, #13–#15)

Review mobile screens for current table/resume, identity, balances and recent
sessions before UI implementation. Configure independent client hosting only
after origin/auth decisions; a static practice demo must clearly disable live
controls without a backend. Test PWA installation/updates without caching private
responses. Rehearse backup restore and rollback in isolated staging, then run a
6–8-device session with phone backgrounding, network loss and server restart.
Gate: zero unexplained chip/ledger difference, access review and signed-off
cutover/rollback procedure. Production migration/publication needs separate approval.

## Decisions needed before implementation

1. **Backend/origin:** approve the proposed Worker + one Durable Object + D1 design,
   and a same-origin client/API approach, or identify hosting constraints. No
   production hosting change is part of this PR.
2. **Login:** Google sign-in with a fixed allowlist, email link login, or another
   provider? Who administers membership and account recovery?
3. **Accounting:** currency, chip-to-money rate, rounding, who records/confirms
   external payments, and who can reverse a mistaken entry. Weekly is a reporting
   period, not an automatic reset or forgiveness rule.
4. **Legacy data:** whether existing live sessions/balances need import; who can
   verify player mapping and opening balances. No production data was inspected.
5. **Control/privacy:** host/admin handover policy, second-device takeover policy,
   and whether historical showdown cards should be retained. Recommended default:
   no folded/private cards in shared history, new device explicitly takes control.

Contract extraction and isolated CI improvements can proceed while these choices
are discussed. Do not silently select identity, financial or retention policies.
