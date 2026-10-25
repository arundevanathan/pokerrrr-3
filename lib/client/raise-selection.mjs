export function bettingOpportunity(room) {
  if (!room?.legal || room.turn!==room.me) return null;
  // actionSeq also distinguishes a returned turn on the same street after a
  // short all-in; state version alone would reset on unrelated votes/reloads.
  return [room.code,room.handStartedAt,room.phase,room.turn,room.actionSeq,room.currentBet,room.legal.min,room.legal.max].join(':');
}
export function nextRaise(previous, room, currentAmount) {
  const minimum=room?.legal?Math.min(room.legal.min,room.legal.max):0;
  const opportunity=bettingOpportunity(room);
  const reset=opportunity!==bettingOpportunity(previous);
  return { reset, amount:reset?minimum:Math.min(room?.legal?.max||0,Math.max(minimum,currentAmount||minimum)) };
}
