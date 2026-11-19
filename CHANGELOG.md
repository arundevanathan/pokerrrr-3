# Changelog

## v2.1.10 — 19 November 2026

- Use smaller text for Start Game options.
- Show Current Game Rankings in a taller, compact card and remove its CSV export button.
- Use a cartoon chuckle for Haha and foamy beer mugs for Cheers.

[Release notes](docs/releases/v2.1.10.md)

## v2.1.9 — 18 November 2026

- Deal the first hand from any occupied seat. Each buy-in and reload is capped at 100 big blinds. Players can reload again and build larger stacks.
- Free the seat of a busted, disconnected player after two more hands. Closing final rankings returns to the lobby.
- Fit game setup on portrait phones. Open and close table chat without shifting the game view, and clear the chat button highlight after sending.
- Flip flop cards in order, sort revealed hole cards by rank, and suppress the turn sound for queued actions.
- Update Chappal, Tomato Splat, Laughing Face, and Punch. Keep Cheers and remove Money Flying, Crown, and Duck from the picker.

[Release notes](docs/releases/v2.1.9.md)

## v2.1.8 — 18 November 2026

- Keep mobile betting controls and seat action labels visible.
- Improve session extension buttons, reveal flop cards in sequence, and expose opponents’ suits at showdown.
- Remove initials above seats without cards, omit empty games from history, and automatically open an expanded final rankings card.

[Release notes](docs/releases/v2.1.8.md)

## v2.1.7 — 18 November 2026

- Use the recorded Call, Check, Your Turn, Deal and Win sounds. Bets, raises and all-ins use Call. Folds and community-card reveals are silent.
- Deal NLH, PLO4 and PLO5 in the same 1.46 seconds.
- Recover missed chat messages after reconnect, retry uncertain sends without duplicating a confirmed message, and show unread chat and delivery status.
- Archive starting seats and stacks, timestamped betting actions, and dealt cards for newly started hands. The additional hand records are server-only.

Full release notes: [v2.1.7](docs/releases/v2.1.7.md).

## v2.1.6 — 17 November 2026

- Add timed sessions with extensions, automatic sit-out after two disconnected turn timeouts, and same-game re-entry at the last positive cash-out.
- Let players already sitting out stand up immediately when they are outside the current hand.
- Sort hole cards by rank, improve suit and turn-timer visibility, fix Run It Twice card layout, and keep the table layout stable during showdown.
- Animate tied payouts together, recover missed chat messages, and suppress stale sounds when opening or resuming a table.

Full release notes: [v2.1.6](docs/releases/v2.1.6.md).

## v2.1.5 — 16 November 2026

- Remove View Game Chat from completed game results in production.

Full release notes: [v2.1.5](docs/releases/v2.1.5.md).

## v2.1.4 — 16 November 2026

- Send a pending bet over a recovered live connection immediately, even while the HTTP request is still waiting.
- Discard invalid saved commands and show when a betting action is still sending or recovering.

Full release notes: [v2.1.4](docs/releases/v2.1.4.md).

## v2.1.3 — 15 November 2026

- Send bets over the live connection immediately, with a prompt HTTP fallback and one shared command receipt.
- Keep betting available when unrelated table actions change the room version. Reject expired decisions with the latest private table view.

Full release notes: [v2.1.3](docs/releases/v2.1.3.md).

## v2.1.2 — 15 November 2026

- Refresh the table after reconnecting or foregrounding the app, even when the existing WebSocket still responds.
- Release betting controls after a command is acknowledged, definitively rejected, or superseded by newer table state. Back off rate-limited retries.
- Show the current board and enable legal betting on your turn while deal and board animations run.

Full release notes: [v2.1.2](docs/releases/v2.1.2.md).

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
