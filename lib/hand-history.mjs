const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const suits = ['c', 'd', 'h', 's'];

export const cardText = card => Number.isInteger(card) ? `${ranks[card % 13]}${suits[Math.floor(card / 13)]}` : '';
const cardList = cards => (cards || []).map(cardText).join(' ');
const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;

function positions(hand) {
  const seats = hand.seats || [], dealerSeat = hand.dealerSeat;
  if (!seats.length || !Number.isInteger(dealerSeat)) return new Map();
  const ordered = [...seats].sort((a, b) => (a.seat - dealerSeat + 100) % 100 - (b.seat - dealerSeat + 100) % 100);
  const output = new Map();
  if (ordered.length === 2) {
    output.set(ordered[0].seat, 'BTN/SB');
    output.set(ordered[1].seat, 'BB');
    return output;
  }
  const early = { 4: ['CO'], 5: ['UTG', 'CO'], 6: ['UTG', 'HJ', 'CO'], 7: ['UTG', 'LJ', 'HJ', 'CO'], 8: ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO'] };
  const labels = ['BTN', 'SB', 'BB', ...(early[ordered.length] || [])];
  ordered.forEach((player, index) => output.set(player.seat, labels[index] || `Seat ${player.seat + 1}`));
  return output;
}

// This is deliberately an allow-list.  Completed hands retain a server-only
// privateCards field so each player can export their own cards later, but it is
// never copied into a public record or a different player's export.
export function publicHandRecord(roomCode, hand) {
  const {
    number, startedAt, completedAt, updatedAt, game, dealerSeat, board = [], boards = [], runCount,
    runDecision, pot, result = [], actions = [], actionLog = [], seats = [], showdown = [],
    reveals = [], rabbitHunt = null, uncalledReturns = []
  } = structuredClone(hand);
  return {
    sessionCode: roomCode,
    handNumber: number,
    number,
    startedAt,
    completedAt,
    updatedAt,
    game,
    dealerSeat,
    board,
    boards,
    runCount,
    runDecision,
    pot,
    actions,
    actionLog,
    seats,
    showdown,
    reveals,
    rabbitHunt,
    uncalledReturns: uncalledReturns.map(({ id, ...entry }) => entry),
    result: result.map(({ id, ...winner }) => winner)
  };
}

// Add exactly the cards the requesting player could legitimately see: their
// own deal, showdown cards, and a player's deliberate post-hand reveal.
export function viewerHandRecord(hand, ownCards) {
  const visible = new Map();
  const add = (entry, source) => {
    if (entry && Number.isInteger(entry.seat) && Array.isArray(entry.cards)) {
      visible.set(entry.seat, { seat: entry.seat, name: entry.name, cards: [...entry.cards], source });
    }
  };
  for (const entry of hand.showdown || []) add(entry, 'showdown');
  for (const entry of hand.reveals || []) add(entry, 'voluntary_reveal');
  if (ownCards) add(ownCards, 'self');
  return { ...structuredClone(hand), visibleHoleCards: [...visible.values()].sort((a, b) => a.seat - b.seat) };
}

export function handHistoryCsv(records) {
  const header = ['Hand ID', 'Date', 'Session', 'Street', 'Seq', 'Player', 'Hole Cards', 'Pos', 'Action', 'Size', 'Stack After'];
  const rows = [];
  for (const hand of records) {
    const date = hand.startedAt ? new Date(hand.startedAt).toISOString().slice(0, 10) : '';
    const handId = `${date.replaceAll('-', '')}-${hand.sessionCode}-H${String(hand.handNumber).padStart(3, '0')}`;
    const position = positions(hand);
    const visible = new Map((hand.visibleHoleCards || []).map(player => [player.seat, cardList(player.cards)]));
    const sequence = new Map();
    const add = (street, event) => {
      const streetName = ({ preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', runout: 'Runout', posthand: 'Posthand' })[street] || street;
      const seq = (sequence.get(streetName) || 0) + 1;
      sequence.set(streetName, seq);
      const seat = event.seat;
      rows.push([handId, date, `Home Game ${hand.sessionCode}`, streetName, seq, event.name || '', Number.isInteger(seat) ? visible.get(seat) || '' : '', Number.isInteger(seat) ? position.get(seat) || `Seat ${seat + 1}` : '', event.action || '', event.size ?? '', event.stackAfter ?? '']);
    };
    for (const event of hand.actionLog || []) {
      if (event.type === 'blinds_posted') {
        add('preflop', { ...event.smallBlind, action: 'post', size: event.smallBlind.amount });
        add('preflop', { ...event.bigBlind, action: 'post', size: event.bigBlind.amount });
      } else if (['fold', 'check', 'call', 'raise', 'allin'].includes(event.type)) {
        add(event.street, { ...event, action: event.type, size: ['fold', 'check'].includes(event.type) ? '' : event.amount });
      } else if (event.type === 'runout_resolved') {
        for (const choice of event.choices || []) add('runout', { ...choice, action: choice.choice === 2 ? 'run_twice' : 'run_once' });
      } else if (event.type === 'voluntary_reveal') {
        add('posthand', { ...event, action: 'voluntary_reveal' });
      } else if (event.type === 'rabbit_hunt') {
        add('posthand', { ...event.requestedBy, action: 'rabbit_hunt' });
      }
    }
  }
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
}

export function handHistoryJson(records) {
  return JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), hands: records }, null, 2);
}
