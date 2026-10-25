# Development backlog

All 15 issues are published on GitHub. See [the issue index](ISSUES.md) for links and suggested order. `issues.json` contains the matching acceptance criteria and published issue numbers. P0 items gate reliable live play; P1 items support usability and operations.

## [W01 / #1](https://github.com/arundevanathan/pokerrrr-3/issues/1) — P0: Separate browser client, game server and shared protocol

The current React page and server import the same pure poker engine, but deployment is coupled to Sites. Create clear client/server boundaries while retaining the existing tested rules.

- [ ] Client contains UI, sound and animations; authoritative multiplayer shuffling, actions and payouts run only on the server.
- [ ] Define versioned client action and per-player snapshot/event contracts.
- [ ] Reuse lib/poker.mjs, keep local practice explicitly separate, and document a one-table architecture.
- [ ] Preserve the current live deployment until the replacement is verified.

## [W02 / #2](https://github.com/arundevanathan/pokerrrr-3/issues/2) — P0: Deploy the game server with one durable table coordinator

Run one authoritative table for the private group. Cloudflare Workers plus a Durable Object is the proposed implementation; confirm the deployment and persistence design before migration.

- [ ] Provision development and production environments with separate storage and secrets.
- [ ] Persist accepted state before acknowledging actions; restore deck, bets, turn and deadlines after restart.
- [ ] Serialize state mutations across asynchronous operations.
- [ ] Allow only one active session for the group, enforced atomically on the server; no room directory, matchmaking or multi-group features.

## [W03 / #3](https://github.com/arundevanathan/pokerrrr-3/issues/3) — P0: Replace polling with authenticated WebSocket synchronization

Current clients poll once a second, or every 200ms during voting/showdown. Push authoritative per-player updates instead.

- [ ] Authenticate connections and authorize group membership and seat access.
- [ ] Use state versions, action IDs and acknowledgements; ignore duplicates and resync gaps.
- [ ] Send a fresh private snapshot after reconnect with bounded retry/backoff.
- [ ] Validate origin and payloads; never send raw deck, other players’ tokens or hidden cards.

## [W04 / #4](https://github.com/arundevanathan/pokerrrr-3/issues/4) — P0: Add persistent player authentication and group access

Use an owner-managed static roster and individual four-digit PINs. Stable player IDs must recover a seat across devices, and signed-in sessions must survive normal app launches.

- [ ] Document the fixed player roster, PIN login/change, owner PIN resets and database provisioning flow.
- [ ] Use stable user IDs and securely persisted, refreshable sessions; avoid reauthentication on every visit while credentials remain valid.
- [ ] Support explicit logout, session revocation and account recovery; expired/revoked sessions can require login.
- [ ] Map existing player/session records to stable identities without changing balances; prevent impersonation and duplicate occupied seats.
- [ ] Test iOS and Android installed PWA session persistence and recovery.

## [W05 / #5](https://github.com/arundevanathan/pokerrrr-3/issues/5) — P0: Persist session and hand history independently of live room state

Current room JSON retains only the latest 100 hands. Completed sessions need durable, queryable history across weeks.

- [ ] Define session, participant, hand, action and chip transaction records linked to stable player IDs.
- [ ] Persist starts, buy-ins, reloads, cash-outs and completed hands with timestamps and stable IDs.
- [ ] Keep historical rules, blinds and names understandable after later profile/config changes.
- [ ] Define visibility and retention of folded/private cards; do not expose them through history or logs.
- [ ] Provide safe backup, restore and export; verify historical totals after restore.

## [W06 / #6](https://github.com/arundevanathan/pokerrrr-3/issues/6) — P0: Build a cross-session ledger and weekly settlement

The group settles several sessions together, rather than settling each session immediately. Current settlement is per closed session.

- [ ] Accumulate each player’s net position across completed sessions with a clearly defined chip-to-money conversion.
- [ ] Record actual transfers with payer, recipient, amount, date and recorder; partial payments reduce outstanding balances.
- [ ] Generate a settlement suggestion across the selected unsettled period without erasing original session results.
- [ ] Make recording/retrying payments idempotent; allow audited corrections and reversals.
- [ ] Prove total player net is zero and show session-by-session reconciliation before and after payments.
- [ ] Carry unpaid balances forward and export a weekly statement; do not automatically forgive balances on a calendar boundary.

## [W07 / #7](https://github.com/arundevanathan/pokerrrr-3/issues/7) — P1: Redesign the home screen for one private group

The current create/join-room landing page was a prototype. A signed-in member should land on the group’s current activity and balance.

- [ ] Design and review mobile screens before implementation.
- [ ] Show Join current table or Resume seat when a session is active; an authorized member can start the sole session otherwise.
- [ ] Show personal outstanding balance, recent sessions and weekly settlement/history entry points.
- [ ] Show member identity and sign-out/account controls; handle empty, loading and disconnected states.
- [ ] Avoid multiple-room discovery, tournaments and public game creation.

## [W08 / #8](https://github.com/arundevanathan/pokerrrr-3/issues/8) — P0: Move action, vote and auto-deal timers fully onto the server

Current tick processing is driven by incoming HTTP requests. Progress must remain correct when every phone backgrounds or disconnects.

