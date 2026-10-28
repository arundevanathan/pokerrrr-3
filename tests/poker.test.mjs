import test from 'node:test';
import {payoutEvents} from '../lib/table-presentation.mjs';
import assert from 'node:assert/strict';
import { newRoom, command, startHand, legal, act, evaluate, rank5, view, settlement, tick, finish, returnUncalled, runoutCardsNeeded } from '../lib/poker.mjs';
import { handHistoryCsv, publicHandRecord, viewerHandRecord } from '../lib/hand-history.mjs';
const token = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const card = s => {
  const ranks = '23456789TJQKA',
    suits = 'cdhs';
  return suits.indexOf(s[1]) * 13 + ranks.indexOf(s[0]);
};
const cs = s => s.split(' ').map(card);
function room(n = 8, options = {}) {
  const r = newRoom('ABC234', token, {
    name: 'Host',
    seats: n,
    sb: 5,
    bb: 10,
    buyin: 1000,
    rotation: 2,
    ...options
  });
  for (let i = 1; i < n; i++) {
    const id = `player-${i}`;
    command(r, id, {
      type: 'join',
      name: `Player ${i}`
    });
  }
  return r;
}
function auto(r, pick = () => Math.random()) {
  let steps = 0;
  while (!['showdown', 'closed'].includes(r.phase)) {
    assert.ok(++steps < 2000, 'Hand terminates');
    if (r.phase === 'runout_vote') {
      tick(r, r.runVote.deadline);
      continue;
    }
    const l = legal(r, r.turn),
      roll = pick();
    if (l.canRaise && roll < .2) act(r, r.turn, 'raise', Math.min(l.max, Math.max(l.min, Math.floor((l.min + l.max) / 2)))); else if (l.call && roll < .3) act(r, r.turn, 'fold'); else act(r, r.turn, l.call ? 'call' : 'check');
  }
  return steps;
}
function conservation(r) {
  assert.equal(r.players.reduce((s, p) => s + p.stack + p.cashout, 0), r.players.reduce((s, p) => s + p.buyins, 0));
}
test('hand evaluator distinguishes wheel, straight flush, full house and quads', () => {
  assert.ok(rank5(cs('Ac 2c 3c 4c 5c')) > rank5(cs('Ah Ad As Ac Kh')));
  assert.ok(rank5(cs('Ah Ad As Ac Kh')) > rank5(cs('Kh Kd Ks Ac Ah')));
  assert.ok(rank5(cs('2c 3d 4h 5s 6c')) > rank5(cs('Ac 2d 3h 4s 5c')));
});
test('four-player exports show only self cards plus voluntary reveals, with Rabbit Hunt logged', () => {
  const r = room(4);
  startHand(r, 1_000);
  while (r.phase !== 'showdown') act(r, r.turn, 'fold', undefined, 1_100);
  const hand = r.history[0], revealer = r.players[1], hidden = r.players[2];
  command(r, revealer.id, { type: 'voluntary_reveal' }, 1_200);
  command(r, r.players[3].id, { type: 'rabbit_hunt' }, 1_300);
  assert.equal(hand.reveals[0].seat, revealer.seat);
  assert.equal(hand.rabbitHunt.requestedBy.seat, r.players[3].seat);
  assert.equal(hand.rabbitHunt.board.length, 5);
  assert.ok(hand.actionLog.some(event => event.type === 'rabbit_hunt'));
  const viewer = r.players[0], own = hand.privateCards.find(player => player.id === viewer.id);
  const exported = viewerHandRecord(publicHandRecord(r.code, hand), own);
  assert.deepEqual(exported.visibleHoleCards.map(player => player.seat).sort((a, b) => a - b), [viewer.seat, revealer.seat].sort((a, b) => a - b));
  assert.ok(!JSON.stringify(exported).includes(hidden.cards.join(',')));
  const csv = handHistoryCsv([exported]);
  assert.match(csv, /rabbit_hunt/);
  const publicView = view(r, viewer.id);
  assert.ok(!JSON.stringify(publicView).includes(hidden.id));
  assert.equal(JSON.stringify(publicView).includes('privateCards'), false);
  assert.deepEqual(publicView.players.find(p => p.seat === revealer.seat).cards, revealer.cards);
  assert.equal(publicView.players.find(p => p.seat === hidden.seat).cards, undefined);
  assert.equal(r.players.reduce((n, p) => n + p.stack, 0), 4000);
});
test('Omaha uses exactly two hole cards and three board cards', () => {
  const board = cs('Ac Kc Qc Jc Tc'),
    hole = cs('2d 3h 4s 5d 6h');
  assert.equal(Math.floor(evaluate(hole, board, 'PLO5') / 15 ** 5), 0);
  assert.equal(Math.floor(evaluate(hole.slice(0, 2), board, 'NLH') / 15 ** 5), 8);
});
test('pot-limit preflop cap includes blinds, call and player current bet', () => {
  let r = room(3);
  r.completed = 2;
  startHand(r);
  assert.equal(r.game, 'PLO4');
  assert.equal(legal(r, r.turn).max, 35);
  assert.throws(() => act(r, r.turn, 'raise', 36), /limit/);
});
test('heads up dealer is small blind and acts first preflop, last postflop', () => {
  const r = room(2);
  startHand(r);
  assert.equal(r.turn, r.smallBlind);
  act(r, r.turn, 'call');
  act(r, r.turn, 'check');
  assert.equal(r.phase, 'flop');
  assert.equal(r.turn, r.bigBlind);
});
test('short all-in does not reopen a full raise; cumulative short raises can reopen', () => {
  const r = room(4);
  startHand(r);
  let p = r.players.find(p => p.id === r.turn);
  act(r, p.id, 'raise', 100);
  let q = r.players.find(p => p.id === r.turn);
  q.stack = 130 - q.bet;
  act(r, q.id, 'raise', 130);
  q = r.players.find(p => p.id === r.turn);
  act(r, q.id, 'call');
  q = r.players.find(p => p.id === r.turn);
  act(r, q.id, 'call');
  assert.equal(r.turn, p.id);
  assert.equal(legal(r, p.id).canRaise, false);
  assert.throws(() => act(r, p.id, 'raise', 300), /not available/);
});
test('remaining player must call a short all-in after already acting', () => {
  const r = room(2);
  startHand(r);
  act(r, r.turn, 'call');
  act(r, r.turn, 'check');
  const first = r.turn;
  act(r, first, 'check');
  const p = r.players.find(p => p.id === r.turn);
  p.stack = 5;
  act(r, p.id, 'raise', 5);
  assert.equal(r.turn, first);
  assert.equal(legal(r, first).call, 5);
  act(r, first, 'call');
  assert.equal(r.phase, 'runout_vote');
  tick(r, r.runVote.deadline);
  assert.equal(r.phase, 'showdown');
});
test('timeouts check or fold and reconnect only reveals own cards', () => {
  const r = room(3);
  startHand(r, 0);
  const first = r.turn;
  assert.ok(tick(r, r.deadline + 1));
  assert.ok(r.players.find(p => p.id === first).folded);
  const v = view(r, token);
  assert.equal(v.deck, undefined);
  for (const p of r.players.filter(p => p.id !== token)) {
    assert.ok(!JSON.stringify(v).includes(p.id));
    const vp = v.players.find(q => q.name === p.name);
    assert.equal(vp.cards, undefined);
  }
  assert.equal(v.players.find(p => p.id === token).cards.length, 2);
});
test('players choose starting chips and join without approvals or token disclosure', () => {
  const r = newRoom('ABC234', token, {
    name: 'Host'
  });
  command(r, 'other-secret', {
    type: 'join',
    name: 'Friend',
    buyin: 1750
  });
  const v = view(r, token);
  assert.equal(r.players[1].stack, 1750);
  assert.equal(r.players[1].buyins, 1750);
  assert.equal(v.requests.length, 0);
  assert.ok(!JSON.stringify(v).includes('other-secret'));
  command(r, 'other-secret', {
    type: 'join',
    name: 'Friend',
    buyin: 1750
  });
  assert.equal(r.players[1].buyins, 1750);
  command(r, 'other-secret', {
    type: 'end'
  });
  assert.equal(r.phase, 'closed');
});
test('unequal all-ins distribute main pot, side pot and unmatched overbet', () => {
  const r = room(3);
  r.handEvents = [];
  r.phase = 'river';
  r.game = 'NLH';
  r.board = cs('2c 3d 7h 9s Jc');
  r.players.forEach((p, i) => {
    p.inHand = true;
    p.folded = false;
    p.total = (i + 1) * 100;
    p.stack = 0;
    p.buyins = p.total;
    p.cards = cs(['Ac Ad', 'Kc Kd', 'Qc Qd'][i]);
  });
  finish(r);
  assert.deepEqual(r.players.map(p => p.stack), [300, 200, 100]);
  conservation(r);
});
test('tied side pots split and award odd chips left of dealer', () => {
  const r = room(3);
  r.handEvents = [];
  r.phase = 'river';
  r.game = 'NLH';
  r.board = cs('2c 3d 7h 9s Jc');
  r.dealer = 0;
  r.players.forEach((p, i) => {
    p.inHand = true;
    p.folded = i === 2;
    p.total = 5;
    p.stack = 0;
    p.buyins = 5;
    p.cards = cs(['Ac Kd', 'Ad Kh', 'Qc Qd'][i]);
  });
  finish(r);
  assert.deepEqual(r.players.map(p => p.stack), [7, 8, 0]);
  conservation(r);
});
test('rotation advances only after completed hands, across all three games', () => {
  const r = room(2);
  for (const expected of ['NLH', 'NLH', 'PLO4', 'PLO4', 'PLO5', 'PLO5', 'NLH']) {
    startHand(r);
    assert.equal(r.game, expected);
    act(r, r.turn, 'fold');
    conservation(r);
  }
  assert.equal(r.completed, 7);
});
test('settlement balances and host can mark external payments', () => {
  const r = room(3);
  startHand(r);
  auto(r);
  command(r, token, {
    type: 'end'
  }, r.payoutFinishedAt);
  conservation(r);
  assert.equal(r.players.reduce((s, p) => s + p.cashout - p.buyins, 0), 0);
  for (const p of r.players) {
    const net = p.cashout - p.buyins;
    const due = settlement(r).reduce((s, t) => s + (t.to === p.id ? t.amount : 0) - (t.from === p.id ? t.amount : 0), 0);
    assert.equal(due, net);
  }
  if (settlement(r).length) {
    command(r, token, {
      type: 'paid',
      index: 0
    });
    assert.equal(settlement(r)[0].paid, true);
  }
});
test('120 eight-seat mixed hands terminate and conserve all chips', () => {
  const r = room(8);
  const games = new Set();
  let rng = 42;
  const random = () => {
    rng = Math.imul(rng, 1664525) + 1013904223 >>> 0;
    return rng / 4294967296;
  };
  for (let i = 0; i < 120; i++) {
    for (const p of r.players) {
      if (p.stack < 100) {
        command(r, p.id, {
          type: 'rebuy',
          amount: 1000
        });
      }
    }
    startHand(r);
    games.add(r.game);
    const cards = r.players.flatMap(p => p.cards);
    assert.equal(new Set(cards).size, cards.length);
    auto(r, random);
    conservation(r);
    const dealt = [...cards, ...r.board];
    assert.equal(new Set(dealt).size, dealt.length);
  }
  assert.equal(games.size, 3);
});
test('winning five and descriptions identify wheel, broadway, flush and full house', async () => {
  const {
    bestHand
  } = await import('../lib/poker.mjs');
  let h = bestHand(cs('Ac 2d'), cs('3h 4s 5c 9d Kh'), 'NLH');
  assert.equal(h.description, 'Straight, Ace to Five');
  assert.equal(h.cards.length, 5);
  assert.equal(h.holeCards.length, 2);
  assert.equal(h.boardCards.length, 3);
  h = bestHand(cs('Ac Kd'), cs('Qh Js Tc 9d 2h'), 'NLH');
  assert.equal(h.description, 'Straight, Ten to Ace');
  h = bestHand(cs('Ah 3h'), cs('Kh 8h 5h 9d 2c'), 'NLH');
  assert.equal(h.description, 'Flush, Ace-high (hearts)');
  assert.ok(h.cards.every(c => Math.floor(c / 13) === 2));
  h = bestHand(cs('Kc Kd'), cs('Kh Ts Td 9d 2c'), 'NLH');
  assert.equal(h.description, 'Full house, Kings full of Tens');
  h = bestHand(cs('Ah Kh'), cs('Qh Jh Th 9d 2c'), 'NLH');
  assert.equal(h.description, 'Royal flush (hearts)');
});
test('Omaha winning highlights include exactly two hole cards and three board cards', async () => {
  const {
    bestHand
  } = await import('../lib/poker.mjs');
  for (const hole of ['Ah Kh 2d 3s', 'Ah Kh 2d 3s 4c']) {
    const h = bestHand(cs(hole), cs('Qh Jh Th 9d 2c'), hole.split(' ').length === 4 ? 'PLO4' : 'PLO5');
    assert.equal(h.holeCards.length, 2);
    assert.equal(h.boardCards.length, 3);
    assert.equal(h.description, 'Royal flush (hearts)');
    assert.equal(h.score, evaluate(cs(hole), cs('Qh Jh Th 9d 2c'), 'PLO5'));
  }
});
test('uncalled chips return before awards; side pot winners contain only winnings', () => {
  const r = room(3);
  r.handEvents = [];
  r.phase = 'river';
  r.game = 'NLH';
  r.board = cs('2c 3d 7h 9s Jc');
  r.players.forEach((p, i) => {
    p.inHand = true;
    p.folded = false;
    p.total = (i + 1) * 100;
    p.stack = 0;
    p.buyins = p.total;
    p.cards = cs(['Ac Ad', 'Kc Kd', 'Qc Qd'][i]);
  });
  finish(r);
  assert.deepEqual(r.result.map(p => p.wonAmount), [300, 200]);
  assert.equal(r.players[2].stack, 100);
  assert.equal(r.uncalledReturns[0].amount, 100);
  assert.equal(r.lastPot, 500);
  assert.equal(returnUncalled(r), 0);
  assert.equal(r.result[0].description, 'Pair of Aces');
  assert.equal(r.result[1].pots[0].label, 'Side pot 1');
  assert.equal(r.result[0].winningCards.length, 5);
  const payments = payoutEvents(r, r.showdownAt, r.presentation);
  assert.deepEqual(payments.map(p => p.label), ['Side pot 1', 'Main pot']);
  assert.equal(payments.reduce((sum, p) => sum + p.amount, 0), r.lastPot);
  assert.ok(payments.every(p => p.at + p.duration <= r.payoutFinishedAt));
  assert.equal(r.nextDealAt, r.payoutFinishedAt + 3000);
});
test('fold win does not expose the winner’s private cards or invent a five-card hand', () => {
  const r = room(2);
  startHand(r);
  const folder = r.turn;
  act(r, folder, 'fold');
  const v = view(r, folder),
    w = v.result[0];
  assert.equal(w.description, 'Everyone else folded');
  assert.deepEqual(w.winningCards, []);
  assert.equal(v.players.find(p => p.id !== folder).cards, undefined);
  assert.equal(v.history[0].showdown.length, 0);
  assert.equal(w.amount, w.wonAmount + w.returnedAmount);
});
test('deal animation goes clockwise card by card, including all forty PLO5 cards', async () => {
  const {
    dealPlan,
    boardPlan
  } = await import('../lib/table-presentation.mjs');
  const r = room(8);
  r.completed = 4;
  startHand(r, 1000);
  const plan = dealPlan(r);
  assert.equal(plan.flights.length, 40);
  assert.deepEqual(plan.flights.slice(0, 8).map(f => f.seat), [1, 2, 3, 4, 5, 6, 7, 0]);
  assert.deepEqual(plan.flights.slice(8, 16).map(f => f.round), Array(8).fill(1));
  assert.ok(plan.flights.every((f, i) => !i || f.at > plan.flights[i - 1].at));
  assert.equal(r.deadline, 1000 + plan.duration + r.settings.timer * 1000);
  assert.deepEqual(boardPlan(0, 5).map(e => e.index), [0, 1, 2, 3, 4]);
  assert.deepEqual(boardPlan(3, 5).map(e => e.index), [3, 4]);
});
test('automatic next deal waits for payout animation plus exactly three seconds', () => {
  const r = room(2);
  startHand(r, 10000);
  act(r, r.turn, 'fold', 0, 20000);
  assert.equal(r.nextDealAt - r.payoutFinishedAt, 3000);
  assert.equal(r.showdownAt, 20000);
  assert.equal(tick(r, r.nextDealAt - 1), false);
  assert.equal(r.phase, 'showdown');
  const deadline = r.nextDealAt;
  assert.equal(tick(r, deadline), true);
  assert.equal(r.phase, 'preflop');
  assert.equal(r.handStartedAt, deadline);
  assert.equal(r.completed, 1);
  assert.equal(tick(r, deadline), false);
});
test('auto-deal pauses only for host pause or insufficient ready players, not reload approvals', () => {
  const r = room(3);
  startHand(r);
  act(r, r.turn, 'fold');
  act(r, r.turn, 'fold');
  command(r, token, {
    type: 'pause'
  });
  tick(r, Date.now() + 100000);
  assert.equal(r.phase, 'showdown');
  assert.equal(r.nextDealAt, null);
  command(r, token, {
    type: 'pause'
  });
  const other = r.players.find(p => p.id !== token);
  command(r, other.id, {
    type: 'rebuy',
    amount: 100
  });
  tick(r);
  assert.equal(r.requests.length, 0);
  assert.ok(r.nextDealAt);
  r.players.filter(p => p.id !== token).forEach(p => p.away = true);
  tick(r, r.nextDealAt);
  assert.equal(r.phase, 'showdown');
  assert.equal(r.nextDealAt, null);
  other.away = false;
  tick(r);
  assert.ok(r.nextDealAt);
});
test('any player reloads automatically between hands and the ledger stays balanced', () => {
  const r = room(2);
  command(r, token, {
    type: 'rebuy',
    amount: 350
  });
  assert.equal(r.players[0].stack, 1350);
  assert.equal(r.players[0].buyins, 1350);
  assert.equal(r.requests.length, 0);
  const friend = r.players[1];
  command(r, friend.id, {
    type: 'rebuy',
    amount: 275
  });
  assert.equal(r.requests.length, 0);
  assert.equal(friend.stack, 1275);
  assert.equal(friend.buyins, 1275);
  conservation(r);
});
test('reloads from every player stay out of a live pot and apply exactly once after the hand', () => {
  const r = room(2);
  startHand(r);
  const before = r.players.map(p => p.stack);
  r.players.forEach(p => command(r, p.id, {
    type: 'rebuy',
    amount: 200
  }));
  assert.deepEqual(r.players.map(p => p.stack), before);
  assert.equal(r.requests.length, 2);
  assert.throws(() => command(r, token, {
    type: 'rebuy',
    amount: 100
  }), /already queued/);
  assert.throws(() => command(r, token, {
    type: 'rebuy',
    amount: 500000000
  }), /must be/);
  act(r, r.turn, 'fold');
  assert.equal(r.requests.length, 0);
  assert.deepEqual(r.players.map(p => p.buyins), [1200, 1200]);
  conservation(r);
  tick(r, Date.now());
  assert.deepEqual(r.players.map(p => p.buyins), [1200, 1200]);
});
test('Pot shortcut uses the current pot rather than the entire NLH stack', async () => {
  const {
    shortcutRaiseTo
  } = await import('../lib/poker.mjs');
  const r = room(3);
  startHand(r);
  let id = r.turn;
  act(r, id, 'raise', 30);
  id = r.turn;
  const l = legal(r, id);
  assert.equal(l.pot, 45);
  assert.equal(shortcutRaiseTo(r, id), Math.max(l.min, 45));
  assert.notEqual(shortcutRaiseTo(r, id), l.max);
  const v = view(r, id);
  assert.equal(shortcutRaiseTo(v, id), shortcutRaiseTo(r, id));
  r.game = 'PLO4';
  assert.ok(shortcutRaiseTo(r, id) <= legal(r, id).max);
});
test('player actions expose distinct sound events with sequence numbers', () => {
  const r = room(3);
  startHand(r);
  act(r, r.turn, 'call');
  act(r, r.turn, 'raise', 30);
  act(r, r.turn, 'fold');
  assert.deepEqual(r.actionEvents.map(e => e.type), ['call', 'raise', 'fold']);
  assert.deepEqual(r.actionEvents.map(e => e.seq), [1, 2, 3]);
  assert.equal(r.actionSeq, 3);
  const id = r.turn,
    p = r.players.find(p => p.id === id);
  act(r, id, 'raise', p.stack + p.bet);
  assert.equal(r.actionEvents.at(-1).type, 'allin');
  assert.ok(!JSON.stringify(view(r, token).actionEvents).includes(p.id));
});
function allInVote(game = 'NLH', prefix = 0) {
  const r = room(2);
  r.completed = game === 'NLH' ? 0 : game === 'PLO4' ? 2 : 4;
  startHand(r, 4000);
  if (prefix >= 3) {
    act(r, r.turn, 'call', 0, 10000);
    act(r, r.turn, 'check', 0, 10000);
  }
  if (prefix === 4) {
    act(r, r.turn, 'check', 0, 10000);
    act(r, r.turn, 'check', 0, 10000);
  }
  for (let i = 0; i < 30 && r.phase !== 'runout_vote'; i++) {
    const l = legal(r, r.turn);
    assert.ok(l, 'Betting should reach an all-in');
    act(r, r.turn, l.canRaise ? 'raise' : l.call ? 'call' : 'check', l.max, 10000);
  }
  assert.equal(r.phase, 'runout_vote');
  assert.equal(r.board.length, prefix);
  return r;
}
function choose(r, choices) {
  r.runVote.voters.forEach((v, i) => {
    if (choices[i]) command(r, v.id, {
      type: 'runout_vote',
      choice: choices[i]
    }, r.runVote.opensAt + 5);
  });
}
test('default blinds and starting stack are 25 / 50 and 2500; players can customize', () => {
  const r = newRoom('ABC234', token, {
    name: 'Host'
  });
  assert.equal(r.settings.sb, 25);
  assert.equal(r.settings.bb, 50);
  assert.equal(r.players[0].stack, 2500);
  command(r, 'friend', {
    type: 'join',
    name: 'Friend',
    buyin: 6500
  });
  assert.equal(r.players[1].stack, 6500);
  assert.equal(r.players[1].buyins, 6500);
  assert.equal(r.requests.length, 0);
});
test('private runout choices stay sealed for the full five-second voting window', () => {
  const r = allInVote();
  assert.equal(r.runVote.deadline - r.runVote.opensAt, 5000);
  const [a, b] = r.runVote.voters;
  command(r, a.id, {
    type: 'runout_vote',
    choice: 2
  }, r.runVote.opensAt + 10);
  const other = view(r, b.id, r.runVote.opensAt + 20);
  assert.equal(other.runVote.voters.find(v => v.name === a.name).choice, null);
  assert.equal(other.runVote.voters.find(v => v.name === a.name).hasVoted, true);
  assert.equal(other.players.find(p => p.name === a.name).cards, undefined);
  assert.ok(!JSON.stringify(other).includes(a.id));
  command(r, b.id, {
    type: 'runout_vote',
    choice: 2
  }, r.runVote.opensAt + 30);
  assert.equal(r.runVote.revealed, false);
  assert.equal(tick(r, r.runVote.deadline - 1), false);
  assert.equal(r.board.length, 0);
  assert.equal(r.phase, 'runout_vote');
  tick(r, r.runVote.deadline);
  assert.equal(r.phase, 'showdown');
  assert.equal(r.runCount, 2);
  assert.ok(view(r, b.id).runVote.voters.every(v => v.choice === 2));
  conservation(r);
});
test('Once or missing response keeps the runout single; no early or late votes', () => {
  for (const choices of [[2, 1], [1, 2], [2, null], [null, null]]) {
    const r = allInVote();
    assert.throws(() => command(r, r.runVote.voters[0].id, {
      type: 'runout_vote',
      choice: 2
    }, r.runVote.opensAt - 1), /closed/);
    choose(r, choices);
    assert.throws(() => command(r, 'spectator', {
      type: 'runout_vote',
      choice: 2
    }, r.runVote.opensAt + 20), /Join/);
    tick(r, r.runVote.deadline);
    assert.equal(r.runCount, 1);
    assert.equal(r.runBoards.length, 1);
    assert.ok(r.runVote.voters.every(v => v.choice === 1 || v.choice === 2));
    assert.throws(() => command(r, token, {
      type: 'runout_vote',
      choice: 2
    }), /No open/);
    conservation(r);
  }
});
test('votes can be changed privately before the deadline', () => {
  const r = allInVote();
  choose(r, [2, 2]);
  command(r, r.runVote.voters[0].id, {
    type: 'runout_vote',
    choice: 1
  }, r.runVote.deadline - 1);
  tick(r, r.runVote.deadline);
  assert.equal(r.runCount, 1);
});
test('no runout vote while two opponents can still bet, or after the river', () => {
  const r = room(3);
  startHand(r);
  const p = r.players.find(p => p.id === r.turn);
  p.stack = 100;
  p.buyins = 100;
  act(r, p.id, 'raise', 100);
  act(r, r.turn, 'call');
  act(r, r.turn, 'call');
  assert.equal(r.phase, 'flop');
  assert.equal(r.runVote, null);
  const h = room(2);
  startHand(h);
  while (h.phase !== 'river') {
    const l = legal(h, h.turn);
    act(h, h.turn, l.call ? 'call' : 'check');
  }
  act(h, h.turn, 'raise', legal(h, h.turn).max);
  act(h, h.turn, 'call');
  assert.equal(h.phase, 'showdown');
  assert.equal(h.runVote, null);
  conservation(h);
});
test('two runs share dealt cards and never reuse an undealt card in NLH, PLO4 or PLO5', () => {
  for (const game of ['NLH', 'PLO4', 'PLO5']) for (const prefixLength of [0, 3, 4]) {
    const r = allInVote(game, prefixLength),
      prefix = [...r.board],
      before = r.deck.length,
      beforeCompleted = r.completed;
    choose(r, [2, 2]);
    tick(r, r.runVote.deadline);
    assert.equal(r.runCount, 2);
    assert.equal(r.completed, beforeCompleted + 1);
    assert.equal(r.runBoards.length, 2);
    r.runBoards.forEach(board => {
      assert.equal(board.length, 5);
      assert.deepEqual(board.slice(0, prefixLength), prefix);
    });
    const cards = [...r.players.flatMap(p => p.cards), ...prefix, ...r.runBoards.flatMap(board => board.slice(prefixLength)), ...r.deck];
    assert.equal(new Set(cards).size, cards.length);
    assert.equal(before - r.deck.length, runoutCardsNeeded(prefixLength) * 2);
    conservation(r);
    assert.equal(r.history[0].runCount, 2);
    assert.equal(r.history[0].boards.length, 2);
  }
});
test('each main/side pot splits per board, odd chip to first board, overbet returned once', () => {
  const r = room(3);
  r.handEvents = [];
  r.phase = 'river';
  r.game = 'NLH';
  r.board = cs('2c 3d 7h 9s Jc');
  r.runBoards = [r.board, cs('2d 3c 7s 9h Kh')];
  r.players.forEach((p, i) => {
    p.inHand = true;
    p.folded = false;
    p.total = [101, 201, 301][i];
    p.stack = 0;
    p.buyins = p.total;
    p.cards = cs(['Ac Ad', 'Kc Kd', 'Qc Qd'][i]);
  });
  finish(r);
  assert.deepEqual(r.players.map(p => p.stack), [152, 351, 100]);
  assert.equal(r.uncalledReturns[0].amount, 100);
  assert.equal(r.result.some(w => w.id === r.players[2].id), false);
  assert.deepEqual(r.result[0].runHands.map(h => h.run), [1]);
  assert.deepEqual(r.result[1].runHands.map(h => h.run), [1, 2]);
  conservation(r);
});
test('ties on both runs award split odd chips clockwise from the dealer', () => {
  const r = room(3);
  r.handEvents = [];
  r.phase = 'river';
  r.game = 'NLH';
  r.dealer = 0;
  r.board = cs('Ts Js Qs Ks As');
  r.runBoards = [r.board, cs('Th Jh Qh Kh Ah')];
  r.players.forEach((p, i) => {
    p.inHand = true;
    p.folded = i === 2;
    p.total = 5;
    p.stack = 0;
    p.buyins = 5;
    p.cards = cs(['2c 3c', '2d 3d', '4c 5c'][i]);
  });
  finish(r);
  assert.deepEqual(r.players.map(p => p.stack), [7, 8, 0]);
  assert.equal(r.result[0].pots.find(p => p.run === 1).potAmount, 8);
  assert.equal(r.result[0].pots.find(p => p.run === 2).potAmount, 7);
  conservation(r);
});
test('a multiway all-in requires every remaining player to choose Twice', () => {
  for (const choices of [[2, 2, null], [2, 2, 2]]) {
    const r = room(3);
    startHand(r);
    act(r, r.turn, 'raise', 1000, 10000);
    act(r, r.turn, 'call', 0, 10000);
    act(r, r.turn, 'call', 0, 10000);
    assert.equal(r.runVote.voters.length, 3);
    choose(r, choices);
    tick(r, r.runVote.deadline);
    assert.equal(r.runCount, choices[2] === 2 ? 2 : 1);
    conservation(r);
  }
});
test('full eight-handed PLO5 cannot run twice preflop; seven-handed PLO5 can', () => {
  for (const n of [8, 7]) {
    const r = room(n);
    r.completed = 4;
    startHand(r);
    const eligible = new Set(r.players.slice(0, 2).map(p => p.id));
    for (let i = 0; i < 40 && r.phase !== 'runout_vote'; i++) {
      const l = legal(r, r.turn);
      act(r, r.turn, eligible.has(r.turn) ? l.canRaise ? 'raise' : l.call ? 'call' : 'check' : 'fold', l.max);
    }
    assert.equal(r.phase, 'runout_vote');
    assert.equal(r.board.length, 0);
    assert.equal(r.runVote.canTwice, n === 7);
    if (n === 8) {
      assert.throws(() => choose(r, [2, 2]), /Not enough/);
      choose(r, [1, 1]);
    } else choose(r, [2, 2]);
    tick(r, r.runVote.deadline);
    assert.equal(r.runCount, n === 7 ? 2 : 1);
    conservation(r);
  }
});
test('reload queued during a runout vote cannot change the all-in or side-pot eligibility', () => {
  const r = allInVote();
  r.players.forEach(p => command(r, p.id, {
    type: 'rebuy',
    amount: 250
  }));
  assert.equal(r.requests.length, 2);
  assert.ok(r.players.every(p => p.stack === 0));
  const committed = r.players.map(p => p.total);
  choose(r, [2, 2]);
  tick(r, r.runVote.deadline);
  assert.deepEqual(r.players.map(p => p.total), committed);
  assert.equal(r.requests.length, 0);
  assert.deepEqual(r.players.map(p => p.buyins), [1250, 1250]);
  assert.ok(r.players.every(p => p.stack >= 250));
  conservation(r);
  assert.equal(r.nextDealAt - r.payoutFinishedAt, 3000);
});
test('a new player joining mid-hand gets their chosen stack without entering the current hand', () => {
  const r = room(3);
  r.settings.seats = 4;
  startHand(r);
  command(r, 'new-friend', {
    type: 'join',
    name: 'New friend',
    buyin: 3500
  });
  const p = r.players.find(p => p.id === 'new-friend');
  assert.equal(p.stack, 3500);
  assert.equal(p.inHand, false);
  assert.equal(r.requests.length, 0);
  auto(r);
  conservation(r);
});
test('empty game creator selects a seat and loads chips; occupied seats reject without accounting changes', () => {
  const r = newRoom('ABC234', token, {
    name: 'Host',
    takeSeat: false
  });
  assert.equal(r.players.length, 0);
  command(r, token, {
    type: 'join',
    name: 'Host',
    seat: 6,
    buyin: 1800
  });
  assert.equal(r.players[0].seat, 6);
  assert.equal(r.players[0].buyins, 1800);
  assert.throws(() => command(r, 'friend', {
    type: 'join',
    name: 'Friend',
    seat: 6,
    buyin: 2200
  }), /seat is taken/);
  assert.equal(r.players.length, 1);
  command(r, 'friend', {
    type: 'join',
    name: 'Friend',
    seat: 2,
    buyin: 2200
  });
  startHand(r);
  assert.equal(r.players.filter(p => p.inHand).length, 2);
});
test('Sit Out queues without removing the player from the current hand; Sit In preserves seat and chips', () => {
  const r = room(3);
  startHand(r);
  const p = r.players.find(p => p.id === r.turn),
    stack = p.stack,
    seat = p.seat;
  command(r, p.id, {
    type: 'ready'
  });
  assert.equal(p.away, false);
  assert.equal(p.inHand, true);
  assert.equal(p.pendingSeatAction, 'sit_out');
  assert.ok(legal(r, p.id));
  auto(r, () => .9);
  assert.equal(p.away, true);
  assert.equal(p.pendingSeatAction, null);
  conservation(r);
  startHand(r, r.nextDealAt);
  assert.equal(p.inHand, false);
  const saved = p.stack;
  command(r, p.id, {
    type: 'ready'
  });
  assert.equal(p.away, false);
  assert.equal(p.seat, seat);
  assert.equal(p.stack, saved);
  assert.equal(p.inHand, false);
  assert.ok(stack > 0);
});
test('pending Sit Out can be canceled; Get Up supersedes it and cancels an unapplied reload', () => {
  const r = room(3);
  startHand(r);
  const p = r.players[0];
  command(r, p.id, {
    type: 'ready'
  });
  command(r, p.id, {
    type: 'ready'
  });
  assert.equal(p.pendingSeatAction, null);
  command(r, p.id, {
    type: 'rebuy',
    amount: 300
  });
  command(r, p.id, {
    type: 'ready'
  });
  command(r, p.id, {
    type: 'leave'
  });
  assert.equal(p.left, false);
  assert.equal(p.inHand, true);
  assert.equal(p.stack + p.total, 1000);
  assert.throws(() => command(r, 'new', {
    type: 'join',
    name: 'New',
    seat: p.seat,
    buyin: 1000
  }), /seat is taken/);
  auto(r, () => .9);
  assert.equal(p.left, false, 'Seat is reserved through payout presentation');
  tick(r, r.payoutFinishedAt);
  assert.equal(p.left, true);
  assert.equal(p.stack, 0);
  assert.equal(p.buyins, 1000);
  assert.equal(r.requests.length, 0);
  conservation(r);
  command(r, 'new', {
    type: 'join',
    name: 'New',
    seat: p.seat,
    buyin: 1300
  });
  startHand(r, r.nextDealAt);
  assert.equal(p.inHand, false);
  assert.equal(r.players.find(q => q.id === 'new').inHand, true);
});
test('host can Get Up, rejoin another seat and retain cumulative accounting', () => {
  const r = room(3);
  r.settings.seats = 8;
  const p = r.players[0];
  command(r, token, {
    type: 'leave'
  });
  assert.equal(p.left, true);
  assert.equal(p.cashout, 1000);
  command(r, token, {
    type: 'join',
    name: 'Host',
    seat: 5,
    buyin: 1700
  });
  assert.equal(p.seat, 5);
  assert.equal(p.buyins, 2700);
  assert.equal(p.cashout, 1000);
  assert.equal(p.stack, 1700);
  conservation(r);
});
test('any player can terminate during a hand; payout finishes before closure and no next hand is dealt', () => {
  const r = room(3);
  startHand(r);
  command(r, 'watcher', {
    type: 'end'
  });
  assert.equal(r.phase, 'preflop');
  assert.equal(r.terminationPending, true);
  assert.ok(legal(r, r.turn));
  assert.throws(() => command(r, 'new', {
    type: 'join',
    name: 'New',
    seat: 7
  }), /termination/);
  assert.throws(() => command(r, token, {
    type: 'rebuy',
    amount: 100
  }), /termination/);
  auto(r, () => .9);
  assert.equal(r.phase, 'showdown');
  assert.equal(r.history.length, 1);
  assert.equal(r.nextDealAt, null);
  assert.throws(() => startHand(r), /termination/);
  tick(r, r.payoutFinishedAt - 1);
  assert.equal(r.phase, 'showdown');
  tick(r, r.payoutFinishedAt);
  assert.equal(r.phase, 'closed');
  assert.equal(r.completed, 1);
  assert.equal(r.players.reduce((n, p) => n + p.cashout, 0), 3000);
  conservation(r);
});
test('termination waits for a pending runout vote and closes even while auto-deal is paused', () => {
  const r = room(2);
  r.paused = true;
  startHand(r);
  act(r, r.turn, 'raise', legal(r, r.turn).max);
  act(r, r.turn, 'call');
  assert.equal(r.phase, 'runout_vote');
  command(r, token, {
    type: 'end'
  });
  assert.equal(r.phase, 'runout_vote');
  tick(r, r.runVote.deadline);
  assert.equal(r.phase, 'showdown');
  tick(r, r.payoutFinishedAt);
  assert.equal(r.phase, 'closed');
  conservation(r);
});
test('selected games rotate in canonical order; BB alone determines half-size SB', () => {
  const r = room(2, {
    games: ['PLO5', 'NLH'],
    bb: 40,
    sb: 99
  });
  assert.equal(r.settings.sb, 20);
  assert.deepEqual(r.settings.games, ['NLH', 'PLO5']);
  for (const expected of ['NLH', 'NLH', 'PLO5', 'PLO5', 'NLH']) {
    startHand(r);
    assert.equal(r.game, expected);
    auto(r, () => .9);
  }
  const single = room(2, {
    games: ['PLO4']
  });
  for (let i = 0; i < 3; i++) {
    startHand(single);
    assert.equal(single.game, 'PLO4');
    auto(single, () => .9);
  }
  for (const games of [[], ['BAD'], ['NLH', 'NLH']]) assert.throws(() => newRoom('ABC234', token, {
    name: 'Host',
    games
  }), /valid game/);
  assert.throws(() => newRoom('ABC234', token, {
    name: 'Host',
    bb: 25
  }), /even/);
  const high = newRoom('ABC234', token, {
    name: 'Host',
    bb: 2000,
    takeSeat: false
  });
  assert.equal(high.settings.sb, 1000);
  assert.ok(high.settings.buyin >= 4000);
});


