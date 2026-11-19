import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, command, finish, startHand, view } from '../lib/poker.mjs';
import { actionLogCsv } from '../lib/hand-history-export.mjs';

const host = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const card = text => 'cdhs'.indexOf(text[1]) * 13 + '23456789TJQKA'.indexOf(text[0]);
function room() {
  const value = newRoom('ABC234', host, { name: 'Host', seats: 3, sb: 5, bb: 10, buyin: 1000, rotation: 2 });
  command(value, 'friend', { type: 'join', name: 'Friend' });
  command(value, 'folder', { type: 'join', name: 'Folder' });
  startHand(value, 1000);
  value.phase = 'flop';
  value.board = [card('2c'), card('3d'), card('4h')];
  value.players.forEach((player, index) => {
    player.inHand = true;
    player.folded = index !== 0;
    player.total = 10;
  });
  return value;
}

test('Rabbit Hunt is a five-second, seated-player public board reveal after an uncontested hand', () => {
  const value = room();
  finish(value, true, 2000);
  assert.equal(value.phase, 'showdown');
  assert.equal(value.rabbitHunt.deadline, 7000);
  assert.equal(value.history[0].rabbitHunt.cards.length, 0);
  command(value, 'folder', { type: 'rabbit_hunt' }, 3000);
  assert.equal(value.board.length, 5);
  assert.equal(value.history[0].rabbitHunt.cards.length, 2);
  assert.equal(value.history[0].rabbitHunt.requestedBy, 'folder');
  assert.throws(() => command(value, 'friend', { type: 'rabbit_hunt' }, 3001), /not available/);
});

test('Rabbit Hunt is also offered before the flop and reveals the full remaining board', () => {
  const value = room();
  value.board = [];
  value.phase = 'preflop';
  finish(value, true, 2000);
  assert.equal(value.rabbitHunt.boardLength, 0);
  command(value, host, { type: 'rabbit_hunt' }, 3000);
  assert.equal(value.board.length, 5);
  assert.equal(value.history[0].rabbitHunt.cards.length, 5);
});

test('a folded player can voluntarily reveal after a hand and the table sees only that public reveal', () => {
  const value = room();
  const folded = value.players.find(player => player.id === 'folder');
  finish(value, true, 2000);
  command(value, folded.id, { type: 'reveal_cards' }, 2500);
  const publicHistory = view(value, host).history[0];
  assert.ok(publicHistory.showdown.some(player => player.name === 'Folder'));
  assert.deepEqual(publicHistory.showdown.find(player => player.name === 'Folder').cards, folded.cards);
});

test('action-log CSV keeps Action Log columns and never emits an unrevealed folded hand', () => {
  const heroCards = [card('Ac'), card('Kd')], hiddenCards = [card('Qs'), card('Jh')];
  const csv = actionLogCsv({
    code: 'ABC234',
    viewerId: host,
    session: { code: 'ABC234' },
    hands: [{
      number: 1,
      game: 'NLH',
      board: [card('2c'), card('3d'), card('4h')],
      runCount: 1,
      showdown: [],
      audit: {
        startedAt: Date.UTC(2026, 9, 1), dealerSeat: 0,
        players: [
          { playerId: host, name: 'Hero', seat: 0, startingStack: 1000, holeCards: heroCards },
          { playerId: 'folder', name: 'Folder', seat: 1, startingStack: 1000, holeCards: hiddenCards }
        ],
        blinds: [{ type: 'small_blind', playerId: host, amount: 5 }, { type: 'big_blind', playerId: 'folder', amount: 10 }],
        actions: [{ street: 'preflop', playerId: 'folder', type: 'fold', chipsAdded: 0, stackAfter: 990 }]
      }
    }]
  });
  assert.match(csv.split('\r\n')[0], /^"Hand ID","Date","Session","Street","Seq","Player","Pos","Action","Size","Stack After"/);
  assert.match(csv, /Ac Kd/);
  assert.ok(!csv.includes('Qs Jh'));
  assert.match(csv, /"post SB"/);
});
