// Only the explicitly local practice simulation imports the engine in the client.
// Multiplayer uses PokerClient and can never mutate this state on the server.
export { newRoom, command, startHand, act, legal, view, resolveAlias, tick } from '../poker.mjs';
export function shortcutRaiseTo(room, id, fraction = 1, base = 'pot') {
  const legal = room.legal;
  if (!legal?.canRaise || room.me !== id) throw new Error('Raising is not available');
  const amount = base === 'bet' ? room.currentBet : legal.pot;
  return Math.min(legal.max, Math.max(Math.min(legal.min, legal.max), Math.floor(amount * fraction)));
}
