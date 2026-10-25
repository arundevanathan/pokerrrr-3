import test from 'node:test';
import assert from 'node:assert/strict';
import { TableService, nextDeadline } from '../server/table-service.mjs';
import { commandEnvelope, parseCommand } from '../lib/protocol/poker.mjs';

class MemoryStorage {
  values = new Map(); alarm = null; queue = Promise.resolve();
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
  async setAlarm(at) { this.alarm = at; }
  async deleteAlarm() { this.alarm = null; }
  transaction(work) {
    const run = this.queue.then(async () => {
      const before = structuredClone(this.values), alarm = this.alarm;
      try { return await work(this); } catch (error) { this.values = before; this.alarm = alarm; throw error; }
    });
    this.queue = run.catch(() => {}); return run;
  }
}
async function fixture(count = 2) {
  const storage = new MemoryStorage(), service = new TableService(storage), players = Array.from({ length: count }, () => crypto.randomUUID());
  let { snapshot: room } = await service.execute(players[0], commandEnvelope({ type: 'create', name: 'Host', rotation: 2, sb: 5, bb: 10, buyin: 1000, seats: 8 }));
  for (let i = 1; i < count; i++) ({ snapshot: room } = await service.execute(players[i], commandEnvelope({ type: 'join', code: room.code, name: `Friend ${i}`, buyin: 1000 })));
  const send = async (token, type, extra = {}, now) => {
    const current = await service.snapshot(token, room.code);
    return service.execute(token, commandEnvelope({ type, code: room.code, ...extra }, current), now);
  };
  return { storage, service, players, code: room.code, send };
}

test('wire protocol rejects unknown actions, extra fields and missing concurrency guards', () => {
  assert.throws(() => parseCommand({ type: 'create' }));
  assert.throws(() => parseCommand(commandEnvelope({ type: 'steal', code: 'ABC234' })));
  assert.throws(() => parseCommand(commandEnvelope({ type: 'create', name: 'Host', player: 'another-player' })));
  assert.throws(() => parseCommand(commandEnvelope({ type: 'rebuy', code: 'ABC234', amount: 20 })));
});

