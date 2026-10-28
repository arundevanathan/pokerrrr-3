# Changelog

## Staging — Test UI lab, 28 October 2026

- Add guided Quick/Full/Custom review, direct scenario selection and seeded simulation.
- Cover 2–8 players, all three variants, own/opponent/tied winners, two runouts,
  side pots, returns, post-hand actions, chat and player lifecycle controls.
- Add virtual-clock pause/replay/step, viewport previews, explicit review marks and
  downloadable/copyable reproduction reports.
- Replace separate practice previews with Test UI and wire Simulate players into Start Game.
- Add isolated real-Worker test sessions, synthetic identities, scoped cookies and
  HTTP/socket/lost-reply/offline-reload fault controls; ordinary staging data is separate.
- Gate all test pages and endpoints out of production; add scenario-matrix and
  real-Worker isolation/restart checks to CI. See [Test Lab](docs/TEST_LAB.md).

## Staging — Phase 1 integration, 28 October 2026

- Centre opponent wagers close below their nameplates; keep the local wager above.
- Integrate Aditya Roongta’s PR #35: authenticated player-scoped JSON/CSV action
  history, Rabbit Hunt, voluntary reveals and app build disclosure.
- Show voluntary reveals at the player’s seat as well as in history. Preserve the
  existing five-card winner highlights and compact result layout.
- Correct blind sizes and short-table position labels in CSV exports; prevent
  build metadata from widening the table or keyboard typing view.
- New private-card/action archives apply to newly dealt hands. Earlier records
  are not reconstructed; use new hands for acceptance testing.
- Detailed combined staging test guide: [Table actions](docs/TABLE_ACTIONS.md).


## v2.1.1 — 28 October 2026

Priority connection-recovery fix.

- Automatically reconcile pending actions after connection loss or reload; stale actions cannot block later turns or execute on a new hand.
- Reuse durable command receipts across HTTP and authenticated WebSocket delivery, preventing duplicate bets when replies are lost.
- Fall back to HTTP snapshots when the socket is unavailable; reconnect without an HTTP session preflight.
- Verify sessions before signing players out on socket policy closes; retry identity restoration after an offline reload.
- Show Disconnected on seats using heartbeat/poll leases while retaining chips, seats and future-hand eligibility. Existing timers continue normal check/fold behaviour.
- Added nine recovery tests, actual-Worker presence/receipt coverage and five browser fault-injection scenarios.

Full release notes: [v2.1.1](docs/releases/v2.1.1.md).

## v2.1.0 — 27 October 2026

Production update from baseline `309fd214b02015a111b1026a89cadecf0b1d6135`.

- Simplified six-action table menu with separate Stand Up and Terminate confirmations.
- One saved mute control for game and reaction audio.
- Bottom-right compose button, speech bubbles and expandable game-specific chat history.
- Dedicated typing view keeps the full board, pot, personal cards and action buttons visible above the keyboard.
- Raise… exits typing and opens amount selection without placing a bet; Send closes the keyboard immediately.
- Keyboard resizing/panning fixes, retained drafts and retry feedback; removed the action-button group glow.
- Moving centre-to-player turn beam and a clearer acting-seat outline/countdown.
- Opponent card backs peek above nameplates until revealed; local bet badge sits above the seat.
- Winner and hand details below each board, exact-five card highlights and combined awards when one player wins all pots on a board.
- Uncalled contributions return before runout voting/showdown and are excluded from winnings. Returns persist in hand history/accounting and cannot double-credit on retries or restart.
- Added browser regression coverage across four screen sizes, all variants, keyboard panning, touch actions and two-board showdowns.

Full release notes: [v2.1.0](docs/releases/v2.1.0.md).
