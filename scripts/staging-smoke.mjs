import { DatabaseSync } from 'node:sqlite';
import { hashPin } from '../server/player-auth.mjs';
import { testPlayers } from '../tests/player-fixtures.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { validateProductionArtifact } from '../lib/production-artifact.mjs';
import { validateStagingArtifact } from '../lib/staging-artifact.mjs';
import { runApiSuite, localTarget } from '../tests/api.test.mjs';
const base = process.env.POKER_STAGING_TEST_URL || `http://127.0.0.1:${process.env.POKER_SMOKE_PORT || 8787}`;
localTarget(base);
const environment = process.env.POKER_SMOKE_ENV || 'staging';
if (!['staging', 'production'].includes(environment)) throw new Error('Unknown smoke environment');
(environment === 'production' ? validateProductionArtifact : validateStagingArtifact)();
// The preview is restarted on the same port; do not pool sockets across processes.
const request = (url, options = {}) => fetch(url, {
  ...options,
  headers: {
    ...options.headers,
    Connection: 'close'
  },
  signal: AbortSignal.timeout(10_000)
});
const external = Boolean(process.env.POKER_STAGING_TEST_URL);
const directory = mkdtempSync(join(tmpdir(), 'dunzo-club-test-'));
let server,
  logs = '';
async function stop() {
  if (server && server.exitCode === null) {
    const child = server,
      exited = once(child, 'exit');
    const signal = name => {
      try {
        process.kill(-child.pid, name);
      } catch {
        child.kill(name);
      }
    };
    signal('SIGTERM');
    const force = setTimeout(() => signal('SIGKILL'), 5000);
    try {
      await exited;
    } finally {
      clearTimeout(force);
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
    }
  }
  server = undefined;
}
async function start() {
  server = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'dist/server/wrangler.json', '--local', '--persist-to', directory, '--ip', '127.0.0.1', '--port', String(new URL(base).port || 8787), '--inspector-port', '0'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      CLOUDFLARE_CF_FETCH_ENABLED: 'false'
    }
  });
  server.stdout.on('data', chunk => logs += chunk);
  server.stderr.on('data', chunk => logs += chunk);
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw new Error(`Preview exited: ${logs}`);
    try {
      const response = await request(new URL('/api/health', base), {
        signal: AbortSignal.timeout(5000)
      });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch { }
    await sleep(500);
  }
  throw new Error(`Preview did not become ready: ${logs}`);
}
try {
  if (!external) {
    await start();
    await (await request(new URL('/api/players', base))).arrayBuffer(); // Initialize the schema, then seed only offline disposable storage.
    await stop();
    console.log('Stopped schema preview; provisioning disposable players.');
    const files = readdirSync(directory, {
      recursive: true
    }).filter(path => /v3\/do\/.*ClubTable\/[a-f0-9]{64}\.sqlite$/.test(path));
    assert.equal(files.length, 1, 'Expected one disposable table database');
    const database = new DatabaseSync(join(directory, files[0]));
    try {
      for (const p of testPlayers) {
        const {
          salt,
          hash
        } = await hashPin(p.pin);
        database.prepare('INSERT INTO players(id,name,pin_salt,pin_hash) VALUES(?,?,?,?)').run(p.id, p.name, salt, hash);
      }
    } finally {
      database.close();
    }
    await start();
    console.log('Restarted preview with fixed test players.');
  }
  const health = await request(new URL('/api/health', base), {
    signal: AbortSignal.timeout(5000)
  }),
    data = await health.json();
  assert.equal(health.status, 200);
  assert.equal(data.app, 'Dunzo Club');
  assert.equal(data.environment, environment);
  assert.equal(data.mode, 'multiplayer');
  assert.equal(data.multiplayerReady, true);
  assert.match(data.version, /^[a-f0-9]{40}$/);
  const page = await request(base),
    html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Dunzo Club/);
  assert.doesNotMatch(html, /Club access code|Room code/);
  if (environment === 'production') assert.doesNotMatch(html, /Test UI|staging-badge/);
  else assert.match(html, /Test UI/);
  for (const asset of ['/manifest.webmanifest', '/sw.js', '/icon-192.png', '/icon-512.png']) {
    const response = await request(new URL(asset, base));
    await response.arrayBuffer();
    assert.equal(response.status, 200, asset);
  }
  await runApiSuite(base, external ? undefined : async () => {
    await stop();
    await start();
  }, environment);
  if (!external && environment === 'production') {
    await stop();
    const files = readdirSync(directory, {recursive: true}).filter(path => /v3\/do\/.*ClubTable\/[a-f0-9]{64}\.sqlite$/.test(path));
    const database = new DatabaseSync(join(directory, files[0]));
    try {
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('history_examples','staging_history_resets')").get().n, 0);
    } finally {database.close()}
    console.log('Verified production does not initialize staging-only data tables.');
  }
  if (!external && environment === 'staging') {
    await stop();
    const files = readdirSync(directory, {recursive: true}).filter(path => /v3\/do\/.*ClubTable\/[a-f0-9]{64}\.sqlite$/.test(path));
    const database = new DatabaseSync(join(directory, files[0]));
    const names = ['Dunzo', 'Ishita', 'Varun', 'Doshi', 'Panda', 'Saboo', 'Roongta'];
    try {
      const {salt, hash} = await hashPin('6789');
      for (const [i, name] of names.entries()) database.prepare('INSERT INTO players(id,name,pin_salt,pin_hash) VALUES(?,?,?,?)').run(`reset-player-${i}`, name, salt, hash);
      database.prepare('INSERT INTO staging_history_resets(id,requested_at) VALUES(?,?)').run('local-smoke-reset', Date.now());
      database.prepare('INSERT INTO history_examples(id,record) VALUES(?,?)').run('old-example', '{}');
    } finally {database.close()}
    await start();
    const login = await request(new URL('/api/login', base), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({playerId: 'reset-player-0', pin: '6789'})});
    assert.equal(login.status, 200);
    const headers = {Cookie: login.headers.get('set-cookie').split(';')[0]};
    await login.arrayBuffer();
    const readHistory = async () => {
      const response = await request(new URL('/api/history', base), {headers});
      assert.equal(response.status, 200);
      return response.json();
    };
    const history = await readHistory();
    assert.equal(history.games.length, 4);
    assert.equal(history.demoAvailable, false);
    assert.ok(history.games.every(game => game.players.length === 7 && game.players.some(p => p.key === history.viewerKey)));
    await stop();
    await start();
    assert.deepEqual((await readHistory()).games, history.games);
    await stop();
    const verified = new DatabaseSync(join(directory, files[0]));
    try {
      const reset = verified.prepare('SELECT completed_at,seeded_games FROM staging_history_resets WHERE id=?').get('local-smoke-reset');
      assert.ok(reset.completed_at);
      assert.equal(reset.seeded_games, 4);
      assert.equal(verified.prepare('SELECT COUNT(*) AS n FROM history_examples').get().n, 0);
    } finally {verified.close()}
    console.log('Verified console-triggered staging reset, four ordinary games, current player IDs and restart idempotency.');
  }
  console.log('Built multiplayer Worker smoke passed; no remote resources used.');
} catch (error) {
  console.error(logs.slice(-12000));
  throw error;
} finally {
  await stop();
  rmSync(directory, {
    recursive: true,
    force: true
  });
}
