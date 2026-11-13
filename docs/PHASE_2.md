# Phase 2: social experience and table management

Scope: released game features for production and staging.
The existing betting rules, side-pot calculation, dealing, rotation and settlement
remain authoritative and retain their regression coverage.

## Player experience

- Each game has its own persistent plain-text conversation. The table chat drawer
  supports 500-character messages and earlier-message pagination. Live chat opens
  over the bottom action panel, leaving the felt visible. There is no unread
  badge; live speech bubbles provide the message notification.
  New live messages show five-second speech bubbles near the sender's seat.
  Completed games expose read-only chat from Previous Games → Game Results.
  Personal cards are centered in their row and enlarged, with a slightly shorter
  felt to make room. Player nameplates do not append a redundant “You” label.
- Folded, Away and standing observers can chat and react. Standing observers see
  the same public table view and no private opponent cards during play.
- The reaction catalogue includes Chappal, Cheers, Money Flying, Tomato Splat,
  Crown, Laughing Face, Duck and Punch, each with its own vector animation and
  procedural sound. Tap another player's avatar/name and select an icon. Chappal uses a direct
  250ms flight, contact at 280ms, sharp flick, short jolt and dry whack. No visible
  Chappal label or animation caption. Accessible button names remain.
- Reactions have a durable three-second per-sender cooldown. A maximum of two
  animations plays at once. During all-in votes/runouts/payouts, effects queue;
  every queued effect expires five seconds after acceptance. Long runouts can
  therefore expire an effect entirely. Activity entries remain in chat regardless.
- Reaction sounds have their own saved mute setting in Table Menu, independent
  of game sounds. Browser audio unlock uses normal user gestures; no vibration.
- Stand Up is separate from Exit to Lobby. During a hand, it reserves the seat
  and queues cash-out until all runs, side-pot payouts and payout presentation
  finish. The player can cancel before that boundary. No early fold is imposed.
  An unapplied reload is cancelled when Stand Up is requested.
- After cash-out, the player remains an observer. Re-entry requires an available
  seat and a fresh buy-in; cumulative buy-ins/cash-outs remain under one identity.
- Exit to Lobby preserves chips and the seat, marks a seated player Away and
  navigates only after acknowledgement. Current hand obligations and timeouts
  remain intact. Future deals exclude Away players; opening the table restores
  eligibility. Explicit pending Sit Out/Stand Up is preserved.
- Terminate Game waits for the same hand/payout boundary before final accounting.

## Persistence and concurrency

`SocialService` stores conversation items under a per-game monotonic sequence,
with independent durable request receipts, cooldowns and a bounded effect queue.
Neither messages nor effects mutate room state or poker versions. The existing
serialized coordinator orders requests and alarms, while social deadlines share
the earliest alarm with poker deadlines. Optional social maintenance errors do not
roll back or reject committed poker actions. Reconnect restores history, including
multi-page gaps; expired effects are never replayed. Target identity is retained
internally, and effects are discarded if the target leaves or the seat changes.

`TableService.save` atomically appends buy-in/cash-out audit entries alongside the
room, command receipt, archive and alarm. A versioned key is written once, and
receipt retries do not repeat accounting. Zero-stack departures also have an audit
entry. Existing games get an explicitly marked opening balance rather than
invented historical transactions. No accounting data is embedded in social events.

## Validation

- Engine tests: NLH/PLO4/PLO5, all-ins, two runs, side pots, payout boundaries,
  cancellation, immediate between-hand departures, zero stacks and re-entry.
- Service tests: exactly-once cash-outs/archives across restart, same-seat claims,
  stale commands, receipt rollback and timer recovery.
- Social tests: concurrent ordering, lost acknowledgement/retry, strict limits,
  folded/standing access, 123-message pagination, cross-game isolation, preserved
  poker state, persistent queue/cooldown, two animation slots, expiry and target
  reassignment. React renders text directly and never uses rich HTML.
- Disposable HTTP/WebSocket smoke: three clients, auth and privacy, persistent
  chat across actual process restart, observer effects, no effect replay,
  Stand Up/cancellation wire commands, Away/return, eight hands and three
  variants, independent alarms, retained read-only sessions and weekly settlement.
- TypeScript, staging artifact guards and build validation are release gates.
  Browser review covers the chat drawer, speech bubbles, reaction picker, Stand
  Up menu and cancellation, standing/re-entry and separate sound controls.
