import { indiaDate } from './game-history.mjs';

const ranks = '23456789TJQKA', suits = 'cdhs';
const card = value => Number.isInteger(value) ? `${ranks[value % 13]}${suits[Math.floor(value / 13)]}` : '';
const cards = values => (values || []).map(card).filter(Boolean).join(' ');
const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;

function positions(players = [], dealerSeat) {
  const clockwise = [...players].sort((a, b) => ((a.seat - dealerSeat + 100) % 100) - ((b.seat - dealerSeat + 100) % 100));
  const labels = new Map();
  if (!clockwise.length) return labels;
  labels.set(clockwise[0].playerId, 'BTN');
  if (clockwise.length === 2) {
    labels.set(clockwise[0].playerId, 'BTN/SB');
    labels.set(clockwise[1].playerId, 'BB');
    return labels;
  }
  labels.set(clockwise[1]?.playerId, 'SB');
  labels.set(clockwise[2]?.playerId, 'BB');
  const middle = clockwise.slice(3);
  middle.forEach((player, index) => {
    labels.set(player.playerId, index === middle.length - 1 ? 'CO' : index ? `UTG+${index}` : 'UTG');
  });
  return labels;
}

function publicCards(hand, viewerId) {
  const audit = hand.audit || {};
  const hero = audit.players?.find(player => player.playerId === viewerId);
  const shown = hand.showdown || [];
  const voluntary = hand.reveals || [];
  const revealed = [...shown, ...voluntary].reduce((all, player) => {
    if (!player?.name || all.some(item => item.name === player.name)) return all;
    all.push(player);
    return all;
  }, []);
  const boards = hand.boards?.length ? hand.boards : hand.board?.length ? [hand.board] : [];
  return {
    hero: cards(hero?.holeCards),
    shown: revealed.map(player => `${player.name}: ${cards(player.cards)}`).join(' | '),
    community: boards.map((board, index) => `${boards.length > 1 ? `Run ${index + 1}: ` : ''}${cards(board)}`).join(' | '),
    rabbit: cards(hand.rabbitHunt?.cards),
    runCount: hand.runCount || 1
  };
}

const headers = [
  'Hand ID', 'Date', 'Session', 'Street', 'Seq', 'Player', 'Pos', 'Action', 'Size', 'Stack After',
  'Game', 'Hero Hole Cards', 'Revealed Hole Cards', 'Community Cards', 'Rabbit Hunt Cards', 'Run Count'
];

/**
 * A viewer-scoped, Excel-friendly action log. The first ten columns deliberately
 * match the existing Action Log sheet; privacy-dependent card fields follow them.
 */
export function actionLogCsv({ code, hands, viewerId }) {
  const rows = [headers];
  for (const hand of [...hands].sort((a, b) => a.number - b.number)) {
    const audit = hand.audit;
    if (!audit?.players?.some(player => player.playerId === viewerId)) continue;
    const byId = new Map(audit.players.map(player => [player.playerId, player]));
    const stack = new Map(audit.players.map(player => [player.playerId, player.startingStack]));
    const pos = positions(audit.players, audit.dealerSeat);
    const visible = publicCards(hand, viewerId);
    const handId = `${indiaDate(audit.startedAt || hand.completedAt)}-${code}-H${String(hand.number).padStart(3, '0')}`;
    const base = [handId, indiaDate(audit.startedAt || hand.completedAt), `Dunzo Club ${code}`, '', '', '', '', '', '', '', hand.game || '', visible.hero, visible.shown, visible.community, visible.rabbit, visible.runCount];
    let seq = 0;
    const add = (street, playerId, action, size, after) => {
      const player = byId.get(playerId);
      if (!player) return;
      const row = [...base];
      row[3] = street;
      row[4] = ++seq;
      row[5] = player.name;
      row[6] = pos.get(playerId) || `Seat ${player.seat + 1}`;
      row[7] = action;
      row[8] = size || '';
      row[9] = Number.isFinite(after) ? after : '';
      rows.push(row);
    };
    for (const blind of audit.blinds || []) {
      const player = byId.get(blind.playerId);
      if (!player) continue;
      const after = (stack.get(blind.playerId) || 0) - blind.amount;
      stack.set(blind.playerId, after);
      add('Preflop', blind.playerId, blind.type === 'small_blind' ? 'post SB' : 'post BB', blind.amount, after);
    }
    for (const action of audit.actions || []) {
      const after = Number.isFinite(action.stackAfter) ? action.stackAfter : stack.get(action.playerId);
      if (Number.isFinite(after)) stack.set(action.playerId, after);
      add(action.street ? action.street[0].toUpperCase() + action.street.slice(1) : 'Preflop', action.playerId, action.allIn ? `${action.type} all-in` : action.type, action.chipsAdded, after);
    }
    for (const reveal of hand.reveals || []) {
      const player = audit.players.find(item => item.name === reveal.name || item.playerId === reveal.playerId);
      if (player) add('Showdown', player.playerId, 'voluntary reveal', '', stack.get(player.playerId));
    }
    if (hand.rabbitHunt?.requestedBy) {
      const player = byId.get(hand.rabbitHunt.requestedBy);
      if (player) add('Rabbit Hunt', player.playerId, 'rabbit hunt', '', stack.get(player.playerId));
    }
  }
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
