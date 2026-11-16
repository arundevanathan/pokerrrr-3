import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, command, startHand, act, legal, tick, view } from '../lib/poker.mjs';
import { commandEnvelope } from '../lib/protocol/poker.mjs';
import { TableService, nextDeadline } from '../server/table-service.mjs';
import { MemoryStorage } from './memory-storage.mjs';
const ids = Array.from({length: 3}, () => crypto.randomUUID());
function fixture(game = 'NLH') {
  const room = newRoom('ABC234', ids[0], { name: 'Alice', games: [game], buyin: 1000, sb: 5, bb: 10 }, 10000);
  command(room, ids[1], { type: 'join', name: 'Bob', buyin: 1000 }, 10000); return room;
}
for (const game of ['NLH', 'PLO4', 'PLO5']) test(`${game}: all-in departure waits through both runs and payouts; cancel, retry, rejoin reconcile`, () => {
  const r = fixture(game); startHand(r, 11000); r.paused = true;
  const player = r.players[0];
  command(r, player.id, { type: 'stand_up' }, 11001);
  command(r, player.id, { type: 'stand_up' }, 11002);
  command(r, player.id, { type: 'cancel_stand_up' }, 11003);
  assert.equal(player.pendingSeatAction, null);
  command(r, player.id, { type: 'stand_up' }, 11004);
  assert.throws(() => command(r, player.id, { type: 'join', buyin: 1000 }), /pending/);
  for (let i = 0; i < 50 && r.phase !== 'runout_vote'; i++) {
    const l = legal(r, r.turn); act(r, r.turn, l.canRaise ? 'raise' : l.call ? 'call' : 'check', l.max, 12000 + i);
  }
  assert.equal(r.phase, 'runout_vote');
  for (const voter of r.runVote.voters) command(r, voter.id, { type: 'runout_vote', choice: 2 }, r.runVote.opensAt);
  tick(r, r.runVote.deadline);
  assert.equal(r.runCount, 2); assert.equal(player.left, false); assert.equal(player.cashout, 0);
  assert.equal(nextDeadline(r), r.payoutFinishedAt);
  tick(r, r.payoutFinishedAt - 1); assert.equal(player.left, false);
  const expected = player.stack;
  tick(r, r.payoutFinishedAt); assert.equal(player.left, true); assert.equal(player.cashout, expected); assert.equal(player.stack, 0);
  tick(r, r.payoutFinishedAt + 1); assert.equal(player.cashout, expected);
  command(r, player.id, { type: 'join', seat: 4, buyin: expected || 1700 }, r.payoutFinishedAt + 2);
  assert.equal(player.buyins, 1000 + (expected || 1700)); assert.equal(player.cashout, expected); assert.equal(player.stack, expected || 1700); assert.equal(player.inHand, false);
  assert.equal(r.players.reduce((s, p) => s + p.stack + p.cashout - p.buyins, 0), 0);
});
test('Away preserves current turn and deadline, excludes future hands, return restores eligibility', () => {
  const r = fixture(); startHand(r, 11000); const actor = r.turn, deadline = r.deadline;
  command(r, actor, { type: 'set_away', away: true }, 11001);
  assert.equal(r.turn, actor); assert.equal(r.deadline, deadline);
  assert.equal(r.players.find(p => p.id === actor).inHand, true);
  act(r, actor, 'fold', 0, 11002);
  tick(r, r.payoutFinishedAt); assert.equal(r.nextDealAt, null);
  command(r, actor, { type: 'set_away', away: false }, r.payoutFinishedAt + 1);
  tick(r, r.payoutFinishedAt + 1); assert.ok(r.nextDealAt);
});
test('cash-out, ledger, receipt and termination are atomic and idempotent across restart', async () => {
  const storage = new MemoryStorage(), service = new TableService(storage);
  let result = await service.execute(ids[0], commandEnvelope({ type: 'create', name: 'Alice', buyin: 1000 }), 10000);
  const code = result.snapshot.code;
  const stand = commandEnvelope({ type: 'stand_up', code }, result.snapshot);
  result = await service.execute(ids[0], stand, 10001);
  await new TableService(storage).execute(ids[0], stand, 10002);
  let ledger = [...(await storage.list({ prefix: `accounting:${code}:` })).values()].filter(v => v?.kind);
  assert.deepEqual(ledger.map(e => [e.kind, e.amount]), [['buy_in', 1000], ['cash_out', 1000]]);
  assert.equal(result.snapshot.players[0].left, true);
  result = await service.execute(ids[0], commandEnvelope({ type: 'join', code, seat: 3, name: 'Alice', buyin: 1000 }), 10003);
  const end = commandEnvelope({ type: 'end', code }, result.snapshot);
  await service.execute(ids[0], end, 10004); await new TableService(storage).execute(ids[0], end, 10005);
  ledger = [...(await storage.list({ prefix: `accounting:${code}:` })).values()].filter(v => v?.kind);
  assert.equal(ledger.filter(e => e.kind === 'cash_out').reduce((s, e) => s + e.amount, 0), 2000);
  const archive = await storage.get(`session:${code}`);
  assert.equal(archive.players[0].buyins, 2000); assert.equal(archive.players[0].cashout, 2000);
});
test('stand-up observer has no opponent hole cards and zero chips still releases a seat', () => {
  const r = fixture(); command(r, ids[0], { type: 'stand_up' }, 11000);
  command(r, ids[2], { type: 'join', seat: 0, name: 'Charlie', buyin: 1000 }, 11001);
  startHand(r, 12000);
  const observer = view(r, ids[0], 12001, true);
  assert.ok(observer.players.filter(p => !p.left).every(p => p.cards === undefined));
  const busted = fixture(); busted.players[0].stack = 0; busted.players[1].stack = 2000;
  command(busted, ids[0], { type: 'stand_up' }, 11000);
  assert.equal(busted.players[0].left, true); assert.equal(busted.players[0].cashout, 0);
});

