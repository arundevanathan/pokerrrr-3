import { bettingOpportunity } from './raise-selection.mjs';

// Confirmation belongs to this exact decision; it cannot authorize a later fold.
export function freeCheckDecision(room) {
  if (!room || !['preflop', 'flop', 'turn', 'river'].includes(room.phase) || room.legal?.call !== 0) return null;
  return bettingOpportunity(room);
}
export function foldConfirmationValid(decision, room) {
  return Boolean(decision && decision === freeCheckDecision(room));
}
