// Dates use the group's India timezone. Amounts remain integer chips.
const DAY = 86400000,
  INDIA_OFFSET = 330 * 60000;
export function indiaDate(time = Date.now()) {
  return new Date(time + INDIA_OFFSET).toISOString().slice(0, 10);
}
function dateStart(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose valid From and To dates');
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error('Choose valid From and To dates');
  return timestamp - INDIA_OFFSET;
}
// Convert inclusive India calendar dates into a half-open timestamp interval.
export function historyRange(from, to, required = false) {
  if (!from && !to && !required) return {
    start: -Infinity,
    end: Infinity
  };
  const start = dateStart(from),
    end = dateStart(to) + DAY;
  if (start >= end) throw new Error('From date must be on or before To date');
  return {
    start,
    end
  };
}
const amount = value => Number.isSafeInteger(value) && value >= 0;
export function gameResults(record) {
  if (!Array.isArray(record.players) || !Number.isFinite(record.closedAt)) throw new Error('Incomplete game history');
  const ids = new Set();
  const players = record.players.map(p => {
    if (!p.id || ids.has(p.id) || !amount(p.buyins) || !amount(p.cashout)) throw new Error('Invalid player accounting in game history');
    ids.add(p.id);
    return {
      id: p.id,
      name: p.name,
      buyins: p.buyins,
      cashout: p.cashout,
      net: p.cashout - p.buyins
    };
  });
  if (players.reduce((sum, p) => sum + p.net, 0) !== 0) throw new Error('Game history does not balance; settlement is unavailable');
  return {
    ...record,
    players
  };
}
// Owner-confirmed historical aliases only. Other shared names remain separate IDs.
const confirmedHistoryNames = new Map([
  ['arun', 'Dunzo'], ['dunzo', 'Dunzo'], ['ishita', 'Ishita']
]);
const confirmedHistoryName = name => confirmedHistoryNames.get(String(name).trim().toLowerCase());
export function canonicalHistory(records, roster = []) {
  const accounts = new Map(roster.map(p => [p.id, p]));
  const targets = new Map();
  for (const name of ['Dunzo', 'Ishita']) {
    const matches = roster.filter(p => confirmedHistoryName(p.name) === name);
    if (matches.length > 1) throw new Error(`Multiple current accounts for ${name}; verify the roster before settlement`);
    if (matches.length === 1) targets.set(name, {id: matches[0].id, name});
  }
  return records.map(record => {
    // Validate original accounting before resolving IDs; never rewrite the archive.
    const game = gameResults(record), players = new Map();
    for (const p of game.players) {
      const account = accounts.get(p.id);
      const identity = account
        ? targets.get(confirmedHistoryName(account.name)) || account
        : targets.get(confirmedHistoryName(p.name));
      const id = identity?.id || p.id, name = identity?.name || p.name;
      const total = players.get(id) || {id, name, buyins: 0, cashout: 0};
      total.buyins += p.buyins;
      total.cashout += p.cashout;
      if (![total.buyins, total.cashout].every(Number.isSafeInteger)) throw new Error('Settlement exceeds the supported chip limit');
      players.set(id, total);
    }
    return {...game, players: [...players.values()]};
  });
}
// Validate each completed game before combining balances by stable player ID.
export function aggregateGames(records) {
  const totals = new Map();
  for (const record of [...records].sort((a, b) => a.closedAt - b.closedAt)) {
    for (const p of gameResults(record).players) {
      const total = totals.get(p.id) || {
        id: p.id,
        name: p.name,
        buyins: 0,
        cashout: 0,
        net: 0,
        games: 0
      };
      total.name = p.name;
      total.buyins += p.buyins;
      total.cashout += p.cashout;
      total.net += p.net;
      total.games++;
      if (![total.buyins, total.cashout, total.net].every(Number.isSafeInteger)) throw new Error('Settlement exceeds the supported chip limit');
      totals.set(p.id, total);
    }
  }
  return [...totals.values()].sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
}
// Work on copied balances: household offsets change transfers, not player results.
export function suggestedPayments(totals, preferredPair = []) {
  if (totals.reduce((sum, p) => sum + p.net, 0) !== 0) throw new Error('Player totals do not balance');
  const balances = new Map(totals.map(p => [p.id, {
    ...p,
    remaining: p.net
  }])),
    payments = [];
  function match(debtor, creditor) {
    const amount = Math.min(-debtor.remaining, creditor.remaining);
    if (amount <= 0) return;
    payments.push({
      from: debtor.id,
      to: creditor.id,
      fromName: debtor.name,
      toName: creditor.name,
      amount
    });
    debtor.remaining += amount;
    creditor.remaining -= amount;
  }
  const [a, b] = preferredPair.map(id => balances.get(id));
  if (a && b) {
    if (a.remaining < 0 && b.remaining > 0) match(a, b);
  else if (b.remaining < 0 && a.remaining > 0) match(b, a);
  }
  const debtors = [...balances.values()].filter(p => p.remaining < 0).sort((a, b) => a.remaining - b.remaining || a.id.localeCompare(b.id));
  const creditors = [...balances.values()].filter(p => p.remaining > 0).sort((a, b) => b.remaining - a.remaining || a.id.localeCompare(b.id));
  let i = 0,
    j = 0;
  while (i < debtors.length && j < creditors.length) {
    match(debtors[i], creditors[j]);
    if (!debtors[i].remaining) i++;
    if (!creditors[j].remaining) j++;
  }
  return payments;
}
export function householdPair(totals, roster = []) {
  // Resolve to stable player IDs before matching. Archived names cover retired profiles.
  return ['Dunzo', 'Ishita'].map(name => roster.find(p => p.name === name && totals.some(t => t.id === p.id))?.id || totals.find(p => p.name === name)?.id).filter(Boolean);
}
export async function historyPlayerKey(id) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function publicHistory(records) {
  return Promise.all(records.map(async record => {
    const game = gameResults(record);
    return {
      code: game.code,
      createdAt: game.createdAt,
      closedAt: game.closedAt,
      completed: game.completed,
      players: await Promise.all(game.players.map(async ({
        id,
        ...p
      }) => ({
        ...p,
        key: await historyPlayerKey(id)
      })))
    };
  }));
}
export function currentSettlementWeek(time = Date.now()) {
  const to = indiaDate(time),
    day = new Date(`${to}T00:00:00Z`).getUTCDay();
  return {
    from: indiaDate(dateStart(to) - (day + 6) % 7 * DAY),
    to
  };
}
export function settlementDate(value) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(dateStart(value));
}
export async function historyViewerKey(player, examples) {
  // Only synthetic records use names to bridge their deliberately separate identities.
  const ids = examples ? [...new Set(examples.flatMap(g => g.players.filter(p => p.name === player.name).map(p => p.id)))] : [player.id];
  return ids.length === 1 ? historyPlayerKey(ids[0]) : null;
}
export function settlementText(result) {
  const number = n => new Intl.NumberFormat('en-IN').format(n);
  return [`Dunzo Club · Settlement${result.demo ? ' · SIMULATED' : ''}`, `${settlementDate(result.from)} – ${settlementDate(result.to)} (India time)`, `${result.gameCount} completed games · 1 chip = Rs.1`, '', 'Player Win / Loss Totals', ...result.totals.map(p => `${p.name}: ${p.net > 0 ? '+' : ''}${number(p.net)}`), '', 'Suggested Payments', ...(result.payments.length ? result.payments.map(p => `${p.fromName} → ${p.toName}: Rs.${number(p.amount)}`) : ['Nothing to settle.']), '', 'Suggestions only · Nothing is marked paid.'].join('\n');
}