test('another player sitting out during payouts cannot flush a pending departure early', () => {
  const r = fixture(); startHand(r, 11000);
  command(r, ids[0], { type: 'stand_up' }, 11001);
  act(r, r.turn, 'fold', 0, 11002);
  const waiting = r.players.find(p => p.id === ids[0]);
  command(r, ids[1], { type: 'ready' }, r.payoutFinishedAt - 1);
  assert.equal(waiting.left, false); assert.equal(waiting.cashout, 0);
  tick(r, r.payoutFinishedAt); assert.equal(waiting.left, true);
});

test('uncalled return, accounting entry and receipt survive restart without double credit', async () => {
  const storage = new MemoryStorage(); let service = new TableService(storage);
  let result = await service.execute(ids[0], commandEnvelope({type:'create',name:'Alice',games:['NLH'],buyin:1000,bb:10}), 10000);
  const code = result.snapshot.code;
  await service.execute(ids[1], commandEnvelope({type:'join',code,name:'Bob',buyin:20}), 10001);
  let snapshot = await service.snapshot(ids[0], code);
  result = await service.execute(ids[0], commandEnvelope({type:'deal',code}, snapshot), 10002);
  snapshot = result.snapshot;
  result = await service.execute(ids[0], commandEnvelope({type:'raise',code,amount:1000}, snapshot), 10003);
  snapshot = await service.snapshot(ids[1], code);
  const call = commandEnvelope({type:'call',code}, snapshot);
  await service.execute(ids[1], call, 10004);
  service = new TableService(storage);
  const retry = await service.execute(ids[1], call, 10005);
  assert.equal(retry.replayed, true);
  const room = await storage.get(`room:${code}`);
  assert.equal(room.phase, 'runout_vote'); assert.equal(room.players[0].stack, 980);
  assert.equal(room.uncalledReturns.length, 1);
  const ledger = [...(await storage.list({prefix:`accounting:${code}:`})).values()].filter(e => e.kind === 'uncalled_return');
  assert.equal(ledger.length, 1); assert.equal(ledger[0].amount, 980);
});

