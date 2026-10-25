import test from 'node:test';
import assert from 'node:assert/strict';
import { currentSettlementWeek, settlementDate, settlementText, historyViewerKey, historyPlayerKey, historyRange, indiaDate, aggregateGames, suggestedPayments, householdPair, publicHistory } from '../lib/game-history.mjs';
import { historyExamples } from './history-fixtures.mjs';
import { TableService } from '../server/table-service.mjs';
const now = Date.parse('2026-10-25T12:00:00Z');
function storage(records) {
  const values = new Map(records.map((g, i) => [`session:${String(i).padStart(4, '0')}`, g]));
  return {
    values,
    async list({
      prefix,
      limit,
      startAfter
    }) {
      return new Map([...values].filter(([k]) => k.startsWith(prefix) && (!startAfter || k > startAfter)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit));
    }
  };
}
test('date boundaries are inclusive India calendar days, with strict validation', () => {
  const {
    start,
    end
  } = historyRange('2026-10-25', '2026-10-25', true);
  assert.equal(new Date(start).toISOString(), '2026-10-24T18:30:00.000Z');
  assert.equal(new Date(end).toISOString(), '2026-10-25T18:30:00.000Z');
  assert.equal(indiaDate(start), '2026-10-25');
  assert.equal(indiaDate(end), '2026-10-26');
  for (const pair of [['2026-02-30', '2026-03-01'], ['2026-10-26', '2026-10-25'], ['', '2026-10-25'], ['2026-10-25', undefined]]) assert.throws(() => historyRange(...pair, true));
});
test('household is matched first in either direction without merging individual balances', () => {
  for (const sign of [1, -1]) {
    const totals = [{
      id: 'arun',
      name: 'Dunzo',
      net: -700 * sign
    }, {
      id: 'ishita',
      name: 'Ishita',
      net: 300 * sign
    }, {
      id: 'other',
      name: 'Varun',
      net: 400 * sign
    }];
    const result = suggestedPayments(totals, householdPair(totals));
    assert.deepEqual(result[0], {
      from: sign === 1 ? 'arun' : 'ishita',
      to: sign === 1 ? 'ishita' : 'arun',
      fromName: sign === 1 ? 'Dunzo' : 'Ishita',
      toName: sign === 1 ? 'Ishita' : 'Dunzo',
      amount: 300
    });
    assert.equal(result[1].amount, 400);
    assert.equal(totals[0].net, -700 * sign);
  }
  const totals = [{
    id: 'a',
    name: 'Dunzo',
    net: -200
  }, {
    id: 'b',
    name: 'Ishita',
    net: -100
  }, {
    id: 'c',
    name: 'Varun',
    net: 300
  }];
  assert.ok(suggestedPayments(totals, householdPair(totals)).every(p => p.to === 'c'));
});
test('aggregated suggestions reconcile every individual net, including absent and break-even players', () => {
  const games = historyExamples(now),
    totals = aggregateGames(games),
    payments = suggestedPayments(totals, householdPair(totals));
  assert.equal(totals.reduce((n, p) => n + p.net, 0), 0);
  for (const p of totals) {
    assert.equal(payments.reduce((n, t) => n + (t.to === p.id ? t.amount : 0) - (t.from === p.id ? t.amount : 0), 0), p.net);
  }
  assert.ok(totals.find(p => p.name === 'Saboo').games < 8);
  assert.ok(payments.every(p => p.from !== p.to && Number.isInteger(p.amount) && p.amount > 0));
  assert.throws(() => aggregateGames([{
    ...games[0],
    players: games[0].players.map((p, i) => ({
      ...p,
      cashout: p.cashout + (i === 0 ? 1 : 0)
    }))
  }]), /does not balance/);
  const renamed = structuredClone(games);
  renamed[0].players[0].name = 'Arun';
  assert.equal(aggregateGames(renamed).find(p => p.id === games[0].players[0].id).name, 'Arun');
});
test('history pagination and date-range settlement include all archives beyond a storage page', async () => {
  const examples = historyExamples(now),
    games = Array.from({
      length: 260
    }, (_, i) => ({
      ...examples[i % 8],
      code: `G${String(i).padStart(5, '0')}`,
      closedAt: Date.parse('2026-10-10T12:00:00Z') + i * 1000
    })),
    store = storage(games),
    service = new TableService(store);
  let cursor,
    seen = [];
  do {
    const page = await service.history({
      cursor
    });
    assert.ok(page.games.length <= 20);
    seen.push(...page.games.map(g => g.code));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(new Set(seen).size, 260);
  assert.equal(seen.length, 260);
  const before = JSON.stringify([...store.values]),
    result = await service.settlement({
      from: '2026-10-10',
      to: '2026-10-10'
    });
  assert.equal(result.gameCount, 260);
  assert.equal(result.suggestionsOnly, true);
  assert.equal(JSON.stringify([...store.values]), before);
  assert.equal((await service.settlement({
    from: '2026-10-11',
    to: '2026-10-11'
  })).gameCount, 0);
  assert.deepEqual((await service.settlement({
    from: '2026-10-11',
    to: '2026-10-11'
  })).payments, []);
  await assert.rejects(service.history({
    cursor: 'not-a-cursor'
  }), /Invalid history page/);
});
test('public history removes private IDs and contains only closed-game accounting fields', async () => {
  const record = historyExamples(now)[0];
  record.deck = [1, 2, 3];
  record.secret = 'not-public';
  const [publicGame] = await publicHistory([record]);
  assert.equal(publicGame.deck, undefined);
  assert.equal(publicGame.secret, undefined);
  for (const p of record.players) assert.ok(!JSON.stringify(publicGame).includes(p.id));
  assert.ok(publicGame.players.every(p => p.key.length === 64));
});
test('simulated history is isolated from real archives for history and settlement', async () => {
  const examples = historyExamples(now),
    service = new TableService(storage([examples[0]]));
  assert.equal((await service.history()).games.length, 1);
  assert.equal((await service.history({
    examples: []
  })).games.length, 0);
  assert.equal((await service.history({
    examples
  })).games.length, 8);
  const result = await service.settlement({
    from: '2026-01-01',
    to: '2026-12-31',
    examples
  });
  assert.equal(result.gameCount, 8);
});
test('seed helper inserts all eight examples and cleanup preserves unrelated rows', async () => {
  const {
    mkdtempSync,
    mkdirSync,
    rmSync
  } = await import('node:fs'),
    {
      join
    } = await import('node:path'),
    {
      execFileSync
    } = await import('node:child_process'),
    {
      DatabaseSync
    } = await import('node:sqlite');
  const root = mkdtempSync('/tmp/dunzo-history-seed-'),
    dir = join(root, 'v3/do/TestClubTable');
  mkdirSync(dir, {
    recursive: true
  });
  const path = join(dir, `${'a'.repeat(64)}.sqlite`);
  try {
    let db = new DatabaseSync(path);
    db.exec("CREATE TABLE history_examples(id TEXT PRIMARY KEY,record TEXT NOT NULL); INSERT INTO history_examples VALUES('unrelated','{}')");
    db.close();
    execFileSync(process.execPath, ['scripts/create-history-examples.mjs', '--database', path]);
    db = new DatabaseSync(path);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM history_examples WHERE id LIKE 'demo-%'").get().n, 8);
    db.close();
    execFileSync(process.execPath, ['scripts/create-history-examples.mjs', '--clear', '--database', path]);
    db = new DatabaseSync(path);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM history_examples').get().n, 1);
    assert.equal(db.prepare('SELECT id FROM history_examples').get().id, 'unrelated');
    db.close();
  } finally {
    rmSync(root, {
      recursive: true,
      force: true
    });
  }
});
test('settlement week follows India Monday boundaries, including Sunday and year rollover', () => {
  assert.deepEqual(currentSettlementWeek(Date.parse('2026-10-25T18:29:59Z')), {
    from: '2026-10-19',
    to: '2026-10-25'
  });
  assert.deepEqual(currentSettlementWeek(Date.parse('2026-10-25T18:30:00Z')), {
    from: '2026-10-26',
    to: '2026-10-26'
  });
  assert.deepEqual(currentSettlementWeek(Date.parse('2027-01-01T00:00:00Z')), {
    from: '2026-12-28',
    to: '2027-01-01'
  });
  assert.match(settlementDate('2026-10-19'), /Mon/);
});
test('viewer keys use authenticated identity and map only isolated examples by name', async () => {
  const player = {
    id: 'real-dunzo',
    name: 'Dunzo'
  },
    examples = historyExamples(now);
  assert.equal(await historyViewerKey(player), await historyPlayerKey(player.id));
  assert.equal(await historyViewerKey(player, examples), await historyPlayerKey(examples[0].players[0].id));
  assert.equal(await historyViewerKey({
    ...player,
    name: 'Unknown'
  }, examples), null);
  assert.equal(await historyViewerKey(player, [...examples, {
    players: [{
      id: 'duplicate',
      name: 'Dunzo'
    }]
  }]), null);
});
test('share text includes date weekdays, totals before suggestions and simulated label', async () => {
  const result = await new TableService(storage(historyExamples(now))).settlement({
    from: '2026-10-19',
    to: '2026-10-25'
  });
  const text = settlementText({
    ...result,
    demo: true
  });
  assert.match(text, /SIMULATED/);
  assert.match(text, /Mon.*Sun/);
  assert.ok(text.indexOf('Player Win / Loss') < text.indexOf('Suggested Payments'));
  assert.match(text, /Nothing is marked paid/);
});

test('confirmed legacy Arun/Dunzo and Ishita identities settle once under current accounts', async () => {
  const roster = [{id: 'current-arun', name: 'Dunzo'}, {id: 'current-ishita', name: 'Ishita'}];
  const records = [
    {code: 'OLD', closedAt: now, players: [
      {id: 'legacy-arun', name: 'Arun', buyins: 3000, cashout: 475},
      {id: 'legacy-ishita', name: 'Ishita', buyins: 3000, cashout: 5525}
    ]},
    ...[100, 100, 75].map((loss, i) => ({code: `NEW-${i}`, closedAt: now + i + 1, players: [
      {id: 'current-arun', name: 'Dunzo', buyins: 1000, cashout: 1000 - loss},
      {id: 'current-ishita', name: 'Ishita', buyins: 1000, cashout: 1000 + loss}
    ]}))
  ];
  const store = storage(records), before = JSON.stringify([...store.values]);
  const service = new TableService(store);
  const result = await service.settlement({from: '2026-10-25', to: '2026-10-25', roster});
  assert.equal(result.gameCount, 4);
  assert.deepEqual(result.totals.map(p => [p.name, p.net, p.games]), [['Ishita', 2800, 4], ['Dunzo', -2800, 4]]);
  assert.deepEqual(result.payments.map(p => [p.fromName, p.toName, p.amount]), [['Dunzo', 'Ishita', 2800]]);
  const history = await service.history({roster});
  for (const game of history.games) {
    assert.equal(game.players.find(p => p.name === 'Dunzo').key, await historyPlayerKey('current-arun'));
    assert.equal(game.players.find(p => p.name === 'Ishita').key, await historyPlayerKey('current-ishita'));
  }
  assert.equal(JSON.stringify([...store.values]), before);
  const simulated = await service.settlement({from: '2026-10-25', to: '2026-10-25', roster, examples: records});
  assert.equal(simulated.totals.length, 4, 'examples keep their synthetic identities');
});

test('identity cleanup preserves distinct current accounts and unrelated same-name players', async () => {
  const {canonicalHistory} = await import('../lib/game-history.mjs');
  const roster = [{id: 'd', name: 'Dunzo'}, {id: 'i', name: 'Ishita'}, {id: 'v', name: 'Varun'}];
  const record = {code: 'ALIASES', closedAt: now, players: [
    {id: 'old-d', name: 'Arun', buyins: 100, cashout: 50},
    {id: 'd', name: 'Dunzo', buyins: 100, cashout: 75},
    {id: 'i', name: 'Ishita', buyins: 100, cashout: 125},
    {id: 'v', name: 'Ishita', buyins: 100, cashout: 150},
    {id: 'other-v', name: 'Varun', buyins: 100, cashout: 100}
  ]};
  const totals = aggregateGames(canonicalHistory([record], roster));
  assert.equal(totals.find(p => p.id === 'd').net, -75);
  assert.equal(totals.find(p => p.id === 'd').games, 1);
  assert.equal(totals.find(p => p.id === 'v').name, 'Varun');
  assert.ok(totals.some(p => p.id === 'other-v'));
  assert.equal(totals.reduce((sum, p) => sum + p.net, 0), 0);
  assert.throws(() => canonicalHistory([record], [...roster, {id: 'duplicate', name: 'Arun'}]), /Multiple current accounts/);
  assert.throws(() => canonicalHistory([{...record, players: [...record.players, record.players[0]]}], roster), /Invalid player accounting/);
});
