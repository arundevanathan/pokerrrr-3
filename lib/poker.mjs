import { dealPlan, showdownTiming, payoutAwards, AUTO_DEAL_MS, RUNOUT_VOTE_MS } from './table-presentation.mjs';
// Pure server-authoritative poker state machine. All monetary values are integer chips.
export const GAMES = ['NLH', 'PLO4', 'PLO5'];
const requireThat = (v, m) => {
  if (!v) throw new Error(m);
};
export function integer(v, min, max, label = 'Amount') {
  v = Number(v);
  requireThat(Number.isSafeInteger(v) && v >= min && v <= max, `${label} must be ${min}–${max}`);
  return v;
}
export function combinations(a, n) {
  if (n === 0) return [[]];
  return a.flatMap((v, i) => combinations(a.slice(i + 1), n - 1).map(t => [v, ...t]));
}
/** Encode category and kickers in base 15 so numeric comparison ranks hands.
 * Cards are 0–51: rank = card % 13, suit = floor(card / 13).
 */
export function rank5(cards) {
  const rs = cards.map(c => c % 13 + 2).sort((a, b) => b - a),
    counts = new Map();
  rs.forEach(r => counts.set(r, (counts.get(r) || 0) + 1));
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]),
    flush = cards.every(c => Math.floor(c / 13) === Math.floor(cards[0] / 13));
  const uniq = [...new Set(rs)];
  if (uniq[0] === 14) uniq.push(1);
  let straight = 0;
  for (let i = 0; i <= uniq.length - 5; i++) if (uniq[i] - uniq[i + 4] === 4) {
    straight = uniq[i];
    break;
  }
  let v;
  if (flush && straight) v = [8, straight];
  else if (groups[0][1] === 4) v = [7, groups[0][0], groups[1][0]];
  else if (groups[0][1] === 3 && groups[1][1] === 2) v = [6, groups[0][0], groups[1][0]];
  else if (flush) v = [5, ...rs];
  else if (straight) v = [4, straight];
  else if (groups[0][1] === 3) v = [3, groups[0][0], ...groups.slice(1).map(g => g[0])];
  else if (groups[0][1] === 2 && groups[1][1] === 2) v = [2, ...groups.slice(0, 2).map(g => g[0]).sort((a, b) => b - a), groups[2][0]];
  else if (groups[0][1] === 2) v = [1, groups[0][0], ...groups.slice(1).map(g => g[0])];
  else v = [0, ...rs];
  while (v.length < 6) v.push(0);
  return v.reduce((s, r) => s * 15 + r, 0);
}
// Omaha must use exactly two hole cards; Hold’em may use any five of seven.
function candidates(hole, board, game) {
  return game === 'NLH' ? combinations([...hole, ...board], 5) : combinations(hole, 2).flatMap(h => combinations(board, 3).map(b => [...h, ...b]));
}
export function evaluate(hole, board, game) {
  return Math.max(...candidates(hole, board, game).map(rank5));
}
const rankWord = r => ['', '', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'][r];
const rankPlural = r => ['', '', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'][r];
export function bestHand(hole, board, game) {
  let score = -1,
    cards = [];
  for (const choice of candidates(hole, board, game)) {
    const value = rank5(choice);
    if (value > score) {
      score = value;
      cards = choice;
    }
  }
  requireThat(cards.length === 5, 'Five cards are needed for a showdown');
  const category = Math.floor(score / 15 ** 5),
    high = Math.floor(score / 15 ** 4) % 15,
    second = Math.floor(score / 15 ** 3) % 15,
    suit = ['clubs', 'diamonds', 'hearts', 'spades'][Math.floor(cards[0] / 13)];
  let description;
  if (category === 8) description = high === 14 ? `Royal flush (${suit})` : `Straight flush, ${rankWord(high === 5 ? 14 : high - 4)} to ${rankWord(high)} (${suit})`;
  else if (category === 7) description = `Four of a kind, ${rankPlural(high)}`;
  else if (category === 6) description = `Full house, ${rankPlural(high)} full of ${rankPlural(second)}`;
  else if (category === 5) description = `Flush, ${rankWord(high)}-high (${suit})`;
  else if (category === 4) description = `Straight, ${rankWord(high === 5 ? 14 : high - 4)} to ${rankWord(high)}`;
  else if (category === 3) description = `Three of a kind, ${rankPlural(high)}`;
  else if (category === 2) description = `Two pair, ${rankPlural(high)} and ${rankPlural(second)}`;
  else if (category === 1) description = `Pair of ${rankPlural(high)}`;
  else description = `${rankWord(high)} high`;
  cards = [...cards].sort((a, b) => {
    const rank = c => c % 13 + 2 === 14 && (category === 4 || category === 8) && high === 5 ? 1 : c % 13 + 2;
    return rank(a) - rank(b) || a - b;
  });
  return {
    score,
    description,
    cards,
    holeCards: cards.filter(c => hole.includes(c)),
    boardCards: cards.filter(c => board.includes(c))
  };
}
export const handName = score => ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'][Math.floor(score / 15 ** 5)];
// Fisher–Yates: reject the uneven tail of the uint32 range before modulo.
export function shuffle() {
  const a = Array.from({
    length: 52
  }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    let n;
    const limit = Math.floor(4294967296 / (i + 1)) * (i + 1);
    do {
      n = crypto.getRandomValues(new Uint32Array(1))[0];
    } while (n >= limit);
    const j = n % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const ring = (r, seat, predicate) => {
  for (let i = 1; i <= r.settings.seats; i++) {
    const s = (seat + i) % r.settings.seats,
      p = r.players.find(p => p.seat === s && !p.left);
    if (p && predicate(p)) return p;
  }
  return null;
};
const active = p => !p.left && !p.away && p.stack > 0;
const participants = r => r.players.filter(p => p.inHand);
const contenders = r => participants(r).filter(p => !p.folded);
const movable = p => p.inHand && !p.folded && p.stack > 0;
const pot = r => participants(r).reduce((s, p) => s + p.total, 0);
function log(r, message) {
  r.events.push(message);
  r.events = r.events.slice(-70);
}
function handAction(r, event) {
  r.handActionLog ||= [];
  r.handActionSeq = (r.handActionSeq || 0) + 1;
  r.handActionLog.push({ seq: r.handActionSeq, ...event });
}
function pay(p, n) {
  const v = Math.min(n, p.stack);
  p.stack -= v;
  p.bet += v;
  p.total += v;
  return v;
}
function cleanName(v) {
  const name = String(v || '').trim().slice(0, 24);
  requireThat(name.length > 0, 'Enter your name');
  return name;
}
export function newRoom(code, token, input, now = Date.now()) {
  const bb = integer(input.bb ?? 50, 2, 100000, 'Big blind');
  requireThat(bb % 2 === 0, 'Big blind must be even so the small blind is exactly half');
  const sb = bb / 2,
    buyin = integer(input.buyin ?? Math.max(2500, bb * 2), bb * 2, 100000000, 'Buy-in');
  const selected = input.games ?? GAMES;
  requireThat(Array.isArray(selected) && selected.length > 0 && selected.length <= 3 && new Set(selected).size === selected.length && selected.every(g => GAMES.includes(g)), 'Select at least one valid game');
  const timer = input.timer ?? 15;
  requireThat([10, 15, 20, 30].includes(timer), 'Action time must be 10, 15, 20 or 30 seconds');
  const games = GAMES.filter(g => selected.includes(g));
  const r = {
    code,
    createdAt: now,
    host: token,
    settings: {
      sb,
      bb,
      games: [...games],
      buyin,
      maxBuyin: integer(input.maxBuyin ?? 100000000, buyin, 100000000, 'Maximum buy-in'),
      seats: integer(input.seats ?? 8, 2, 8, 'Seats'),
      rotation: integer(input.rotation ?? 3, 2, 4, 'Hands per game'),
      timer
    },
    players: [],
    phase: 'lobby',
    paused: false,
    nextDealAt: null,
    actionSeq: 0,
    actionEvents: [],
    completed: 0,
    dealer: -1,
    game: games[0],
    board: [],
    events: [],
    history: [],
    requests: [],
    payments: [],
    deadline: null,
    version: 0
  };
  if (input.takeSeat !== false) r.players.push({
    id: token,
    name: cleanName(input.name),
    seat: 0,
    stack: buyin,
    buyins: buyin,
    cashout: 0,
    away: false,
    left: false,
    inHand: false
  });
  log(r, `${cleanName(input.name)} started the game`);
  return r;
}
const handRunning = r => ['preflop', 'flop', 'turn', 'river', 'runout_vote'].includes(r.phase);
function closeGame(r) {
  r.players.forEach(p => {
    p.cashout += p.stack;
    p.stack = 0;
    p.inHand = false;
    p.pendingSeatAction = null;
  });
  r.phase = 'closed';
  r.nextDealAt = null;
  r.deadline = null;
  r.turn = null;
  r.requests = [];
  r.terminationPending = false;
  log(r, 'Game terminated');
}
function applySeatActions(r, allowDeparture = true) {
  for (const p of r.players) {
    if (p.pendingSeatAction === 'leave' && !allowDeparture) continue;
    if (p.pendingSeatAction === 'leave') {
      p.cashout += p.stack;
      p.stack = 0;
      p.left = true;
      p.away = false;
      r.requests = r.requests.filter(q => q.id !== p.id);
      p.inHand = false;
      log(r, `${p.name} stood up and cashed out`);
    }
    if (p.pendingSeatAction === 'sit_out') {
      p.away = true;
      log(r, `${p.name} is sitting out`);
    }
    p.pendingSeatAction = null;
  }
}
// A player in a running hand receives queued chips only after that hand ends.
export function applyReloads(r) {
  if (r.terminationPending) return false;
  let changed = false;
  for (const q of [...r.requests]) {
    const p = r.players.find(p => p.id === q.id);
    if (!p || p.left || p.pendingSeatAction === 'leave') {
      r.requests = r.requests.filter(x => x !== q);
      changed = true;
      continue;
    }
    if (handRunning(r) && p.inHand) continue;
    requireThat(Number.isSafeInteger(p.stack + q.amount) && Number.isSafeInteger(p.buyins + q.amount), 'Chip balance limit reached');
    p.stack += q.amount;
    p.buyins += q.amount;
    r.requests = r.requests.filter(x => x !== q);
    log(r, `${p.name} reloaded ${q.amount}`);
    changed = true;
  }
  return changed;
}
// Only call after a betting round is resolved: a live opponent must never lose
// the opportunity to call. Mutating contributions makes this naturally idempotent.
export function returnUncalled(r) {
  const paid = participants(r).slice().sort((a, b) => b.total - a.total);
  const owner = paid[0], amount = owner ? owner.total - (paid[1]?.total || 0) : 0;
  if (!owner || owner.folded || amount <= 0) return 0;
  owner.total -= amount;
  owner.bet = Math.max(0, owner.bet - amount);
  owner.stack += amount;
  r.currentBet = Math.max(0, ...paid.map(p => p.bet));
  (r.uncalledReturns ||= []).push({ id: owner.id, name: owner.name, amount, phase: r.phase });
  const message = `${owner.name}: ${amount} uncalled chips returned`;
  log(r, message);
  (r.handEvents ||= []).push(message);
  return amount;
}
/** Settle each contribution tier, return uncalled chips and record the hand.
 * Stacks update immediately; presentation timing controls when clients show payouts.
 */
export function finish(r, uncontested = false, now = Date.now()) {
  returnUncalled(r);
  r.uncontested = uncontested;
  const h = participants(r),
    live = contenders(r),
    boards = !uncontested && r.runBoards?.length ? r.runBoards : [[...r.board]],
    count = boards.length;
  const wins = new Map(h.map(p => [p.id, 0])),
    returns = new Map(h.map(p => [p.id, 0])),
    awards = new Map(h.map(p => [p.id, []]));
  const scores = uncontested ? [] : boards.map(board => new Map(live.map(p => [p.id, evaluate(p.cards, board, r.game)])));
  if (uncontested) {
    const p = live[0],
      uncalled = Math.max(0, p.total - Math.max(0, ...h.filter(q => q.id !== p.id).map(q => q.total)));
    wins.set(p.id, pot(r));
    returns.set(p.id, uncalled);
    awards.set(p.id, [{
      label: 'Main pot',
      amount: pot(r) - uncalled,
      potAmount: pot(r) - uncalled,
      tied: false,
      run: 1
    }]);
  } else {
    // Build contribution tiers, but only create a separate pot when the set of
    // eligible (non-folded) winners changes. Folded contributions alone must
    // never manufacture a side pot.
    const levels = [...new Set(h.map(p => p.total).filter(Boolean))].sort((a, b) => a - b);
    let prev = 0;
    const pots = [];
    for (const level of levels) {
      const paid = h.filter(p => p.total >= level);
      const amount = (level - prev) * paid.length;
      prev = level;
      if (paid.length === 1) {
        const p = paid[0];
        wins.set(p.id, wins.get(p.id) + amount);
        returns.set(p.id, returns.get(p.id) + amount);
        continue;
      }
      const eligible = paid.filter(p => !p.folded);
      requireThat(eligible.length > 0, 'Invalid pot: no eligible player');
      const key = eligible.map(p => p.id).sort().join('|');
      const existing = pots.find(p => p.key === key);
      if (existing) existing.amount += amount;
      else pots.push({ key, eligible, amount });
    }
    pots.forEach(({ eligible, amount }, potIndex) => {
      const label = potIndex === 0 ? 'Main pot' : `Side pot ${potIndex}`;
      // Split between runs first, then tied winners. Earlier runs and seats left
      // of the dealer receive odd chips, keeping every payout an integer.
      boards.forEach((board, runIndex) => {
        const runAmount = Math.floor(amount / count) + (runIndex < amount % count ? 1 : 0),
          best = Math.max(...eligible.map(p => scores[runIndex].get(p.id))),
          winners = eligible.filter(p => scores[runIndex].get(p.id) === best).sort((a, b) => (a.seat - r.dealer + r.settings.seats - 1) % r.settings.seats - (b.seat - r.dealer + r.settings.seats - 1) % r.settings.seats);
        winners.forEach((p, i) => {
          const share = Math.floor(runAmount / winners.length) + (i < runAmount % winners.length ? 1 : 0);
          if (!share) return;
          wins.set(p.id, wins.get(p.id) + share);
          awards.get(p.id).push({
            label,
            amount: share,
            potAmount: runAmount,
            tied: winners.length > 1,
            run: runIndex + 1
          });
        });
      });
    });
  }
  r.result = h.filter(p => wins.get(p.id) > 0).map(p => {
    const amount = wins.get(p.id),
      returnedAmount = returns.get(p.id),
      wonAmount = amount - returnedAmount,
      pots = awards.get(p.id),
      runHands = [];
    if (!uncontested && !p.folded) boards.forEach((board, index) => {
      const won = pots.filter(a => a.run === index + 1).reduce((n, a) => n + a.amount, 0);
      if (won > 0) {
        const best = bestHand(p.cards, board, r.game);
        runHands.push({
          run: index + 1,
          wonAmount: won,
          description: best.description,
          hand: handName(best.score),
          winningCards: best.cards,
          holeCards: best.holeCards,
          boardCards: best.boardCards
        });
      }
    });
    const details = runHands[0];
    return {
      id: p.id,
      name: p.name,
      amount,
      wonAmount,
      returnedAmount,
      pots,
      runHands,
      hand: details?.hand || (wonAmount > 0 ? 'Won without showdown' : 'Uncalled bet returned'),
      description: details?.description || (wonAmount > 0 ? 'Everyone else folded' : 'Uncalled bet returned'),
      winningCards: details?.winningCards || [],
      holeCards: details?.holeCards || [],
      boardCards: details?.boardCards || []
    };
  });
  h.forEach(p => p.stack += wins.get(p.id));
  r.lastPot = pot(r);
  r.phase = 'showdown';
  r.deadline = null;
  r.turn = null;
  r.completed++;
  r.runCount = uncontested ? 1 : count;
  r.runBoards = uncontested ? [] : boards;
  // Keep departing players seated throughout both runouts and payout animations.
  applySeatActions(r, false);
  if (!r.terminationPending) applyReloads(r);
  const payments = payoutAwards(r.result, r.runCount, true, true),
    timing = showdownTiming(r.boardBeforeAction ?? r.board.length, r.board.length, payments.length, r.runCount, Array.from({
      length: r.runCount
    }, (_, i) => payments.filter(p => p.run === i + 1).length), Boolean(r.runVote?.revealed));
  timing.combineAwards = true;
  r.presentation = timing;
  r.showdownAt = now;
  r.revealAt = now + timing.revealDelay;
  r.payoutFinishedAt = now + timing.payoutDuration;
  r.nextDealAt = !r.terminationPending && !r.paused && r.players.filter(active).length >= 2 ? r.payoutFinishedAt + AUTO_DEAL_MS : null;
  const summary = `Hand ${r.completed}: ${r.result.map(w => `${w.name} +${w.amount}`).join(' · ')}`;
  log(r, summary);
  r.history.unshift({
    number: r.completed,
    startedAt: r.handStartedAt,
    completedAt: now,
    updatedAt: now,
    game: r.game,
    dealerSeat: r.dealer,
    board: [...r.board],
    boards: r.runBoards.map(b => [...b]),
    runCount: r.runCount,
    runDecision: r.runVote?.revealed ? {
      count: r.runCount,
      reason: r.runVote.reason,
      choices: r.runVote.voters.map(v => ({
        name: v.name,
        choice: v.choice
      }))
    } : null,
    pot: r.lastPot,
    uncalledReturns: structuredClone(r.uncalledReturns || []),
    result: r.result,
    actions: [...r.handEvents],
    actionLog: structuredClone(r.handActionLog || []),
    seats: h.map(p => ({ seat: p.seat, name: p.name, startingStack: r.handStartingStacks?.[p.id] ?? p.stack })),
    showdown: uncontested ? [] : live.map(p => ({
      seat: p.seat,
      name: p.name,
      cards: p.cards
    })),
    reveals: [],
    rabbitHunt: null,
    // Server-only: this field is removed by view() and the export allow-list.
    privateCards: h.map(p => ({ id: p.id, seat: p.seat, name: p.name, cards: [...p.cards] }))
  });
  r.history = r.history.slice(0, 100);
}
// Include burn cards when deciding whether the deck supports two full runouts.
export function runoutCardsNeeded(boardLength) {
  let n = boardLength,
    needed = 0;
  while (n < 5) {
    const take = n === 0 ? 3 : 1;
    needed += take + 1;
    n += take;
  }
  return needed;
}
function completeBoard(r, prefix) {
  const board = [...prefix];
  while (board.length < 5) {
    const n = board.length === 0 ? 3 : 1;
    requireThat(r.deck.length >= n + 1, 'Insufficient cards for runout');
    r.deck.pop();
    board.push(...r.deck.splice(-n));
  }
  return board;
}
function beginRunoutVote(r, now) {
  const live = contenders(r),
    needed = runoutCardsNeeded(r.board.length);
  r.phase = 'runout_vote';
  r.turn = null;
  r.deadline = null;
  r.runVote = {
    opensAt: now + 1000,
    deadline: now + 1000 + RUNOUT_VOTE_MS,
    sharedBoard: [...r.board],
    canTwice: r.deck.length >= needed * 2,
    reason: r.deck.length < needed * 2 ? 'Not enough undealt cards for two runs' : null,
    revealed: false,
    voters: live.map(p => ({
      id: p.id,
      name: p.name,
      choice: null
    }))
  };
  log(r, 'Betting complete · Once / Twice vote');
}
export function resolveRunout(r, now = Date.now()) {
  requireThat(r.phase === 'runout_vote' && r.runVote && !r.runVote.revealed, 'No runout vote in progress');
  requireThat(now >= r.runVote.deadline, 'Runout vote is still open');
  const vote = r.runVote;
  vote.voters.forEach(v => {
    v.choice ??= 1;
  });
  vote.revealed = true;
  vote.resolvedAt = now;
  r.runCount = vote.canTwice && vote.voters.every(v => v.choice === 2) ? 2 : 1;
  vote.reason = vote.canTwice ? r.runCount === 2 ? 'Everyone chose Twice' : 'Once selected or a choice timed out' : 'Not enough undealt cards for two runs';
  r.runBoards = Array.from({
    length: r.runCount
  }, () => completeBoard(r, vote.sharedBoard));
  r.board = r.runBoards[0];
  r.boardBeforeAction = vote.sharedBoard.length;
  const message = `Run ${r.runCount === 2 ? 'twice' : 'once'} · ${vote.voters.map(v => `${v.name}: ${v.choice === 2 ? 'Twice' : 'Once'}`).join(' · ')}`;
  log(r, message);
  r.handEvents.push(message);
  handAction(r, { type: 'runout_resolved', street: 'runout', at: now, choices: vote.voters.map(v => ({ seat: r.players.find(p => p.id === v.id)?.seat, name: v.name, choice: v.choice })) });
  finish(r, false, now);
}
function chooseTurn(r, p, now) {
  r.turn = p.id;
  r.deadline = now + r.settings.timer * 1000;
}
function advance(r, from, now) {
  const live = contenders(r);
  if (live.length === 1) {
    finish(r, true, now);
    return;
  }
  const can = live.filter(p => p.stack > 0),
    pending = p => movable(p) && (!p.acted || p.bet < r.currentBet);
  if (can.length <= 1 && can.every(p => p.bet >= r.currentBet)) {
    returnUncalled(r);
    if (r.board.length < 5) {
      beginRunoutVote(r, now);
      return;
    }
    finish(r, false, now);
    return;
  }
  const next = ring(r, from, pending);
  if (next) {
    chooseTurn(r, next, now);
    return;
  }
  if (r.phase === 'river') {
    finish(r, false, now);
    return;
  }
  returnUncalled(r);
  r.phase = r.phase === 'preflop' ? 'flop' : r.phase === 'flop' ? 'turn' : 'river';
  r.deck.pop();
  r.board.push(...r.deck.splice(-(r.phase === 'flop' ? 3 : 1)));
  r.currentBet = 0;
  r.minRaise = r.settings.bb;
  participants(r).forEach(p => {
    p.bet = 0;
    p.acted = false;
    p.lastActBet = null;
    if (!p.folded) {
      p.action = null;
      p.actionAmount = null;
    }
  });
  log(r, r.phase.toUpperCase());
  r.handEvents.push(r.phase.toUpperCase());
  advance(r, r.dealer, now);
}
export function startHand(r, now = Date.now()) {
  requireThat(!r.terminationPending, 'Game termination is pending');
  requireThat(['lobby', 'showdown'].includes(r.phase), 'Finish the current hand first');
  if (r.phase === 'showdown' && r.players.some(p => p.pendingSeatAction === 'leave')) {
    requireThat(now >= r.payoutFinishedAt, 'Wait for payouts to finish');
    applySeatActions(r);
  }
  requireThat(r.players.filter(active).length >= 2, 'At least two players with chips must be ready');
  applyReloads(r);
  r.presentation = null;
  r.runVote = null;
  r.runCount = 1;
  r.runBoards = [];
  r.nextDealAt = null;
  r.boardBeforeAction = 0;
  r.uncontested = false;
  r.handStartedAt = now;
  r.game = (r.settings.games || GAMES)[Math.floor(r.completed / r.settings.rotation) % (r.settings.games || GAMES).length];
  r.phase = 'preflop';
  r.board = [];
  r.deck = shuffle();
  r.currentBet = r.settings.bb;
  r.minRaise = r.settings.bb;
  r.result = null;
  r.handEvents = [];
  r.handActionLog = [];
  r.handActionSeq = 0;
  r.uncalledReturns = [];
  r.players.forEach(p => {
    p.inHand = active(p);
    p.cards = [];
    p.action = null;
    p.actionAmount = null;
    p.folded = false;
    p.bet = 0;
    p.total = 0;
    p.acted = false;
    p.lastActBet = null;
  });
  const dealer = ring(r, r.dealer, p => p.inHand);
  r.dealer = dealer.seat;
  const n = participants(r).length,
    sb = n === 2 ? dealer : ring(r, r.dealer, p => p.inHand),
    bb = ring(r, sb.seat, p => p.inHand);
  r.handStartingStacks = Object.fromEntries(participants(r).map(p => [p.id, p.stack]));
  // Deal clockwise one card at a time, starting to the dealer's left.
  for (let i = 0; i < (r.game === 'NLH' ? 2 : r.game === 'PLO4' ? 4 : 5); i++) {
    let s = r.dealer;
    for (let j = 0; j < n; j++) {
      const p = ring(r, s, p => p.inHand);
      p.cards.push(r.deck.pop());
      s = p.seat;
    }
  }
  pay(sb, r.settings.sb);
  pay(bb, r.settings.bb);
  r.smallBlind = sb.id;
  r.bigBlind = bb.id;
  handAction(r, { type: 'hand_started', street: 'preflop', at: now, game: r.game, dealerSeat: r.dealer, seats: participants(r).map(p => ({ seat: p.seat, name: p.name, startingStack: r.handStartingStacks[p.id] })) });
  handAction(r, { type: 'blinds_posted', street: 'preflop', at: now, smallBlind: { seat: sb.seat, name: sb.name, amount: sb.bet, stackAfter: sb.stack }, bigBlind: { seat: bb.seat, name: bb.name, amount: bb.bet, stackAfter: bb.stack } });
  log(r, `Hand ${r.completed + 1} · ${r.game}`);
  r.handEvents.push(`Blinds ${sb.name} ${sb.bet} / ${bb.name} ${bb.bet}`);
  r.dealDuration = dealPlan(r).duration;
  advance(r, bb.seat, now + r.dealDuration);
}
// Raise reopening depends on the full increase since this player last acted.
// A short all-in alone does not reopen betting. PLO caps raises at call + pot.
export function legal(r, id) {
  const p = r.players.find(p => p.id === id);
  if (!p || r.turn !== id || !['preflop', 'flop', 'turn', 'river'].includes(r.phase)) return null;
  const call = Math.min(p.stack, Math.max(0, r.currentBet - p.bet)),
    fullCall = Math.max(0, r.currentBet - p.bet),
    own = p.bet + p.stack,
    raiseOpen = p.lastActBet === null || p.lastActBet === 0 || r.currentBet - p.lastActBet >= r.minRaise;
  const max = r.game === 'NLH' ? own : Math.min(own, p.bet + fullCall + pot(r) + fullCall),
    min = r.currentBet + r.minRaise;
  return {
    call,
    min,
    max,
    canRaise: raiseOpen && max > r.currentBet && (max >= min || max === own) && contenders(r).some(q => q.id !== id && q.stack > 0),
    pot: pot(r)
  };
}
export function act(r, id, type, amount, now = Date.now()) {
  const p = r.players.find(p => p.id === id),
    l = legal(r, id);
  requireThat(l, 'It is not your turn');
  r.boardBeforeAction = r.board.length;
  p.actionAmount = null;
  if (type === 'fold') {
    p.folded = true;
    p.action = 'Fold';
  } else if (type === 'check') {
    requireThat(l.call === 0, 'You need to call or fold');
    p.action = 'Check';
  } else if (type === 'call') {
    requireThat(l.call > 0, 'You can check');
    pay(p, l.call);
    p.actionAmount = l.call;
    p.action = p.stack === 0 ? 'All-in' : 'Call';
  } else if (type === 'raise') {
    requireThat(l.canRaise, 'Raising is not available');
    const target = integer(amount, 1, 100000000, 'Raise to');
    requireThat(target > r.currentBet && target <= l.max, 'Raise exceeds the legal limit');
    requireThat(target >= l.min || target === p.bet + p.stack, 'Raise is below the minimum');
    const increase = target - r.currentBet;
    pay(p, target - p.bet);
    if (increase >= r.minRaise) {
      r.minRaise = increase;
      participants(r).forEach(q => {
        if (q.id !== id && !q.folded && q.stack > 0) q.acted = false;
      });
    }
    p.action = p.stack === 0 ? 'All-in' : r.currentBet === 0 ? 'Bet' : `Raise to ${target}`;
    p.actionAmount = target;
    r.currentBet = target;
  } else throw new Error('Unknown action');
  p.acted = true;
  p.lastActBet = r.currentBet;
  const msg = `${p.name}: ${p.action}${p.actionAmount != null && !p.action.includes('to ') ? ` ${p.actionAmount}` : ''}`;
  log(r, msg);
  r.handEvents.push(msg);
  r.actionSeq = (r.actionSeq || 0) + 1;
  r.actionEvents = [...(r.actionEvents || []), {
    seq: r.actionSeq,
    type: p.action === 'All-in' ? 'allin' : type,
    name: p.name,
    at: now
  }].slice(-100);
  handAction(r, { type: p.action === 'All-in' ? 'allin' : type, street: r.phase, at: now, seat: p.seat, name: p.name, amount: p.actionAmount, total: p.total, stackAfter: p.stack });
  advance(r, p.seat, now);
}
export function autoDeal(r, now = Date.now()) {
  if (r.phase !== 'showdown') return false;
  if (r.terminationPending) {
    r.nextDealAt = null;
    if (now >= r.payoutFinishedAt) {
      closeGame(r);
      return true;
    }
    return false;
  }
  if (r.paused || r.players.filter(active).length < 2) {
    const changed = r.nextDealAt !== null;
    r.nextDealAt = null;
    return changed;
  }
  if (!r.nextDealAt) {
    r.nextDealAt = Math.max(now, r.payoutFinishedAt || now) + AUTO_DEAL_MS;
    return true;
  }
  if (now >= r.nextDealAt) {
    startHand(r, now);
    return true;
  }
  return false;
}
// Shared clock transition: server alarms call this; only practice uses a browser timer.
export function tick(r, now = Date.now(), allowDeal = true) {
  let changed = false;
  if (r.phase === 'showdown' && now >= r.payoutFinishedAt && r.players.some(p => p.pendingSeatAction === 'leave')) {
    applySeatActions(r);
    changed = true;
  }
  changed = applyReloads(r) || changed;
  if (r.phase === 'runout_vote' && now >= r.runVote.deadline) {
    resolveRunout(r, now);
    changed = true;
  }
  for (let n = 0; n < 8 && r.deadline && now >= r.deadline; n++) {
    const l = legal(r, r.turn);
    act(r, r.turn, l.call === 0 ? 'check' : 'fold', 0, now);
    changed = true;
  }
  return allowDeal && autoDeal(r, now) || changed;
}
export function shortcutRaiseTo(r, id, fraction = 1) {
  const l = legal(r, id);
  requireThat(l?.canRaise, 'Raising is not available');
  return Math.min(l.max, Math.max(Math.min(l.min, l.max), Math.floor(l.pot * fraction)));
}
export function net(p) {
  return p.cashout + p.stack - p.buyins;
}
export function settlement(r) {
  const debt = r.players.filter(p => net(p) < 0).map(p => ({
    id: p.id,
    name: p.name,
    n: -net(p)
  })),
    credit = r.players.filter(p => net(p) > 0).map(p => ({
      id: p.id,
      name: p.name,
      n: net(p)
    })),
    out = [];
  let i = 0,
    j = 0;
  while (i < debt.length && j < credit.length) {
    let a = debt[i],
      b = credit[j],
      amount = Math.min(a.n, b.n);
    out.push({
      from: a.id,
      to: b.id,
      fromName: a.name,
      toName: b.name,
      amount
    });
    a.n -= amount;
    b.n -= amount;
    if (!a.n) i++;
    if (!b.n) j++;
  }
  return out.map((p, i) => ({
    ...p,
    index: i,
    paid: r.payments.includes(i)
  }));
}
function latestHand(r) {
  const hand = r.history?.[0];
  requireThat(hand && hand.number === r.completed, 'No completed hand is available');
  return hand;
}
function voluntaryReveal(r, token, now) {
  requireThat(r.phase === 'showdown', 'Cards can be revealed after a hand ends');
  const hand = latestHand(r), player = hand.privateCards?.find(p => p.id === token);
  requireThat(player, 'Only a player dealt into this hand can reveal cards');
  if (hand.reveals.some(p => p.seat === player.seat)) return;
  const reveal = { seat: player.seat, name: player.name, cards: [...player.cards], at: now };
  hand.reveals.push(reveal);
  hand.updatedAt = Math.max(now, Number(hand.updatedAt || 0) + 1);
  handAction(r, { type: 'voluntary_reveal', street: 'posthand', ...reveal });
  hand.actionLog = structuredClone(r.handActionLog);
  log(r, `${player.name} voluntarily revealed cards`);
}
function rabbitHunt(r, token, now) {
  requireThat(r.phase === 'showdown', 'Rabbit Hunt is available after a hand ends');
  const player = r.players.find(p => p.id === token);
  requireThat(player && !player.left, 'Only seated players can request Rabbit Hunt');
  const hand = latestHand(r);
  requireThat(!hand.rabbitHunt, 'Rabbit Hunt has already been run for this hand');
  requireThat(hand.board.length < 5, 'Rabbit Hunt is only available when the board was incomplete');
  const board = completeBoard(r, hand.board);
  hand.rabbitHunt = { requestedBy: { seat: player.seat, name: player.name }, board, at: now };
  hand.updatedAt = Math.max(now, Number(hand.updatedAt || 0) + 1);
  handAction(r, { type: 'rabbit_hunt', street: 'posthand', at: now, requestedBy: { seat: player.seat, name: player.name }, board });
  hand.actionLog = structuredClone(r.handActionLog);
  log(r, `${player.name} ran Rabbit Hunt`);
}
export function command(r, token, input, now = Date.now()) {
  const me = r.players.find(p => p.id === token),
    isHost = r.host === token,
    type = input.type;
  if (type === 'join') {
    requireThat(r.phase !== 'closed', 'This game has ended');
    requireThat(!r.terminationPending, 'Game termination is pending');
    if (me && !me.left) {
      requireThat(me.pendingSeatAction !== 'leave', 'Stand Up is pending until this hand finishes');
      return;
    }
    const amount = integer(input.buyin ?? r.settings.buyin, r.settings.bb * 2, r.settings.maxBuyin, 'Starting chips'),
      taken = new Set(r.players.filter(p => !p.left).map(p => p.seat)),
      seat = input.seat === undefined ? Array.from({
        length: r.settings.seats
      }, (_, i) => i).find(s => !taken.has(s)) : integer(input.seat, 0, r.settings.seats - 1, 'Seat');
    requireThat(seat !== undefined, 'All seats are taken');
    requireThat(!taken.has(seat), 'That seat is taken. Choose another seat.');
    const name = me?.name || cleanName(input.name);
    if (me) {
      me.seat = seat;
      me.left = false;
      me.away = false;
      me.inHand = false;
      me.pendingSeatAction = null;
      me.cards = [];
      me.stack += amount;
      me.buyins += amount;
    } else r.players.push({
      id: token,
      name,
      seat,
      stack: amount,
      buyins: amount,
      cashout: 0,
      away: false,
      left: false,
      inHand: false
    });
    log(r, `${name} joined with ${amount} chips`);
    return;
  }
  if (type === 'end') {
    requireThat(r.phase !== 'closed', 'Game ended');
    if (handRunning(r) || r.phase === 'showdown' && now < r.payoutFinishedAt) {
      r.terminationPending = true;
      r.nextDealAt = null;
      log(r, 'Game will terminate after this hand');
    } else closeGame(r);
    return;
  }
  requireThat(me || isHost, 'Join the table first');
  if (['fold', 'check', 'call', 'raise'].includes(type)) {
    act(r, token, type, input.amount, now);
    return;
  }
  if (type === 'ready') {
    requireThat(me && !me.left && r.phase !== 'closed', 'Take a seat first');
    if (me.pendingSeatAction === 'sit_out') {
      me.pendingSeatAction = null;
      return;
    }
    requireThat(me.pendingSeatAction !== 'leave', 'Stand Up is pending');
    if (me.away) {
      me.away = false;
      return;
    }
    me.pendingSeatAction = 'sit_out';
    if (!handRunning(r)) applySeatActions(r, r.phase !== 'showdown' || now >= r.payoutFinishedAt);
    return;
  }
  if (type === 'runout_vote') {
    requireThat(r.phase === 'runout_vote' && r.runVote && !r.runVote.revealed, 'No open runout vote');
    requireThat(now >= r.runVote.opensAt && now < r.runVote.deadline, 'The runout vote is closed');
    const voter = r.runVote.voters.find(v => v.id === token);
    requireThat(voter, 'Only players remaining in the hand can vote');
    const choice = integer(input.choice, 1, 2, 'Run count');
    requireThat(choice === 1 || r.runVote.canTwice, 'Not enough undealt cards to run twice');
    voter.choice = choice;
    return;
  }
  if (type === 'voluntary_reveal') {
    voluntaryReveal(r, token, now);
    return;
  }
  if (type === 'rabbit_hunt') {
    rabbitHunt(r, token, now);
    return;
  }
  if (type === 'rebuy') {
    requireThat(r.phase !== 'closed', 'Session ended');
    requireThat(me && !me.left, 'Take a seat first');
    requireThat(!r.terminationPending, 'Game termination is pending');
    requireThat(me.pendingSeatAction !== 'leave', 'Stand Up is pending');
    const amount = integer(input.amount, r.settings.bb, r.settings.maxBuyin, 'Reload');
    requireThat(!r.requests.some(q => q.id === token), 'A reload is already queued for the next hand');
    r.requests.push({
      id: token,
      name: me.name,
      amount
    });
    applyReloads(r);
    return;
  }
  if (type === 'cancel_stand_up') {
    requireThat(me && !me.left && r.phase !== 'closed', 'Take a seat first');
    requireThat(me.pendingSeatAction === 'leave', 'No pending Stand Up');
    requireThat(!r.terminationPending, 'Game termination is pending');
    me.pendingSeatAction = null;
    log(r, `${me.name} cancelled Stand Up`);
    return;
  }
  if (type === 'set_away') {
    requireThat(me && !me.left && r.phase !== 'closed', 'Take a seat first');
    requireThat(me.pendingSeatAction !== 'leave', 'Stand Up is pending');
    me.away = Boolean(input.away);
    if (me.pendingSeatAction === 'sit_out') me.pendingSeatAction = null;
    // Away affects future deals only; committed players retain their turn and deadlines.
    log(r, `${me.name} is ${me.away ? 'away' : 'back'}`);
    return;
  }
  if (type === 'leave' || type === 'stand_up') {
    requireThat(me && !me.left && r.phase !== 'closed', 'Take a seat first');
    requireThat(!r.terminationPending, 'Game termination is pending');
    if (me.pendingSeatAction === 'leave') return;
    me.pendingSeatAction = 'leave';
    // Unapplied reloads never become a buy-in just because the player is leaving.
    r.requests = r.requests.filter(q => q.id !== token);
    if (!handRunning(r) && !(r.phase === 'showdown' && now < r.payoutFinishedAt)) applySeatActions(r);
    return;
  }
  requireThat(isHost, 'Only the host can do this');
  if (type === 'pause') {
    r.paused = !r.paused;
    r.nextDealAt = null;
    log(r, r.paused ? 'Auto-deal paused' : 'Auto-deal resumed');
    return;
  }
  if (type === 'deal') {
    startHand(r, now);
    return;
  }
  if (type === 'rotation') {
    requireThat(['lobby', 'showdown'].includes(r.phase), 'Change rotation between hands');
    requireThat(r.completed === 0, 'Rotation is locked once the session starts');
    r.settings.rotation = integer(input.rotation, 2, 4, 'Hands per game');
    return;
  }
  if (type === 'paid') {
    requireThat(r.phase === 'closed', 'End the session first');
    const index = integer(input.index, 0, 100, 'Payment');
    requireThat(settlement(r).some(p => p.index === index), 'Payment not found');
    r.payments = r.payments.includes(index) ? r.payments.filter(i => i !== index) : [...r.payments, index];
    return;
  }
  throw new Error('Unknown command');
}
/** The privacy boundary for every client snapshot; never send a raw room. */
export function view(r, token, now = Date.now(), spectator = false) {
  const me = r.players.find(p => p.id === token);
  requireThat(me || spectator || r.host === token, 'Join this table to see it');
  const {
    deck,
    host,
    handStartingStacks,
    ...safe
  } = structuredClone(r);
  safe.host = isHostId(r, token);
  safe.me = token;
  safe.serverTime = now;
  safe.legal = legal(r, token);
  safe.rotationIndex = Math.floor((['showdown', 'closed'].includes(r.phase) ? Math.max(0, r.completed - 1) : r.completed) / r.settings.rotation) % (r.settings.games || GAMES).length;
  safe.handsIntoRotation = ['showdown', 'closed'].includes(r.phase) ? (Math.max(1, r.completed) - 1) % r.settings.rotation + 1 : r.completed % r.settings.rotation;
  safe.players = safe.players.map(p => ({
    ...p,
    id: p.id === token ? p.id : `seat-${p.seat}-${r.players.indexOf(r.players.find(q => q.id === p.id))}`,
    cards: p.id === token || r.phase === 'showdown' && (p.inHand && !r.uncontested && !p.folded || r.history?.[0]?.reveals?.some(reveal => reveal.seat === p.seat)) ? p.cards : undefined,
    net: net(p)
  }));
  // Internal player IDs are stable identities, not login credentials. Alias other
  // players consistently across cards, votes, results and history.
  const alias = id => id === token ? id : r.players.find(p => p.id === id) ? `seat-${r.players.find(p => p.id === id).seat}-${r.players.findIndex(p => p.id === id)}` : null;
  safe.uncalledReturns = (safe.uncalledReturns || []).map(entry => ({ ...entry, id: alias(entry.id) }));
  safe.history = safe.history.map(({ privateCards, ...hand }) => ({ ...hand, uncalledReturns: (hand.uncalledReturns || []).map(entry => ({ ...entry, id: alias(entry.id) })) }));
  safe.runVote = r.runVote ? {
    ...safe.runVote,
    voters: r.runVote.voters.map(v => ({
      id: alias(v.id),
      name: v.name,
      hasVoted: v.choice !== null,
      choice: r.runVote.revealed || v.id === token ? v.choice : null
    }))
  } : null;
  safe.turn = alias(r.turn);
  safe.smallBlind = alias(r.smallBlind);
  safe.bigBlind = alias(r.bigBlind);
  safe.requests = safe.requests.map(q => ({
    ...q,
    id: alias(q.id)
  }));
  safe.result = safe.result?.map(w => ({
    ...w,
    id: alias(w.id)
  }));
  safe.history = safe.history.map(h => ({
    ...h,
    result: h.result.map(w => ({
      ...w,
      id: alias(w.id)
    }))
  }));
  safe.settlements = r.phase === 'closed' ? settlement(r).map(p => ({
    ...p,
    from: alias(p.from),
    to: alias(p.to)
  })) : [];
  return safe;
}
export const isHostId = (r, id) => r.host === id;
export function resolveAlias(r, alias) {
  return r.players.find((p, i) => `seat-${p.seat}-${i}` === alias)?.id || alias;
}