test('session timer starts on the first deal, extends from its deadline and finishes the current hand', () => {
  const r = fixture();
  r.settings.sessionMinutes = 30;
  assert.equal(nextDeadline(r), null);
  startHand(r, 11000);
  const original = 11000 + 30 * 60000;
  assert.equal(r.sessionEndsAt, original);
  command(r, ids[1], {type:'extend_session', minutes:15}, 11002);
  assert.equal(r.sessionEndsAt, original + 15 * 60000);
  r.deadline = r.sessionEndsAt + 1000;
  assert.equal(nextDeadline(r), r.sessionEndsAt);
  tick(r, r.sessionEndsAt);
  assert.equal(r.terminationPending, true);
  assert.equal(r.phase, 'preflop');
  act(r, r.turn, 'fold', 0, r.deadline);
  assert.equal(nextDeadline(r), r.payoutFinishedAt);
  tick(r, r.payoutFinishedAt);
  assert.equal(r.phase, 'closed');
  assert.equal(r.players.reduce((total,p) => total + p.cashout,0), 2000);
});

test('two disconnected turns sit the player out and a connected timeout resets the streak', () => {
  for (const reconnected of [false,true]) {
    const r = fixture();
    const first = r.players[0], other = r.players[1];
    startHand(r, 11000);
    assert.equal(r.turn, first.id);
    tick(r, r.deadline, true, new Set([other.id]));
    assert.equal(first.disconnectedTimeouts, 1);
    assert.equal(r.phase, 'showdown');
    startHand(r, r.payoutFinishedAt + 1);
    if (r.turn !== first.id) act(r, r.turn, 'call', 0, r.deadline - 1);
    assert.equal(r.turn, first.id);
    tick(r, r.deadline, true, new Set(reconnected ? [first.id, other.id] : [other.id]));
    assert.equal(first.disconnectedTimeouts, reconnected ? 0 : 2);
    assert.equal(first.pendingSeatAction || null, reconnected ? null : 'sit_out');
    if (r.phase !== 'showdown') act(r, r.turn, 'fold', 0, r.deadline - 1);
    assert.equal(Boolean(first.sittingOut), !reconnected);
  }
});

test('an already sitting-out player can leave during another hand and must re-enter at the cash-out amount', () => {
  const r = fixture();
  command(r, ids[2], {type:'join', name:'Charlie', buyin:800}, 10001);
  command(r, ids[0], {type:'ready'}, 10002);
  startHand(r, 11000);
  const actor = r.turn;
  command(r, ids[0], {type:'stand_up'}, 11001);
  assert.equal(r.players[0].left, true);
  assert.equal(r.players[0].cashout, 1000);
  assert.equal(r.turn, actor);
  assert.throws(() => command(r, ids[0], {type:'join', buyin:800}, 11002), /exactly 1000/);
  command(r, ids[0], {type:'join', buyin:1000}, 11003);
  assert.equal(r.players[0].stack, 1000);
  assert.equal(r.players[0].inHand, false);
});

test('a signed-in spectator can extend a running game once per command', async () => {
  const service = new TableService(new MemoryStorage());
  let {snapshot} = await service.execute(ids[0], commandEnvelope({type:'create', name:'Alice', sessionMinutes:30}), 10000);
  const {code} = snapshot;
  await service.execute(ids[1], commandEnvelope({type:'join', name:'Bob', code}), 10001);
  snapshot = await service.snapshot(ids[0], code);
  ({snapshot} = await service.execute(ids[0], commandEnvelope({type:'deal',code},snapshot), 11000));
  const original = snapshot.sessionEndsAt;
  const watcher = await service.snapshot(ids[2], code);
  assert.ok(!watcher.players.some(player => player.id === ids[2]));
  const request = commandEnvelope({type:'extend_session', code, minutes:30},watcher);
  const accepted = await service.execute(ids[2], request, 11001);
  const replay = await service.execute(ids[2], request, 11002);
  assert.equal(accepted.snapshot.sessionEndsAt, original + 30 * 60000);
  assert.equal(replay.snapshot.sessionEndsAt, accepted.snapshot.sessionEndsAt);
  assert.equal(replay.replayed, true);
  await assert.rejects(
    service.execute(ids[2], commandEnvelope({type:'extend_session', code, minutes:15},watcher), accepted.snapshot.sessionEndsAt),
    /No running session timer/
  );
});
