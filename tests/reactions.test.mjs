import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptReaction, reactionsEnabled, REACTIONS, reactionHistoryLabel } from '../lib/reactions.mjs';
const event = { id: 'unique-effect', code: 'ABC234', reaction: 'chappal', startedAt: 10200,
  from: { seat: 6, name: 'Alice' }, to: { seat: 2, name: 'Bob' } };
test('receiver drops duplicates, stale/foreign events and future events; unknown environments fail closed', () => {
  const seen = new Map();
  assert.equal(acceptReaction(event, 'ABC234', seen, 10050), true);
  assert.equal(acceptReaction(event, 'ABC234', seen, 10060), false);
  assert.equal(acceptReaction({ ...event, id: 'stale' }, 'ABC234', seen, 12000), false);
  assert.equal(acceptReaction({ ...event, id: 'foreign' }, 'XYZ234', seen, 10050), false);
  assert.equal(acceptReaction({ ...event, id: 'future', startedAt: 50000 }, 'ABC234', seen, 10050), false);
  for (const env of ['prod', undefined, 'unknown']) assert.equal(reactionsEnabled(env), false);
  assert.equal(reactionsEnabled('staging'), true);
  assert.equal(reactionsEnabled('production'), true);
});
test('standing senders animate from the spectator area; malformed or unknown effects are dropped', () => {
  assert.equal(acceptReaction({ ...event, from: { name: 'Observer', seat: null } }, 'ABC234', new Map(), 10050), true);
  for (const change of [{reaction:'toString'}, {from:{seat:'bad'}}, {to:{seat:null}}, {from:{seat:2}}]) {
    assert.equal(acceptReaction({ ...event, ...change }, 'ABC234', new Map(), 10050), false);
  }
});

test('every catalogue effect has independent freshness timing', () => {
  assert.deepEqual(Object.keys(REACTIONS), ['chappal', 'cheers', 'tomato', 'laugh', 'punch']);
  for (const retired of ['money', 'crown', 'duck']) {
    assert.ok(reactionHistoryLabel(retired)?.label);
    assert.equal(acceptReaction({ ...event, reaction: retired }, 'ABC234', new Map(), 10050), false);
  }
  for (const definition of Object.values(REACTIONS)) {
    const next = { ...event, id: definition.id, reaction: definition.id };
    assert.equal(acceptReaction(next, 'ABC234', new Map(), next.startedAt + definition.duration - 1), true);
    assert.equal(acceptReaction(next, 'ABC234', new Map(), next.startedAt + definition.duration), false);
  }
});
