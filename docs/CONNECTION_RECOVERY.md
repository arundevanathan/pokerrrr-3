# Connection recovery

A lost connection preserves the seat, stack and eligibility for subsequent hands.
It does not set Away/Sit Out. The server keeps the turn timer running and applies
the existing automatic check/fold rule when time expires.

## Recovery behaviour

- An offline reload retries identity restoration automatically, without requiring
  another sign-in or refresh.
- The client heartbeats every three seconds and replaces an unresponsive socket.
- No HTTP session preflight gates a new WebSocket connection. A socket close,
  including code 1008, is not proof of logout; only a confirmed missing session
  sends the player to sign-in.
- Failed HTTP poker requests fall back to the authenticated WebSocket, retaining
  the original command ID and version/hand guards. Both transports use the same
  server execution path, receipts, validation and player rate limit.
- When both transports fail, retain the pending envelope and reconcile it
  automatically on recovery, including after reload. Accepted actions replay
  their acknowledgement without applying twice. Stale, unaccepted actions are
  rejected and cleared; they cannot become an action on a later turn/hand.
- When the socket is unavailable, HTTP snapshots poll approximately every three
  seconds and allow play from fresh authoritative state. Reactions remain live
  socket events; chat continues to use its existing HTTP endpoint.
- Other players see Disconnected after a socket closes or its 15-second presence
  lease expires. HTTP snapshot polling also renews presence. A second healthy
  device keeps the player connected. Presence is separate from the room/version,
  accounting and eligibility; it never exposes account IDs or hidden cards.
- The same Durable Object alarm schedules game deadlines and presence expiry.
  Connection metadata survives socket hibernation; no namespace migration is used.

## Staging: state freshness and free-check protection

Full game-state freshness is independent of heartbeat/chat traffic. During an
active hand, runout vote or showdown, the client polls the authoritative table
when no accepted full snapshot has arrived for six seconds. It also performs an
HTTP snapshot audit at least every twelve seconds even if socket snapshots are
arriving. Both checks run on the existing three-second heartbeat, subject to
network response times. A known table is fetched before the lobby, so a slow
lobby cannot block same-hand recovery. Older snapshots cannot roll state back.
Recovery reads snapshots only; it never creates a new betting command.

Directly tapping Fold when Check is free opens a confirmation with a prominent
Check button and a secondary Fold Anyway button. The server turn clock keeps
running. Confirmation is scoped to the exact table, player, hand, street and
betting decision; it closes if that decision changes. Existing queued Check/Fold
behaviour remains unchanged and does not prompt.

These changes harden recovery against stale views. They do not establish the
cause of the reported 20 November client freeze; the hand CSV has no action
clock or timeout columns, and client receipt/render diagnostics were unavailable.

## Automated checks

`pnpm test` includes `tests/recovery.test.mjs`: lost accepted replies, HTTP-only
failure with a healthy socket, both transports failing, stale action rejection,
next-hand eligibility/action, restored pending commands after reload, session
validation, HTTP snapshots and presence leases/multiple devices.

`pnpm test:staging:smoke` uses disposable local storage and the actual Worker.
It covers presence broadcast on disconnect/reconnect, preserved chips and seat,
HTTP-to-WebSocket receipt replay, stale socket-command rejection, player-ID/card
privacy and the existing multiplayer, restart, timer and accounting checks.

After `pnpm build:staging`, optionally run:

```sh
POKER_BROWSER_EXECUTABLE=/path/to/chromium node scripts/table-ui-smoke.cjs
```

The browser suite runs the compiled React UI with intercepted local APIs and
real TableService fixtures. It deliberately drops HTTP requests before delivery,
drops a reply after acceptance, disables both transports until a turn expires,
disables WebSockets while HTTP works, and boots offline before connectivity returns. It asserts recovery without another
sign-in or manual Retry, exact-once chip changes, and no page errors. It also
runs the existing mobile layout checks at four viewport sizes.

## Two-phone staging acceptance test

Use https://dunzo-club-staging.arun-devanathan.workers.dev/ with test chips only.

1. Join from two phones (a third player helps distinguish a missed turn from the
   next hand). Use a 10-second timer.
2. On phone A, disable both Wi-Fi and mobile data or use airplane mode. Keep phone
   B connected. B should show A as Disconnected within about 15 seconds; the turn
   timer must keep running.
3. Leave A offline beyond its turn. The server should check if possible, otherwise
   fold. Nobody should need to end/restart the game.
4. Restore A's connection. Do not tap Retry or sign out. A should receive current
   state and regain controls on its next eligible turn. B's Disconnected label
   should disappear. Verify the seat, stack and buy-ins remain correct.
5. Repeat while A taps Call, backgrounds the app and switches between Wi-Fi and
   mobile data. A call may be accepted once or expire; it must never be duplicated
   or execute on a later turn. Check that foregrounding/reopening restores play.
6. Open the same player on a second device. Losing only one device must not mark
   the player disconnected while the other continues heartbeating.

Browser fault injection is deterministic. Physical Android/iOS keyboard,
background-suspension and network-switch behaviour still need the phone checks.
This recovery behaviour ships in production v2.1.1. Use staging for deliberate fault injection.
