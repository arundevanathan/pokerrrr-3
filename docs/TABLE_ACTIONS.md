# Stable table and pre-turn actions (staging)

The normal table reserves the complete toolbar, personal-card, slider and action
button footprint. Betting, runout voting, runout animation and showdown replace
content without resizing the felt or bottom panel. The voting prompt is an
overlay. Viewport/orientation changes and deliberately opening the chat composer
still use their responsive layouts. Extra status/error content scrolls inside
the reserved panel rather than resizing the table.

Before the local player's turn, action buttons contain checkboxes. The whole
button is the checkbox target and supports keyboard activation. Only one choice
can be selected; selecting it again clears it. Current-turn buttons act directly
and contain no checkbox. Raise cannot be queued.

- **Check/Fold:** check for free, otherwise fold. Other players' bets/raises do not cancel it.
- **Check:** check only while no call is required. A new bet cancels it.
- **Call [amount]:** call that specific amount. Any increased betting level cancels it, even when the player's short stack caps the effective call at the same amount. Other calls and unrelated snapshot/version updates do not cancel it.

Selections are local and never authorize a future hand/street. They clear on
hand/street/table/identity changes, folding, sitting out, leaving, disconnection,
execution or a direct action. A selected action is consumed before sending, so
renders and duplicate updates cannot execute it twice. The existing server
version/hand guards reject a raise racing an outgoing pre-call; durable command
receipts retain exact-once transport recovery.

## Verification

`pnpm test` includes pre-call amount/raise cancellation, short-stack caps,
Check/Fold and Check rules, lifecycle invalidation and a real TableService race:
a raise accepted before the queued call arrives must reject the old call without
charging chips.

After `pnpm build:staging`, run the optional browser suite with Playwright:

```sh
POKER_BROWSER_EXECUTABLE=/path/to/chromium node scripts/table-ui-smoke.cjs
```

At 320×568, 390×844, 430×932 and 844×390 it compares exact felt, table-stage,
action-panel and hero-nameplate bounds through betting, voting and showdown,
including two boards. It tests checkbox toggling, call preservation/cancellation,
Check/Fold surviving raises, pre-check cancellation, clearing on disconnect and
exactly one automatic call when the turn arrives. It retains the prior keyboard,
chat, winner, card privacy/presentation and recovery checks.

On staging, use three players to select Call before your turn. Have the intervening
player call: the checkbox should remain selected. Repeat with a raise: it should
clear and display the new amount unselected. Check/Fold should remain selected
through that raise. Select Check when free: any new bet should clear it. Trigger
an all-in/run-it-twice vote and watch the felt and bottom panel: neither should
resize when the vote opens, closes or enters showdown.

This iteration is staged for review; production is unchanged.

## Follow-up: board, wagers and termination

Opponent wagers are centred close below their nameplates with a 3px CSS offset.
The local player’s wager stays above their nameplate. They do not contribute to the
seat's layout height. The local seat has the same concealed-card peek; its full
private cards remain in the personal hand below the felt.

The board origin, pot footprint and card dimensions do not depend on showdown
content or run count. Both boards form one compact stack. A shared result area beneath the stack
follows the active run; after payouts, Run 1/Run 2 selectors also change the
winning-card highlights. Results never insert space between the board rows.
The explicit keyboard/chat view retains its separate responsive layout.

Pending termination uses the existing toolbar with the turn indicator, replacing
the Rankings shortcut while pending. Rankings are available again when the game
ends, including from the completed-game panel.
It never adds an action-panel row. The completed-game view hides the personal
hand and includes rankings and Return to Lobby in the reserved panel.

The browser suite additionally compares the first board's exact bounds during
voting/showdown/two-run display, verifies centred wagers below nameplates and the hero peek,
compares action-button bounds with termination pending, and checks completed-game
navigation remains within the viewport.


## Revealed-card readability

Concealed cards keep their small peek. On reveal, opponent cards have separate,
non-overlapping faces with rank and suit together at the left edge, including
four- and five-card Omaha. Face-up cards keep a fixed nameplate anchor rather
than moving the player when the cards expand. Winning five-card highlights are
retained; other revealed cards use reduced dimming so their suits remain readable.
Redundant payout badges are hidden during showdown so they cannot cover card
indices; the amount and winning player remain in the common result area. The
felt oval does not clip result text at its curved edge.

Community cards use the larger normal-hand dimensions on both runs. The first
row remains anchored from betting through payouts, while the second follows
with a small fixed gap. Result space is bounded for multi-winner/side-pot content; very
short screens retain scrollable result details within the available footprint.

Browser coverage additionally includes six players at 390×740 for NLH, PLO4 and
PLO5 with two runs. It checks that every exposed rank/suit stays inside its card,
is not covered by the neighbouring card, and stays on screen. It also rejects
any overlap between opponent faces and community cards. It checks board
spacing, clearance from the local seat, run-result switching without board
movement, and that one-winner results on portrait phones are not scrolled or
masked by the oval.

Short landscape phones place the table beside the controls so the board and
revealed hands retain enough vertical space. This arrangement stays fixed
through hand phases, with both single- and double-run cases covered. Opening
the chat composer still uses the dedicated typing layout.

## Phase 1 integration with player hand history (PR #35)

Aditya's hand-history changes are integrated into the staging feature branch,
with all opponent wagers centred 3px below their nameplates and the local wager
above. The simulation/start-game redesign is a separate feature.

The authenticated `/api/hand-history?code=CODE&format=json|csv` endpoint exports
only hands in which the requesting player was dealt. It includes their own hole
cards, public showdown cards and voluntary reveals. Private archive records and
player identifiers are excluded. New hand records and post-hand updates persist
atomically with the command receipt. Rabbit Hunt does not change the actual board,
awards or chips; its speculative board is displayed in Hand History. Voluntary
reveals appear at the seat and in history. The actions are available only between
hands; pause auto-deal to allow more time to test them.

Compatibility: hands completed before this update have no private-card archive or
structured action log and are omitted from player exports. An in-progress hand
upgraded mid-hand can only log actions after the update. Use newly dealt hands
for export acceptance tests. No historical private cards or actions are inferred.

Integration corrections: CSV now includes blind sizes and position labels for
2–8-player tables. Build metadata is truncated in the normal toolbar and hidden
while typing. The existing exact-five highlights are retained rather than adding
a duplicate row of winning cards that would crowd the board result area.

Acceptance checks for Aditya:

1. Refresh staging, start a new hand and pause auto-deal. Test NLH, PLO4 and PLO5.
2. Finish an uncontested hand; download JSON/CSV as two different players. Each
   should see only their own hole cards until someone chooses Reveal my cards.
3. Reveal folded/winning cards. Another device must see them at the correct seat
   and in history; all other unrevealed cards must remain hidden.
4. Run Rabbit Hunt after a fold ends the hand before the river. Open Hand History
   to inspect the completed speculative board. Verify stacks and awards unchanged.
5. Repeat downloads from the previous-game view and after refreshing/reconnecting.
   Check blind sizes, action order, short-table positions and both runouts.
6. Check the small-phone typing view, five-card revealed hands and two-board result
   layout. Opponent wagers stay close below seats; your wager stays above.

Automated coverage includes authenticated HTTP JSON/CSV exports, retry deduplication
for both post-hand commands, public-view privacy, durable restart recovery and
blind/position CSV regression tests, plus the existing mobile and recovery suite.