test('seat action labels distinguish bets and raises, keep amounts, and reset for a new street', () => {
  const r = room(3);
  startHand(r);
  const caller = r.players.find(p => p.id === r.turn);
  act(r, caller.id, 'call');
  assert.equal(caller.action, 'Call');
  assert.equal(caller.actionAmount, 10);
  act(r, r.turn, 'call');
  act(r, r.turn, 'check');
  assert.equal(r.phase, 'flop');
  assert.equal(caller.action, null);
  const bettor = r.players.find(p => p.id === r.turn);
  act(r, bettor.id, 'raise', 20);
  assert.equal(bettor.action, 'Bet');
  assert.equal(bettor.actionAmount, 20);
  assert.equal(view(r, caller.id).players.find(p => p.name === bettor.name).actionAmount, 20);
  const raiser = r.players.find(p => p.id === r.turn);
  act(r, raiser.id, 'raise', 40);
  assert.equal(raiser.action, 'Raise to 40');
  assert.equal(raiser.actionAmount, 40);
  act(r, r.turn, 'fold');
  assert.ok(r.players.some(p => p.action === 'Fold' && p.actionAmount === null));
});

test('action time is configurable per game and controls the first deadline', async () => {
  const { dealPlan } = await import('../lib/table-presentation.mjs');
  assert.equal(room(2).settings.timer, 15);
  for (const timer of [10, 15, 20, 30]) {
    const r = room(2, { timer });
    startHand(r, 1000);
    assert.equal(r.settings.timer, timer);
    assert.equal(r.deadline, 1000 + dealPlan(r).duration + timer * 1000);
  }
  for (const timer of [0, 9, 31, 15.5]) assert.throws(() => room(2, { timer }), /Action time/);
});

