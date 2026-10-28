# Staging Test UI lab

Open `/test-lab` or choose **Test UI** on the staging home screen. Production
returns 404 for both lab pages and all `/api/test-lab/*` endpoints.

## Human review

- **Quick Review**: 12 representative cases. **Full Review**: every catalogue
  scenario except continuous simulation. **Custom Review**: choose a subset.
- **Choose Scenario**: jump directly to a specific condition. Change players
  (2–8), NLH/PLO4/PLO5, viewpoint, seed and viewport, then Apply/reset.
- Local cases open paused at their target condition, except Deal which starts
  at the beginning of the animation. Replay transition starts at the first
  checkpoint. Pause, Step and the checkpoint slider permit repeatable inspection.
- Play/bots advances local time and opponent actions; your own turn remains
  yours until its timer expires. Use Step to advance any actor deliberately.
- Looks good and Flag issue are explicit review decisions; navigation never
  passes a case. Flag requires a note. Results are stored in this browser and
  keyed by build, configuration, backend and viewport. Copy/download the report
  before switching browser or clearing browser storage.
- Reports contain build revision, seed, settings, checkpoint, action information,
  expected engine outcome, viewport and notes. They do not contain a screenshot;
  attach a native/browser screenshot when reporting an issue.

For a phone, choose Actual device and Full viewport. **Show test controls** returns
to the review workspace. Synthetic peer links open a full table directly; its
brand provides access back to the lab controls. The actual native keyboard,
app backgrounding and physical network switching still require phone testing.

## Scenario catalogue

Table/deal and empty-seat layouts; your turn and waiting controls; pre-call
cancellation including a genuinely capped short stack; long names/large stacks;
flop/turn/river; uncontested, ordinary, own/opponent and tied showdowns; all-in
voting, once/twice, mixed choices, vote timeout, shared flop/turn, different winners
on two runs and the PLO5 deck limit; side pots and uncalled returns; Rabbit Hunt,
voluntary reveal and history exports; chat/keyboard; away, stand-up, reload,
termination pending and completed-game controls; recovery and continuous simulation.

Requirements are applied automatically. For example the deck-limit case uses
8-player PLO5; different-run winners uses two players. Generic eight-player PLO5
Run Twice shares the flop because two full preflop boards would exhaust the deck.
The expected outcome panel reports actual engine calculations, including chip
conservation, winners, returned contributions, run count and visible-card seats.

## Simulation from Start Game

On staging, **Simulate players** changes Start Game to Start Simulation. Opponent
count excludes you (1–7 means 2–8 total). Selected variants, blinds, turn timer and
rotation pass to the common lab. Advanced settings also expose seed and buy-in.
Simulation is local and does not write ordinary game balances, history or settlement.
The old separate practice/all-in/showdown preview buttons are replaced by Test UI.

## Local versus real-server testing

Local simulation runs the real engine and Home/table components with a virtual
clock and seeded deck. The lab iframe blocks normal API calls, even from account
controls, and exports through the same player-specific privacy serializers.
Winning hands and awards are computed by legal engine actions. Crafted decks are
complete unique permutations supplied to the engine before dealing; the public
command protocol does not accept a deck or seed override.

**Server mode** creates a separate `ClubTable` object named `test-lab:<UUID>` in
the existing staging namespace. This is a different object/storage database from
`dunzo-club`; no namespace migration or replacement occurs. Each test session has
synthetic player IDs and scoped HttpOnly test cookies. Normal club cookies are
stripped from lab requests. Test cookies cannot authenticate ordinary requests or
another test session. Per-viewpoint cookie paths let multiple tabs view different
players without overwriting their identities. Scenario reset creates a fresh test
session; old session links continue to refer to their isolated state.

The real table client connects through scoped HTTP/WebSocket routes. The actual
server turn timer continues; the session pauses between hands. Step advances an
actor; Play/bots drives opponents but leaves the current viewer's turn to them.
Open another player or copy the second-phone link to observe presence and recovery.

Fault controls affect only the chosen iframe's game requests:

- HTTP unavailable: socket delivery and updates remain available.
- Socket unavailable: HTTP polling remains available.
- Both unavailable: server continues; the player must recover after restoring.
- Drop next accepted HTTP reply: persist the real action, discard its response,
  and allow normal same-command-ID socket/retry reconciliation.
- Reload with current fault: verify automatic identity restoration when restored.

To check the missed-turn case, choose a 10-second timer, open a peer, block both
transports for 20 seconds while it is your turn, then restore. The peer should
show Disconnected after leases expire; turn expiry follows check/fold. The returning
player must regain current state and later-turn controls without manual Retry or
another sign-in. HTTP polling and another active tab legitimately keep presence
alive; a dropped socket alone does not mean the player is disconnected.

## Validation

`pnpm test:lab` checks the catalogue across all player counts/variants, unique
cards, conserved chips, correct split/own/opponent/run winners, deterministic
replay, privacy, genuine side pots/returns, capped pre-calls and variant rotation.
It is included in `pnpm test`.

After a staging build:

- `node scripts/test-lab-server-smoke.mjs`: real isolated Worker, scoped identity,
  independent objects, command receipts, restart persistence, export and origin guards.
- `node scripts/test-lab-ui.cjs`: guided controls, visible cards, pause/replay,
  issue reports, phone viewports and real-client injected recovery.
- `node scripts/table-ui-smoke.cjs`: existing eight table geometries and five
  recovery scenarios. Browser suites accept `POKER_PLAYWRIGHT_MODULE` and
  `POKER_BROWSER_EXECUTABLE` for an installed Playwright/Chromium runtime.

The server smoke runs in CI for staging. Against a production build,
`POKER_LAB_PRODUCTION=1 node scripts/test-lab-server-smoke.mjs` verifies lab routes
are absent; CI runs this separately. All smoke data is disposable local storage.

## Visual follow-up surfaced by the lab

The 320×568, six-player PLO5, two-runout combination is particularly crowded:
result text and exposed cards need careful human inspection. This lab release
adds a reproducible way to review it; passing chip/privacy tests does not certify
every visual combination. Use the checkpoint and report tools for layout findings.
