import test from 'node:test';
import assert from 'node:assert/strict';
import { TableService, nextDeadline } from '../server/table-service.mjs';
import { commandEnvelope, parseCommand } from '../lib/protocol/poker.mjs';
class MemoryStorage {
  values = new Map();
  alarm = null;
  queue = Promise.resolve();
  async get(key) {
    return structuredClone(this.values.get(key));
  }
  async put(key, value) {
    this.values.set(key, structuredClone(value));
  }
  async list({
    prefix = '',
    limit = 1000,
    startAfter
  } = {}) {
    return new Map([...this.values].filter(([key]) => key.startsWith(prefix) && (!startAfter || key > startAfter)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([k, v]) => [k, structuredClone(v)]));
  }
  async delete(key) {
    this.values.delete(key);
  }
  async setAlarm(at) {
    this.alarm = at;
  }
  async deleteAlarm() {
    this.alarm = null;
  }
  transaction(work) {
    const run = this.queue.then(async () => {
      const before = structuredClone(this.values),
        alarm = this.alarm;
      try {
        return await work(this);
      } catch (error) {
        this.values = before;
        this.alarm = alarm;
        throw error;
      }
    });
    this.queue = run.catch(() => { });
    return run;
  }
}
async function fixture(count = 2) {
  const storage = new MemoryStorage(),
    service = new TableService(storage),
    players = Array.from({
      length: count
    }, () => crypto.randomUUID());
  let {
    snapshot: room
  } = await service.execute(players[0], commandEnvelope({
    type: 'create',
    name: 'Host',
    rotation: 2,
    sb: 5,
    bb: 10,
    buyin: 1000,
    seats: 8
  }));
  for (let i = 1; i < count; i++) ({
    snapshot: room
  } = await service.execute(players[i], commandEnvelope({
    type: 'join',
    code: room.code,
    name: `Friend ${i}`,
    buyin: 1000
  })));
  const send = async (token, type, extra = {}, now) => {
    const current = await service.snapshot(token, room.code);
    return service.execute(token, commandEnvelope({
      type,
      code: room.code,
      ...extra
    }, current), now);
  };
  return {
    storage,
    service,
    players,
    code: room.code,
    send
  };
}
test('wire protocol rejects unknown actions, extra fields and missing concurrency guards', () => {
  assert.throws(() => parseCommand({
    type: 'create'
  }));
  assert.throws(() => parseCommand(commandEnvelope({
    type: 'steal',
    code: 'ABC234'
  })));
  assert.throws(() => parseCommand(commandEnvelope({
    type: 'leave',
    code: 'ABC234'
  })));
  assert.throws(() => parseCommand(commandEnvelope({
    type: 'create',
    name: 'Host',
    games: []
  })));
  assert.throws(() => parseCommand(commandEnvelope({
    type: 'create',
    name: 'Host',
    bb: 25
  })));
  assert.throws(() => parseCommand(commandEnvelope({
    type: 'create',
    name: 'Host',
    player: 'another-player'
  })));
  assert.throws(() => parseCommand(commandEnvelope({
    type: 'rebuy',
    code: 'ABC234',
    amount: 20
  })));
});
test('four-player hand exports are viewer-scoped and persist reveals and Rabbit Hunt', async () => {
  const f = await fixture(4);
  await f.send(f.players[0], 'deal');
  for (let i = 0; i < 4; i++) {
    const running = await f.storage.get(`room:${f.code}`);
    if (running.phase === 'showdown') break;
    await f.service.advance(running.deadline + 1);
  }
  await f.send(f.players[1], 'voluntary_reveal');
  await f.send(f.players[3], 'rabbit_hunt');
  const hand = await f.storage.get(`hand:${f.code}:0000000001`);
  assert.equal(hand.reveals.length, 1);
  assert.equal(hand.rabbitHunt.board.length, 5);
  const exported = await f.service.handHistory(f.players[0], f.code);
  assert.equal(exported.length, 1);
  assert.ok(exported[0].visibleHoleCards.some(player => player.seat === hand.privateCards.find(player => player.id === f.players[0]).seat));
  assert.ok(exported[0].visibleHoleCards.some(player => player.seat === hand.reveals[0].seat));
  assert.ok(!JSON.stringify(exported).includes(f.players[2]));
  const restarted = new TableService(f.storage);
  assert.deepEqual(await restarted.handHistory(f.players[0], f.code), exported);
  const shown = await restarted.snapshot(f.players[0], f.code);
  assert.deepEqual(shown.players.find(p => p.seat === hand.reveals[0].seat).cards, hand.reveals[0].cards);
  assert.equal(shown.players.find(p => p.seat === hand.privateCards.find(p => p.id === f.players[2]).seat).cards, undefined);
  const notAPlayer = await f.service.handHistory(crypto.randomUUID(), f.code);
  assert.deepEqual(notAPlayer, []);
});
test('one active table is enforced under simultaneous creates, retry returns original acknowledgement', async () => {
  const service = new TableService(new MemoryStorage());
  const attempts = ['Host', 'Other'].map(name => ({token: crypto.randomUUID(), input: commandEnvelope({type: 'create', name})}));
  const results = await Promise.allSettled(attempts.map(({token, input}) => service.execute(token, input)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  // Either async digest may finish first; retry the actual winning command.
  const winner = results.findIndex(r => r.status === 'fulfilled');
  const {token, input} = attempts[winner], original = results[winner].value;
  const retry = await service.execute(token, input);
  assert.deepEqual(retry.ack, original.ack);
  assert.equal(retry.replayed, true);
  await assert.rejects(service.execute(token, {
    ...input,
    name: 'Changed'
  }), /different content/);
});
test('eight-player views exclude deck, other bearer IDs and hidden cards', async () => {
  const f = await fixture(8);
  await f.send(f.players[0], 'deal');
  for (const token of f.players) {
    const room = await f.service.snapshot(token, f.code);
    assert.equal(room.deck, undefined);
    assert.equal(room.players.find(p => p.id === token).cards.length, 2);
    for (const other of f.players.filter(p => p !== token)) assert.equal(JSON.stringify(room).includes(other), false);
    assert.ok(room.players.filter(p => p.id !== token).every(p => p.cards === undefined));
  }
  const watching = await f.service.snapshot(crypto.randomUUID(), f.code);
  assert.equal(watching.legal, null);
  assert.equal(watching.deck, undefined);
  assert.ok(watching.players.every(p => p.cards === undefined));
  for (const id of f.players) assert.ok(!JSON.stringify(watching).includes(id));
});
test('reload retry after lost response has one effect across coordinator restart', async () => {
  const f = await fixture(),
    token = f.players[0],
    room = await f.service.snapshot(token, f.code);
  const input = commandEnvelope({
    type: 'rebuy',
    code: f.code,
    amount: 300
  }, room);
  const first = await f.service.execute(token, input),
    restarted = new TableService(f.storage);
  const retry = await restarted.execute(token, input);
  assert.deepEqual(first.ack, retry.ack);
  const player = retry.snapshot.players.find(p => p.id === token);
  assert.equal(player.stack, 1300);
  assert.equal(player.buyins, 1300);
  await assert.rejects(restarted.execute(token, commandEnvelope({
    type: 'rebuy',
    code: f.code,
    amount: 300
  }, room)), /table changed/);
});
test('stale hand/version and unauthorized host operations cannot mutate state', async () => {
  const f = await fixture(),
    initial = await f.service.snapshot(f.players[0], f.code);
  await assert.rejects(f.send(f.players[1], 'deal'), /Only the host/);
  await f.send(f.players[0], 'deal');
  await assert.rejects(f.service.execute(f.players[0], commandEnvelope({
    type: 'deal',
    code: f.code
  }, initial)), /table changed/);
  const room = await f.service.snapshot(f.players[0], f.code);
  await assert.rejects(f.service.execute(f.players[0], {
    ...commandEnvelope({
      type: 'pause',
      code: f.code
    }, room),
    handId: 0
  }), /hand has changed/);
  assert.equal((await f.service.snapshot(f.players[0], f.code)).version, room.version);
});
test('alarms advance a disconnected table, persist hand history, respect payouts and recover exact state', async () => {
  const f = await fixture();
  const {
    snapshot: dealt
  } = await f.send(f.players[0], 'deal');
  const persisted = await f.storage.get(`room:${f.code}`);
  const restarted = new TableService(f.storage);
  const restoredView = await restarted.snapshot(f.players[0], f.code),
    originalView = await f.service.snapshot(f.players[0], f.code);
  delete restoredView.serverTime;
  delete originalView.serverTime;
  assert.deepEqual(restoredView, originalView);
  assert.equal(f.storage.alarm, persisted.deadline);
  await restarted.advance(persisted.deadline + 1);
  const room = await f.storage.get(`room:${f.code}`);
  assert.equal(room.phase, 'showdown');
  assert.equal(room.completed, 1);
  assert.equal(room.players.reduce((sum, p) => sum + p.stack, 0), 2000);
  assert.ok(await f.storage.get(`hand:${f.code}:0000000001`));
  const current = await restarted.snapshot(f.players[0], f.code);
  await assert.rejects(restarted.execute(f.players[0], commandEnvelope({
    type: 'deal',
    code: f.code
  }, current), room.payoutFinishedAt - 1), /payouts/);
  await restarted.advance(room.nextDealAt);
  const next = await f.storage.get(`room:${f.code}`);
  assert.equal(next.phase, 'preflop');
  assert.notEqual(next.handStartedAt, dealt.handStartedAt);
  assert.equal(nextDeadline(next), next.deadline);
});
test('closed session remains accessible after the next one starts, old payments do not cancel live alarms', async () => {
  const f = await fixture();
  await f.send(f.players[0], 'deal');
  const running = await f.storage.get(`room:${f.code}`);
  await f.service.advance(running.deadline + 1);
  await f.send(f.players[0], 'end', {}, (await f.storage.get(`room:${f.code}`)).payoutFinishedAt);
  const closed = await f.service.snapshot(f.players[0], f.code);
  const {
    snapshot: next
  } = await f.service.execute(f.players[0], commandEnvelope({
    type: 'create',
    name: 'Next week'
  }));
  await f.service.execute(f.players[1], commandEnvelope({
    type: 'join',
    code: next.code,
    name: 'Friend',
    buyin: 1000
  }));
  const lobby = await f.service.snapshot(f.players[0], next.code);
  await f.service.execute(f.players[0], commandEnvelope({
    type: 'deal',
    code: next.code
  }, lobby));
  const deadline = f.storage.alarm;
  const paid = commandEnvelope({
    type: 'paid',
    code: closed.code,
    index: 0
  }, closed);
  const first = await f.service.execute(f.players[0], paid),
    retry = await f.service.execute(f.players[0], paid);
  assert.equal(first.snapshot.settlements[0].paid, true);
  assert.equal(retry.snapshot.settlements[0].paid, true);
  assert.equal(f.storage.alarm, deadline);
  assert.equal((await f.service.snapshot(f.players[0], f.code)).phase, 'closed');
  const reopened = await f.service.execute(f.players[1], commandEnvelope({
    type: 'join',
    code: f.code,
    name: 'Friend'
  }));
  assert.equal(reopened.snapshot.phase, 'closed');
  assert.equal(reopened.snapshot.version, retry.snapshot.version);
  await assert.rejects(f.service.execute(crypto.randomUUID(), commandEnvelope({
    type: 'join',
    code: f.code,
    name: 'Stranger'
  })), /Only session participants/);
  assert.ok(await f.storage.get(`session:${f.code}`));
});
test('history archive survives beyond the live view cap', async () => {
  const f = await fixture();
  await f.send(f.players[0], 'pause');
  let now = Date.now();
  for (let hand = 1; hand <= 101; hand++) {
    await f.send(f.players[0], 'deal', {}, now);
    const raw = await f.storage.get(`room:${f.code}`);
    await f.send(raw.turn, 'fold', {}, now + 1);
    const finished = await f.storage.get(`room:${f.code}`);
    now = finished.payoutFinishedAt + 1;
  }
  const room = await f.service.snapshot(f.players[0], f.code);
  assert.equal(room.history.length, 100);
  assert.equal(room.completed, 101);
  assert.ok(await f.storage.get(`hand:${f.code}:0000000001`));
  assert.ok(await f.storage.get(`hand:${f.code}:0000000101`));
});
test('a failed receipt save rolls back chips, state version and alarm atomically', async () => {
  const f = await fixture(),
    token = f.players[0],
    before = await f.service.snapshot(token, f.code);
  const put = f.storage.put.bind(f.storage);
  f.storage.put = async (key, value) => {
    if (key.startsWith('command:')) throw new Error('simulated write failure');
    return put(key, value);
  };
  const input = commandEnvelope({
    type: 'rebuy',
    code: f.code,
    amount: 200
  }, before);
  await assert.rejects(f.service.execute(token, input), /write failure/);
  const unchanged = await f.service.snapshot(token, f.code);
  assert.equal(unchanged.version, before.version);
  assert.deepEqual(unchanged.players, before.players);
  f.storage.put = put;
  const accepted = await f.service.execute(token, input);
  assert.equal(accepted.snapshot.players.find(p => p.id === token).buyins, 1200);
});
test('concurrent claims for the same chosen seat have one winner and idempotent buy-in', async () => {
  const storage = new MemoryStorage(),
    service = new TableService(storage),
    host = crypto.randomUUID();
  const {
    snapshot: r
  } = await service.execute(host, commandEnvelope({
    type: 'create',
    name: 'Host',
    takeSeat: false
  }));
  assert.equal(r.players.length, 0);
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const claims = ids.map((id, i) => commandEnvelope({
    type: 'join',
    code: r.code,
    name: `Friend ${i}`,
    seat: 4,
    buyin: 1500
  }));
  const results = await Promise.allSettled(ids.map((id, i) => service.execute(id, claims[i])));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /seat is taken/);
  const winner = results.findIndex(r => r.status === 'fulfilled');
  await service.execute(ids[winner], claims[winner]);
  const saved = await storage.get(`room:${r.code}`);
  assert.equal(saved.players.length, 1);
  assert.equal(saved.players[0].buyins, 1500);
  assert.equal(saved.players[0].seat, 4);
});
test('termination and pending seat actions survive restart, alarm closes and archives once', async () => {
  const f = await fixture(3);
  await f.send(f.players[0], 'deal'); // A departure queued by a v3 client must still recover safely after upgrading.
  const legacy = await f.storage.get(`room:${f.code}`);
  legacy.players[0].pendingSeatAction = 'leave';
  await f.storage.put(`room:${f.code}`, legacy);
  await f.send(f.players[1], 'ready');
  const spectator = crypto.randomUUID();
  const r = await f.service.snapshot(spectator, f.code);
  const end = commandEnvelope({
    type: 'end',
    code: f.code
  }, r);
  await f.service.execute(spectator, end);
  const recovered = new TableService(f.storage);
  await recovered.execute(spectator, end);
  let saved = await f.storage.get(`room:${f.code}`);
  assert.equal(saved.terminationPending, true);
  assert.equal(saved.players[0].pendingSeatAction, 'leave');
  while (saved.phase !== 'showdown') {
    await recovered.advance(saved.phase === 'runout_vote' ? saved.runVote.deadline : saved.deadline);
    saved = await f.storage.get(`room:${f.code}`);
  }
  assert.equal(f.storage.alarm, saved.payoutFinishedAt);
  assert.equal(saved.players[0].left, false, 'Departure waits for payout');
  assert.equal(saved.players[1].away, true);
  await recovered.advance(saved.payoutFinishedAt);
  assert.equal(await f.storage.get('active'), undefined);
  const archived = await f.storage.get(`session:${f.code}`);
  assert.equal(archived.completed, 1);
  assert.equal(archived.players.reduce((n, p) => n + p.cashout - p.buyins, 0), 0);
  assert.ok(await f.storage.get(`hand:${f.code}:0000000001`));
  await recovered.advance(saved.payoutFinishedAt + 1);
  assert.deepEqual(await f.storage.get(`session:${f.code}`), archived);
});
