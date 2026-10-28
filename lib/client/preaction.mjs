// A queued choice belongs to one player, table, hand and betting street.
export function bettingLevel(room) {
  return Number.isFinite(room?.currentBet) ? room.currentBet : Math.max(0, ...(room?.players || []).filter(p => p.inHand && !p.folded).map(p => p.bet || 0));
}
export function waitingCall(room) {
  const me = room?.players.find(p => p.id === room.me);
  return Math.min(me?.stack || 0, Math.max(0, bettingLevel(room) - (me?.bet || 0)));
}
export function queuePreaction(choice, room) {
  return { choice, player: room.me, code: room.code, hand: room.handStartedAt,
    phase: room.phase, amount: waitingCall(room), betLevel: bettingLevel(room) };
}
export function preactionValid(queued, room) {
  const me = room?.players.find(p => p.id === room.me);
  if (!(queued && me?.inHand && !me.folded && !me.away && !me.left && me.stack > 0
    && queued.player === room.me && queued.code === room.code
    && queued.hand === room.handStartedAt && queued.phase === room.phase
    && ['preflop', 'flop', 'turn', 'river'].includes(room.phase))) return false;
  if (queued.choice === 'check') return waitingCall(room) === 0;
  // Compare the underlying wager too: a short stack's capped call can stay the
  // same after a raise, but that raise must still cancel the selected intent.
  if (queued.choice === 'call') return queued.amount > 0 && queued.amount === waitingCall(room) && queued.betLevel === bettingLevel(room);
  return true;
}
export function resolvePreaction(queued, call) {
  const choice = typeof queued === 'string' ? queued : queued?.choice;
  if (choice === 'fold') return 'fold';
  if (choice === 'call') return queued?.amount > 0 && queued.amount === call ? 'call' : null;
  if (!call) return 'check';
  return choice === 'check-fold' ? 'fold' : null;
}