- [ ] Persist server deadlines and schedule independent durable alarms for actions, votes and next deal.
- [ ] Process retried alarms idempotently and reschedule the next deadline.
- [ ] Keep the five-second sealed vote, default Once, and unanimous Twice behavior.
- [ ] Use authoritative server presentation timing for sequential runouts/payouts, then the existing three-second next-deal countdown.
- [ ] Reject manual deal or other transitions that bypass an unfinished payout presentation.

## [W09 / #9](https://github.com/arundevanathan/pokerrrr-3/issues/9) — P0: Make game and accounting commands safe under retries and concurrency

State-version compare-and-swap exists, but network retries need command-level deduplication, especially for reloads and future payments.

- [ ] Give every mutating command a unique ID and store its accepted outcome atomically with state.
- [ ] Retrying the same command returns the original outcome with no additional chips, votes or payments.
- [ ] Reject stale hand/turn actions and unauthorized commands with explicit recoverable responses.
- [ ] Test simultaneous joins/actions, reload retry after a lost response, racing vote/deal deadlines and settlement double submission.

## [W10 / #10](https://github.com/arundevanathan/pokerrrr-3/issues/10) — P1: Recover seats after disconnects and support host handover

A host’s phone must not control game availability. Current recovery uses local storage and lacks a host transfer flow.

- [ ] Keep seats and identity across reconnects and device changes with an explicit one-active-player-control policy.
- [ ] Keep server action timers running during disconnects and apply documented check/fold behavior.
- [ ] Allow authorized host/admin handover without revealing private cards or changing ledger balances.
- [ ] Show connection status and resync before enabling actions; document policies for absent players and long inactivity.

## [W11 / #11](https://github.com/arundevanathan/pokerrrr-3/issues/11) — P0: Add multiplayer API and multi-device acceptance tests

39 engine/presentation tests passed on the imported baseline. The existing API integration script was not run during the most recent change and does not cover the full reliability scope.

- [ ] Run the API integration suite against a disposable database in CI.
- [ ] Cover hidden-card/token privacy, unauthorized access, reconnects, command retries, concurrent writes and durable recovery.
- [ ] Cover NLH/PLO4/PLO5, rotation, pot caps, short all-ins, side pots, odd chips, one/two runs and queued reloads.
- [ ] Complete a 6–8-device session with phone backgrounding, network loss, browser refresh and a server restart.
- [ ] Reconcile all starting chips, reloads, cash-outs and cross-session balances with zero unexplained difference.

## [W12 / #12](https://github.com/arundevanathan/pokerrrr-3/issues/12) — P1: Establish reproducible local setup and contributor CI

The imported project uses Vinext, Cloudflare bindings and Sites helper scripts. A fresh clone must work outside the original workspace.

- [ ] Verify locked installation, dev server, local D1 migration, practice mode and two-client multiplayer on a fresh machine.
- [ ] Provide working setup/config examples with no production secrets.
- [ ] Run engine/presentation tests, TypeScript and production build on pull requests; add API tests once its fixture is ready.
- [ ] Document contribution, review and release process and how to run the full checks.
- [ ] Format dense source consistently and split the main page into bounded components without changing game behavior.

## [W13 / #13](https://github.com/arundevanathan/pokerrrr-3/issues/13) — P1: Deploy the client independently and evaluate GitHub Pages demo

GitHub Pages is static hosting. It can serve a browser client but cannot execute the current poker API or database.

- [ ] Choose static client hosting after the client/server separation; GitHub Pages is optional, not a multiplayer backend.
- [ ] If Pages is used, support its project subpath, assets, service worker scope, refresh navigation and configured HTTPS/WSS backend.
- [ ] Make practice-only builds explicitly disable multiplayer controls when no backend is configured.
- [ ] Test iOS/Android PWA installation, updates, persistent auth and cache handling; do not cache private game responses.
- [ ] Confirm Pages plan/access requirements before publishing; do not change repository or website visibility silently.

## [W14 / #14](https://github.com/arundevanathan/pokerrrr-3/issues/14) — P1: Review access controls, privacy and release secrets

This is a private friends-only app. Repository access does not grant game-server administration.

- [ ] Scan tracked files and history for secrets before importing and every release; keep all deployed credentials in secret storage.
- [ ] Audit membership, seat ownership, host/admin operations, HTTP and WebSocket authorization and hidden-information views.
- [ ] Validate action schemas, payload sizes and rates; prevent unauthenticated room enumeration and abusive creation.
- [ ] Keep sensitive cards/tokens out of logs and browser responses; record safe security/operational events.
- [ ] Define deployment permissions and backups independently from collaborator code access.

## [W15 / #15](https://github.com/arundevanathan/pokerrrr-3/issues/15) — P1: Add operational diagnostics, backup verification and rollback

The group needs to recover a session and reconcile chips when something fails.

- [ ] Track safe action IDs, state versions, reconnect/error counts and deadline failures without hidden cards or credentials.
- [ ] Provide documented backup/restore and a tested deployment rollback procedure.
- [ ] Separate staging and live sessions; never let automated tests mutate real ledger data.
- [ ] Document incident handling and reconcile state/ledger invariants after recovery.