test('folded contribution differences never manufacture side pots', () => {
  const r = room(3);
  r.handEvents = [];
  r.phase = 'river';
  r.game = 'NLH';
  r.board = cs('2c 3d 7h 9s Jc');
  r.players.forEach((p, i) => {
    p.inHand = true;
    p.folded = i === 2;
    p.total = [100, 100, 50][i];
    p.stack = 100;
    p.buyins = 200;
    p.cards = cs(['Ac Ad', 'Kc Kd', 'Qc Qd'][i]);
  });
  finish(r);
  assert.deepEqual([...new Set(r.result.flatMap(p => p.pots.map(pot => pot.label)))], ['Main pot']);
  assert.equal(r.result.reduce((sum, p) => sum + p.wonAmount, 0), 250);
});
test('queued Check never turns into a Call', async () => {
  const { resolvePreaction } = await import('../lib/client/preaction.mjs');
  assert.equal(resolvePreaction('check', 0), 'check');
  assert.equal(resolvePreaction('check', 50), null);
  assert.equal(resolvePreaction('check-fold', 50), 'fold');
  assert.equal(resolvePreaction('check-fold', 0), 'check');
  assert.equal(resolvePreaction('fold', 50), 'fold');
});

for (const game of ['NLH', 'PLO4', 'PLO5']) test(`${game}: short all-in call returns excess before vote, survives reload, and never returns twice`, () => {
  const r = room(2, { games: [game], buyin: 1000 });
  r.players[1].stack = 20; r.players[1].buyins = 20;
  startHand(r, 10000);
  // Omaha pot caps may require several full raises before the short call.
  for (let i = 0; i < 30 && r.phase !== 'runout_vote'; i++) {
    const l = legal(r, r.turn);
    act(r, r.turn, r.turn === r.players[0].id && l.canRaise ? 'raise' : l.call ? 'call' : 'check', l.max, 11000 + i);
  }
  assert.equal(r.phase, 'runout_vote');
  assert.equal(r.players[0].stack, 980);
  assert.deepEqual(r.players.map(p => p.total), [20, 20]);
  assert.equal(r.uncalledReturns.reduce((n, e) => n + e.amount, 0), game === 'NLH' ? 980 : 10);
  const restored = structuredClone(r);
  assert.equal(returnUncalled(restored), 0);
  for (const v of restored.runVote.voters) command(restored, v.id, { type: 'runout_vote', choice: 2 }, restored.runVote.opensAt);
  tick(restored, restored.runVote.deadline);
  assert.equal(restored.lastPot, 40);
  assert.equal(restored.result.reduce((n, w) => n + w.amount, 0), 40);
  assert.equal(restored.uncalledReturns.length, r.uncalledReturns.length);
  assert.equal(restored.history[0].uncalledReturns.reduce((n, e) => n + e.amount, 0), game === 'NLH' ? 980 : 10);
  conservation(restored);
});
test('uncalled return restores a usable stack, updates the wager and records one transaction', () => {
  const r = room(3);
  r.players.forEach((p, i) => { p.inHand = true; p.total = [1000, 600, 600][i]; p.bet = [500, 100, 100][i]; p.stack = 0; });
  r.currentBet = 500; r.phase = 'flop'; r.handEvents = [];
  assert.equal(returnUncalled(r), 400);
  assert.equal(r.players[0].stack, 400); assert.equal(r.players[0].bet, 100); assert.equal(r.currentBet, 100);
  assert.equal(returnUncalled(r), 0); assert.equal(r.handEvents.length, 1);
});
test('fold victory returns the unmatched blind before awarding the contested pot', () => {
  const r = room(2); startHand(r);
  const big = r.players.find(p => p.id === r.bigBlind);
  act(r, r.turn, 'fold');
  assert.equal(r.lastPot, 10); assert.equal(r.result[0].amount, 10);
  assert.equal(r.uncalledReturns[0].amount, 5);
  assert.equal(big.stack, 1005); conservation(r);
});