test('one active table is enforced under simultaneous creates, retry returns original acknowledgement', async () => {
  const service = new TableService(new MemoryStorage()), token = crypto.randomUUID();
  const input = commandEnvelope({ type: 'create', name: 'Host' });
  const results = await Promise.allSettled([service.execute(token, input), service.execute(crypto.randomUUID(), commandEnvelope({ type: 'create', name: 'Other' }))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const original = results[0].value, retry = await service.execute(token, input);
  assert.deepEqual(retry.ack, original.ack); assert.equal(retry.replayed, true);
  await assert.rejects(service.execute(token, { ...input, name: 'Changed' }), /different content/);
});

test('eight-player views exclude deck, other bearer IDs and hidden cards', async () => {
  const f = await fixture(8); await f.send(f.players[0], 'deal');
  for (const token of f.players) {
    const room = await f.service.snapshot(token, f.code);
    assert.equal(room.deck, undefined); assert.equal(room.players.find(p => p.id === token).cards.length, 2);
    for (const other of f.players.filter(p => p !== token)) assert.equal(JSON.stringify(room).includes(other), false);
    assert.ok(room.players.filter(p => p.id !== token).every(p => p.cards === undefined));
  }
  await assert.rejects(f.service.snapshot(crypto.randomUUID(), f.code), /Join/);
});

test('reload retry after lost response has one effect across coordinator restart', async () => {
  const f = await fixture(), token = f.players[0], room = await f.service.snapshot(token, f.code);
  const input = commandEnvelope({ type: 'rebuy', code: f.code, amount: 300 }, room);
  const first = await f.service.execute(token, input), restarted = new TableService(f.storage);
  const retry = await restarted.execute(token, input);
  assert.deepEqual(first.ack, retry.ack);
  const player = retry.snapshot.players.find(p => p.id === token);
  assert.equal(player.stack, 1300); assert.equal(player.buyins, 1300);
  await assert.rejects(restarted.execute(token, commandEnvelope({ type: 'rebuy', code: f.code, amount: 300 }, room)), /table changed/);
});

test('stale hand/version and unauthorized host operations cannot mutate state', async () => {
  const f = await fixture(), initial = await f.service.snapshot(f.players[0], f.code);
  await assert.rejects(f.send(f.players[1], 'deal'), /Only the host/);
  await f.send(f.players[0], 'deal');
  await assert.rejects(f.service.execute(f.players[0], commandEnvelope({ type: 'deal', code: f.code }, initial)), /table changed/);
  const room = await f.service.snapshot(f.players[0], f.code);
  await assert.rejects(f.service.execute(f.players[0], { ...commandEnvelope({ type: 'pause', code: f.code }, room), handId: 0 }), /hand has changed/);
  assert.equal((await f.service.snapshot(f.players[0], f.code)).version, room.version);
});

test('alarms advance a disconnected table, persist hand history, respect payouts and recover exact state', async () => {
  const f = await fixture(); const { snapshot: dealt } = await f.send(f.players[0], 'deal');
  const persisted = await f.storage.get(`room:${f.code}`);
  const restarted = new TableService(f.storage);
  const restoredView = await restarted.snapshot(f.players[0], f.code), originalView = await f.service.snapshot(f.players[0], f.code);
  delete restoredView.serverTime; delete originalView.serverTime;
  assert.deepEqual(restoredView, originalView);
  assert.equal(f.storage.alarm, persisted.deadline);
  await restarted.advance(persisted.deadline + 1);
  const room = await f.storage.get(`room:${f.code}`);
  assert.equal(room.phase, 'showdown'); assert.equal(room.completed, 1);
  assert.equal(room.players.reduce((sum, p) => sum + p.stack, 0), 2000);
  assert.ok(await f.storage.get(`hand:${f.code}:0000000001`));
  const current = await restarted.snapshot(f.players[0], f.code);
  await assert.rejects(restarted.execute(f.players[0], commandEnvelope({ type: 'deal', code: f.code }, current), room.payoutFinishedAt - 1), /payouts/);
  await restarted.advance(room.nextDealAt);
  const next = await f.storage.get(`room:${f.code}`);
  assert.equal(next.phase, 'preflop'); assert.notEqual(next.handStartedAt, dealt.handStartedAt);
  assert.equal(nextDeadline(next), next.deadline);
});

test('closed session remains accessible after the next one starts, old payments do not cancel live alarms', async () => {
  const f = await fixture(); await f.send(f.players[0], 'deal');
  const running = await f.storage.get(`room:${f.code}`); await f.service.advance(running.deadline + 1);
  await f.send(f.players[0], 'end');
  const closed = await f.service.snapshot(f.players[0], f.code);
  const { snapshot: next } = await f.service.execute(f.players[0], commandEnvelope({ type: 'create', name: 'Next week' }));
  await f.service.execute(f.players[1], commandEnvelope({ type: 'join', code: next.code, name: 'Friend', buyin: 1000 }));
  const lobby = await f.service.snapshot(f.players[0], next.code);
  await f.service.execute(f.players[0], commandEnvelope({ type: 'deal', code: next.code }, lobby));
  const deadline = f.storage.alarm;
  const paid = commandEnvelope({ type: 'paid', code: closed.code, index: 0 }, closed);
  const first = await f.service.execute(f.players[0], paid), retry = await f.service.execute(f.players[0], paid);
  assert.equal(first.snapshot.settlements[0].paid, true); assert.equal(retry.snapshot.settlements[0].paid, true);
  assert.equal(f.storage.alarm, deadline);
  assert.equal((await f.service.snapshot(f.players[0], f.code)).phase, 'closed');
  const reopened = await f.service.execute(f.players[1], commandEnvelope({ type: 'join', code: f.code, name: 'Friend' }));
  assert.equal(reopened.snapshot.phase, 'closed');
  assert.equal(reopened.snapshot.version, retry.snapshot.version);
  await assert.rejects(f.service.execute(crypto.randomUUID(), commandEnvelope({ type: 'join', code: f.code, name: 'Stranger' })), /Only session participants/);
  assert.ok(await f.storage.get(`session:${f.code}`));
});

test('history archive survives beyond the live view cap', async () => {
  const f = await fixture(); await f.send(f.players[0], 'pause');
  let now = Date.now();
  for(let hand=1;hand<=101;hand++){
    await f.send(f.players[0],'deal',{},now);
    const raw=await f.storage.get(`room:${f.code}`);
    await f.send(raw.turn,'fold',{},now+1);
    const finished=await f.storage.get(`room:${f.code}`);
    now=finished.payoutFinishedAt+1;
  }
  const room=await f.service.snapshot(f.players[0],f.code);
  assert.equal(room.history.length,100);assert.equal(room.completed,101);
  assert.ok(await f.storage.get(`hand:${f.code}:0000000001`));
  assert.ok(await f.storage.get(`hand:${f.code}:0000000101`));
});

test('a failed receipt save rolls back chips, state version and alarm atomically', async () => {
  const f = await fixture(), token=f.players[0], before=await f.service.snapshot(token,f.code);
  const put=f.storage.put.bind(f.storage);
  f.storage.put=async(key,value)=>{if(key.startsWith('command:'))throw new Error('simulated write failure');return put(key,value)};
  const input=commandEnvelope({type:'rebuy',code:f.code,amount:200},before);
  await assert.rejects(f.service.execute(token,input),/write failure/);
  const unchanged=await f.service.snapshot(token,f.code);
  assert.equal(unchanged.version,before.version);assert.deepEqual(unchanged.players,before.players);
  f.storage.put=put;
  const accepted=await f.service.execute(token,input);assert.equal(accepted.snapshot.players.find(p=>p.id===token).buyins,1200);
});
