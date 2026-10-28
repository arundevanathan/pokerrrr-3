// Shared timing and geometry keep sound, cards, and the first action clock aligned.
export const SHUFFLE_MS = 480,
  DEAL_STEP_MS = 90,
  FLIGHT_MS = 180;
export function dealPlan(room) {
  const players = room.players.filter(p => p.inHand).sort((a, b) => (a.seat - room.dealer + room.settings.seats - 1) % room.settings.seats - (b.seat - room.dealer + room.settings.seats - 1) % room.settings.seats);
  const count = room.game === 'NLH' ? 2 : room.game === 'PLO4' ? 4 : 5;
  const flights = [];
  for (let round = 0; round < count; round++) players.forEach((p, index) => flights.push({
    seat: p.seat,
    round,
    at: SHUFFLE_MS + (round * players.length + index) * DEAL_STEP_MS,
    arrival: SHUFFLE_MS + (round * players.length + index) * DEAL_STEP_MS + FLIGHT_MS
  }));
  return {
    flights,
    duration: flights.length ? flights.at(-1).arrival + 160 : 0
  };
}
export function seatPosition(seat, mySeat, seats) {
  const theta = Math.PI / 2 + (seat - mySeat + seats) % seats * (Math.PI * 2 / seats);
  return {
    x: 50 + 44 * Math.cos(theta),
    y: 49 + 43 * Math.sin(theta)
  };
}
export function boardPlan(from, to) {
  const events = [];
  let at = 0;
  for (let index = from; index < to; index++) {
    if (index > from) at += index < 3 ? 160 : 520;
    events.push({
      index,
      at
    });
  }
  return events;
}
export const AUTO_DEAL_MS = 3000;
export const RUNOUT_VOTE_MS = 5000;
export const RUNOUT_ANNOUNCEMENT_MS = 2000;
export const PAYOUT_FLIGHT_MS = 1400;
export const PAYOUT_STEP_MS = PAYOUT_FLIGHT_MS + 300;
export function slowBoardPlan(from, to) {
  const events = [];
  let at = 0;
  for (let index = from; index < to; index++) {
    if (index > from) at += index < 3 ? 450 : 1100;
    events.push({
      index,
      at
    });
  }
  return events;
}
// Shared with the engine: payout completion gates the next deal and termination.
export function showdownTiming(boardFrom, boardTo, recipients = 1, runCount = 1, runRecipients = [], hasVote = false) {
  const slow = hasVote || runCount === 2,
    announcementDuration = hasVote ? RUNOUT_ANNOUNCEMENT_MS : 0,
    runs = [];
  let cursor = announcementDuration;
  for (let i = 0; i < runCount; i++) {
    const events = slow ? slowBoardPlan(boardFrom, boardTo) : boardPlan(boardFrom, boardTo),
      resultAt = cursor + (events.at(-1)?.at || 0) + (events.length ? 700 : 240),
      count = runRecipients[i] ?? recipients,
      payoutStart = resultAt + 350,
      payoutEnd = payoutStart + Math.max(0, count - 1) * PAYOUT_STEP_MS + PAYOUT_FLIGHT_MS,
      endAt = Math.max(resultAt + 2800, payoutEnd + 450);
    runs.push({
      run: i + 1,
      boardStart: cursor,
      events,
      resultAt,
      payoutStart,
      payoutEnd,
      endAt
    });
    cursor = endAt + (i < runCount - 1 ? 600 : 0);
  }
  return {
    announcementDuration,
    payoutStepMs: PAYOUT_STEP_MS,
    runs,
    revealDelay: runs[0].resultAt,
    summaryAt: cursor,
    payoutDuration: cursor
  };
}
export function presentationAt(plan, elapsed) {
  if (elapsed < plan.announcementDuration) return {
    phase: 'announcement',
    run: null
  };
  for (const run of plan.runs) {
    if (elapsed < run.resultAt) return {
      phase: 'dealing',
      run: run.run
    };
    if (elapsed < run.endAt) return {
      phase: 'award',
      run: run.run
    };
  }
  return {
    phase: 'summary',
    run: null
  };
}
// One transfer per pot share, highest side pot first, then the main pot.
// Returns travel with the player's first award, without being counted as winnings.
export function payoutAwards(results = [], runCount = 1, byPot = true, combine = false) {
  const awards = [];
  for (let run = 1; run <= runCount; run++) {
    for (const winner of results) {
      const hand = winner.runHands?.find(h => h.run === run),
        amount = hand?.wonAmount ?? (runCount === 1 ? winner.wonAmount ?? Math.max(0, (winner.amount || 0) - (winner.returnedAmount || 0)) : 0),
        pots = byPot && winner.pots?.length ? winner.pots.filter(p => (p.run || 1) === run) : amount > 0 ? [{label: 'Main pot', amount}] : [];
      for (const pot of pots) if (pot.amount > 0) awards.push({
        id: winner.id,
        name: winner.name,
        run,
        label: pot.label,
        potIndex: pot.label === 'Main pot' ? 0 : Number(pot.label.match(/\d+/)?.[0] || 1),
        amount: pot.amount,
        wonAmount: pot.amount,
        description: hand?.description || hand?.hand || winner.description || winner.hand,
        winningCards: hand?.winningCards || winner.winningCards || [],
        tied: Boolean(pot.tied),
        returned: false
      });
    }
  }
  awards.sort((a, b) => a.run - b.run || b.potIndex - a.potIndex);
  for (const winner of results) if (winner.returnedAmount > 0) {
    const first = awards.find(a => a.id === winner.id);
    if (first) {
      first.amount += winner.returnedAmount;
      first.returnedAmount = winner.returnedAmount;
    } else if (byPot) awards.push({
      id: winner.id, name: winner.name, run: 1, label: 'Uncalled bet returned',
      potIndex: -1, amount: winner.returnedAmount, wonAmount: 0,
      returnedAmount: winner.returnedAmount, returned: true
    });
  }
  if (combine) {
    const combined = [];
    for (let run = 1; run <= runCount; run++) {
      const shares = awards.filter(a => a.run === run && !a.returned);
      if (shares.length && new Set(shares.map(a => a.id)).size === 1) {
        combined.push({ ...shares[0], label: 'Pot', potIndex: 0,
          amount: shares.reduce((n, a) => n + a.amount, 0),
          wonAmount: shares.reduce((n, a) => n + a.wonAmount, 0) });
      } else combined.push(...shares);
      combined.push(...awards.filter(a => a.run === run && a.returned));
    }
    return combined;
  }
  return awards.sort((a, b) => a.run - b.run || b.potIndex - a.potIndex);
}
export function payoutEvents(room, startedAt, plan) {
  // An in-flight hand may have a persisted plan from before per-pot animation.
  // Honor that plan's original deadline until the next hand gets the new timing.
  const awards = payoutAwards(room.result, room.runCount, Boolean(plan.payoutStepMs), Boolean(plan.combineAwards));
  return plan.runs.flatMap(run => awards.filter(a => a.run === run.run).map((award, index) => ({
    ...award,
    at: startedAt + run.payoutStart + index * (plan.payoutStepMs || 260),
    duration: PAYOUT_FLIGHT_MS
  })));
}
// Server stacks already include awards; hide chips until their animation arrives.
export function visibleStack(player, payouts, now) {
  return player.stack - payouts.filter(e => e.id === player.id && now < e.at + e.duration).reduce((sum, e) => sum + e.amount, 0);
}