test('action CSV exports blind sizes and short-table positions in dealer order', () => {
  for (const [count, labels] of [[2, ['BTN/SB', 'BB']], [4, ['BTN', 'SB', 'BB', 'CO']], [6, ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']], [8, ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'LJ', 'HJ', 'CO']]]) {
    const seats = Array.from({ length: count }, (_, index) => ({ seat: (index + 3) % 8, name: `P${index}` }));
    const record = { sessionCode: 'ABC234', handNumber: 1, dealerSeat: 3, seats, actionLog: [
      { type: 'blinds_posted', smallBlind: { seat: seats[0].seat, name: seats[0].name, amount: 5, stackAfter: 995 }, bigBlind: { seat: seats[1].seat, name: seats[1].name, amount: 10, stackAfter: 990 } },
      ...seats.map(p => ({ type: 'check', street: 'flop', ...p }))
    ] };
    // The deliberately rotated array checks both wraparound and shorter tables.
    const ordered = [...seats].sort((a, b) => (a.seat - 3 + 8) % 8 - (b.seat - 3 + 8) % 8);
    const expected = new Map(ordered.map((p, i) => [p.seat, labels[i]]));
    const rows = handHistoryCsv([record]).split('\n').map(line => line.slice(1, -1).split('","'));
    assert.equal(rows[1][9], '5');
    assert.equal(rows[2][9], '10');
    seats.forEach((p, index) => assert.equal(rows[index + 3][7], expected.get(p.seat)));
  }
});
