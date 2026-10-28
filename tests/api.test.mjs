import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { pathToFileURL } from 'node:url';
import { commandEnvelope } from '../lib/protocol/poker.mjs';
import { historyPlayerKey, indiaDate } from '../lib/game-history.mjs';
import { testPlayers } from './player-fixtures.mjs';
const request = async (url, options = {}) => {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Connection: 'close'
      },
      signal: AbortSignal.timeout(10_000)
    });
    const bytes = await response.arrayBuffer();
    return new Response(bytes, {
      status: response.status,
      headers: response.headers
    });
  } catch (error) {
    throw new Error(`${options.method || 'GET'} ${new URL(url).pathname} failed`, {
      cause: error
    });
  }
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function localTarget(base) {
  const url = new URL(base);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('API tests require an explicit disposable loopback HTTP server. Never test live balances.');
  return url;
}
export async function runApiSuite(base, restart, environment = 'staging') {
  localTarget(base);
  const [host, friend, observer] = testPlayers.map(p => p.id),
    cookies = new Map();
  for (const path of ['/api/history', '/api/settlement?from=2026-01-01&to=2026-12-31']) {
    const deniedHistory = await request(new URL(path, base));
    assert.equal(deniedHistory.status, 401);
    await deniedHistory.arrayBuffer();
  }
  const denied = await request(new URL('/api/poker', base));
  assert.equal(denied.status, 401);
  await denied.arrayBuffer();
  const cross = await request(new URL('/api/login', base), {
    method: 'POST',
    headers: {
      Origin: 'https://other.test',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      playerId: host,
      pin: '0123'
    })
  });
  assert.equal(cross.status, 403);
  await cross.arrayBuffer();
  const roster = await (await request(new URL('/api/players', base))).json();
  assert.equal(roster.players.length, 3);
  assert.ok(!JSON.stringify(roster).includes('pin_hash'));
  async function login(id, pin) {
    const result = await request(new URL('/api/login', base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        playerId: id,
        pin
      })
    });
    assert.equal(result.status, 200);
    cookies.set(id, result.headers.get('set-cookie').split(';')[0]);
    return result.json();
  }
  for (const p of testPlayers) await login(p.id, p.pin);
  const cookie = cookies.get(host);
  for (const headers of [{
    Origin: new URL(base).origin
  }, {
    Cookie: cookie,
    Origin: 'https://other.test'
  }]) {
    const status = await new Promise((resolve, reject) => {
      const socket = new WebSocket(new URL('/api/poker/socket', base).href.replace('http:', 'ws:'), {
        headers
      });
      socket.once('unexpected-response', (_, response) => {
        response.resume();
        resolve(response.statusCode);
        socket.terminate();
      });
      socket.once('open', () => {
        socket.terminate();
        reject(new Error('Unauthorized socket opened'));
      });
      socket.on('error', () => { });
    });
    assert.equal(status, headers.Cookie ? 403 : 401);
  }
  async function api(token, input, code) {
    const res = await request(new URL(input ? '/api/poker' : `/api/poker?code=${code}`, base), {
      method: input ? 'POST' : 'GET',
      headers: {
        Cookie: cookies.get(token),
        ...(input && {
          'Content-Type': 'application/json'
        })
      },
      ...(input && {
        body: JSON.stringify(input)
      })
    });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(`${res.status}: ${data.error}`), {
      status: res.status
    });
    return data;
  }
  const create = commandEnvelope({
    type: 'create',
    name: 'Integration Host',
    takeSeat: false,
    rotation: 2,
    seats: 8,
    sb: 5,
    bb: 10,
    buyin: 1000
  });
  let room = await api(host, create),
    code = room.code;
  assert.equal((await api(host, create)).code, code);
  assert.equal(room.players.length, 0);
  room = await api(host, commandEnvelope({
    type: 'join',
    code,
    name: 'Integration Host',
    seat: 6,
    buyin: 1000
  }));
  assert.equal(room.players[0].seat, 6);
  await assert.rejects(api(friend, commandEnvelope({
    type: 'create',
    name: 'Duplicate'
  })), /already running/);
  const watching = await api(observer, null, code);
  assert.equal(watching.legal, null);
  assert.ok(watching.players.every(p => p.cards === undefined));
  await api(friend, commandEnvelope({
    type: 'join',
    code,
    name: 'Integration Friend',
    seat: 2,
    buyin: 1750
  }));
  room = await api(host, null, code);
  const peers = [];
  async function peer(token) {
    const messages = [];
    const socket = new WebSocket(new URL('/api/poker/socket', base).href.replace('http:', 'ws:'), {
      handshakeTimeout: 10_000,
      headers: {
        Cookie: cookies.get(token),
        Origin: new URL(base).origin
      }
    });
    peers.push(socket);
    const heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({protocol:4,type:'ping'})); }, 5000);
    socket.once('close', () => clearInterval(heartbeat));
    socket.on('message', value => messages.push(JSON.parse(value.toString())));
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    await waitFor(() => messages.find(m => m.type === 'state'));
    return {
      socket,
      messages
    };
  }
  async function waitFor(check, ms = 5000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const value = check();
      if (value) return value;
      await sleep(25);
    }
    throw new Error('Timed out waiting for server push');
  }
  try {
    const unseated = await peer(observer);
    assert.equal(unseated.messages[0].room.code, code);
    assert.ok(unseated.messages[0].room.players.every(p => p.cards === undefined));
    assert.equal(unseated.messages[0].lobby.activeGame.code, code);
    let h = await peer(host);
    const f = await peer(friend);
    console.log('Verified player login, shared lobby and private socket snapshots.');
    // A closed socket changes presence, never seating or the chip ledger.
    const beforeDisconnect = await api(friend, null, code);
    assert.equal(beforeDisconnect.players.find(p => p.name === 'Integration Host').disconnected, false);
    const startPresence = f.messages.length;
    h.socket.terminate();
    await waitFor(() => f.messages.slice(startPresence).find(m => m.room?.players.find(p => p.name === 'Integration Host')?.disconnected));
    h = await peer(host);
    const restored = h.messages.find(m => m.type === 'state').room;
    assert.equal(restored.players.find(p => p.id === host).disconnected, false);
    assert.equal(restored.players.find(p => p.id === host).away, false);
    assert.equal(restored.players.find(p => p.id === host).stack, 1000);
    // Simulate an accepted HTTP action whose reply was lost, then a socket retry.
    const once = commandEnvelope({type:'set_away', code, away:true}, restored);
    const acceptedPresenceAction = await api(host, once);
    h.socket.send(JSON.stringify({protocol:4,type:'command',input:once}));
    const replay = await waitFor(() => h.messages.find(m => m.type === 'command_result' && m.commandId === once.commandId));
    assert.equal(replay.snapshot.version, acceptedPresenceAction.version);
    assert.equal(replay.snapshot.ack.commandId, once.commandId);
    assert.equal(replay.snapshot.players.find(p => p.id === host).away, true);
    assert.ok(replay.snapshot.players.every(p => p.id === host || !testPlayers.some(t => t.id === p.id)));
    room = await api(host, commandEnvelope({type:'set_away',code,away:false},replay.snapshot));
    const stale = commandEnvelope({type:'set_away',code,away:true},restored);
    h.socket.send(JSON.stringify({protocol:4,type:'command',input:stale}));
    const rejection = await waitFor(() => h.messages.find(m => m.type === 'command_result' && m.commandId === stale.commandId));
    assert.equal(rejection.status,409);
    assert.equal((await api(host,null,code)).version,room.version);
    console.log('Verified disconnected/reconnected seats, preserved stack/eligibility and cross-transport command deduplication/stale rejection.');

    // Cosmetic events use their own endpoint: no betting version/receipt changes.
    const react = (token, body, origin) => request(new URL('/api/reactions', base), {
      method: 'POST', headers: {Cookie: cookies.get(token), 'Content-Type': 'application/json', ...(origin && {Origin: origin})},
      body: JSON.stringify(body)
    });
    const reactionInput = {code, requestId: crypto.randomUUID(), reaction: 'chappal', targetSeat: 2};
    assert.equal((await react(host, reactionInput, 'https://other.test')).status, 403);
    if (['staging', 'production'].includes(environment)) {
      assert.equal((await request(new URL('/api/reactions', base), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(reactionInput)})).status, 401);
      assert.equal((await react(host, {...reactionInput, targetSeat: 6})).status, 400);
      const response = await react(host, reactionInput);
      assert.equal(response.status, 200);
      const {entry} = await response.json();
      const hostEvent = await waitFor(() => h.messages.find(m => m.type === 'reaction'));
      const friendEvent = await waitFor(() => f.messages.find(m => m.type === 'reaction'));
      assert.equal(hostEvent.event.id, entry.id);
      assert.deepEqual(friendEvent.event, hostEvent.event);
      assert.equal(hostEvent.event.from.name, 'Integration Host');
      assert.equal(hostEvent.event.to.seat, 2);
      assert.equal((await api(host, null, code)).version, room.version);
      assert.equal((await react(host, {...reactionInput, requestId: crypto.randomUUID()})).status, 429);
      assert.equal((await react(friend, {...reactionInput, requestId: crypto.randomUUID(), targetSeat: 6})).status, 200);
      assert.equal((await react(host, reactionInput)).status, 200);
      const reconnected = await peer(friend);
      await sleep(100);
      assert.equal(h.messages.filter(m => m.type === 'reaction' && m.event.id === entry.id).length, 1);
      assert.equal(unseated.messages.filter(m => m.type === 'reaction' && m.event.id === entry.id).length, 1);
      assert.equal(reconnected.messages.filter(m => m.type === 'reaction').length, 0);
      const chatInput = { code, requestId: crypto.randomUUID(), text: 'HTTP/socket persistence <plain text>' };
      const chat = body => request(new URL('/api/chat', base), { method: 'POST', headers: { Cookie: cookies.get(observer), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal((await chat(chatInput)).status, 200);
      assert.equal((await chat(chatInput)).status, 200);
      const pushed = await waitFor(() => h.messages.find(m => m.type === 'social' && m.entry.kind === 'message'));
      assert.equal(pushed.entry.text, chatInput.text);
      const history = await (await request(new URL(`/api/chat?code=${code}`, base), {headers: {Cookie: cookies.get(friend)}})).json();
      assert.equal(history.entries.filter(e => e.kind === 'message').length, 1);
      assert.equal(history.entries.filter(e => e.kind === 'reaction').length, 2);
      const away = await api(host, commandEnvelope({type:'set_away', code, away:true}, room));
      assert.equal(away.players.find(p => p.id === host).away, true);
      room = await api(host, commandEnvelope({type:'set_away', code, away:false}, away));
      console.log('Verified chat and reactions across three clients, persistent deduplication, observers, cooldowns, Away and no animation replay.');
    } else assert.equal((await react(host, reactionInput)).status, 404);

    const reload = commandEnvelope({
      type: 'rebuy',
      code,
      amount: 100
    }, room);
    const accepted = await api(host, reload);
    const retried = await api(host, reload);
    assert.deepEqual(accepted.ack, retried.ack);
    assert.equal(retried.players.find(p => p.id === host).buyins, 1100);
    await waitFor(() => f.messages.find(m => m.room?.version === accepted.version));
    room = await api(host, null, code);
    if (restart) {
      peers.forEach(s => s.close());
      await restart();
      const restored = await api(host, null, code);
      assert.equal(restored.version, room.version);
      assert.deepEqual(restored.players.map(({disconnected,...p}) => p), room.players.map(({disconnected,...p}) => p));
      assert.ok(restored.players.every(p => p.disconnected), 'Closed sockets must not survive a restart as connected seats');
      if (['staging', 'production'].includes(environment)) {
        const chat = await (await request(new URL(`/api/chat?code=${code}`, base), {headers: {Cookie: cookies.get(host)}})).json();
        assert.equal(chat.entries.filter(e => e.kind === 'message').length, 1);
      }
    }
    const liveHost = restart ? await peer(host) : h,
      liveFriend = restart ? await peer(friend) : f,
      liveObserver = restart ? await peer(observer) : unseated;
    const oldCookie = cookies.get(host);
    await login(host, '0123');
    const secondDevice = cookies.get(host),
      otherDevice = await peer(host);
    const changed = await request(new URL('/api/pin', base), {
      method: 'POST',
      headers: {
        Cookie: oldCookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        currentPin: '0123',
        newPin: '0042'
      })
    });
    assert.equal(changed.status, 200);
    assert.notEqual(secondDevice, oldCookie);
    cookies.set(host, changed.headers.get('set-cookie').split(';')[0]);
    const revoked = await (await request(new URL('/api/session', base), {
      headers: {
        Cookie: secondDevice
      }
    })).json();
    assert.equal(revoked.player, null);
    await waitFor(() => otherDevice.socket.readyState !== WebSocket.OPEN);
    assert.equal(liveHost.socket.readyState, WebSocket.OPEN);
    const resumed = await login(host, '0042');
    assert.equal(resumed.player.id, host);
    assert.equal((await api(host, null, code)).me, host);
    console.log('Verified PIN rotation, other-device revocation and current-session continuity.');
    const layoutCheck = await request(new URL('/layout-check', base));
    assert.equal(layoutCheck.status, environment === 'production' ? 404 : 200);
    await layoutCheck.arrayBuffer();
    const games = new Set();
    const extraReactions = ['cheers', 'money', 'tomato', 'crown', 'laugh', 'duck', 'punch'];
    let nextCatalogueAt = Date.now() + 3000;
    for (let i = 0; i < 7; i++) {
      room = await api(host, null, code);
      if (room.phase === 'showdown') await sleep(Math.max(0, room.payoutFinishedAt - Date.now() + 50));
      // Pause prevents auto-deal racing this deterministic integration sequence.
      if (!room.paused) {
        room = await api(host, commandEnvelope({
          type: 'pause',
          code
        }, room));
      }
      room = await api(host, commandEnvelope({
        type: 'deal',
        code
      }, room));
      games.add(room.game);
      if (['staging', 'production'].includes(environment)) {
        await sleep(Math.max(0, nextCatalogueAt - Date.now()));
        const response = await react(host, {code, requestId:crypto.randomUUID(), reaction:extraReactions[i], targetSeat:2});
        const sent = await response.json();
        assert.equal(response.status, 200, sent.error);
        assert.equal(sent.entry.reaction, extraReactions[i]);
        await waitFor(() => liveFriend.messages.find(m => m.type === 'reaction' && m.event.id === sent.entry.id));
        nextCatalogueAt = Date.now() + 3000;
      }
      await waitFor(() => liveFriend.messages.find(m => m.room?.version === room.version));
      const privateHost = await api(host, null, code),
        privateFriend = await api(friend, null, code);
      assert.equal(privateHost.players.find(p => p.name === 'Integration Friend').cards, undefined);
      assert.equal(privateFriend.players.find(p => p.name === 'Integration Host').cards, undefined);
      let steps = 0;
      while (['preflop', 'flop', 'turn', 'river'].includes(room.phase)) {
        assert.ok(++steps < 40);
        const actor = room.turn === host ? host : friend,
          own = await api(actor, null, code);
        room = await api(actor, commandEnvelope({
          type: i === 2 ? own.legal.call ? 'call' : 'check' : 'fold',
          code
        }, own));
        room = await api(host, null, code);
      }
      assert.equal(room.phase, 'showdown');
      if (i === 0) {
        const exportUrl = new URL(`/api/hand-history?code=${code}&format=json`, base);
        const readExport = async () => {
          const response = await request(exportUrl, {headers: {Cookie: cookies.get(host)}});
          assert.equal(response.status, 200);
          assert.match(response.headers.get('cache-control'), /no-store/);
          return response.json();
        };
        const before = await readExport();
        assert.equal(before.hands.length, 1);
        assert.equal(before.hands[0].visibleHoleCards.length, 1, 'Uncontested opponents stay private');
        assert.deepEqual(before.hands[0].visibleHoleCards[0].cards, privateHost.players.find(p => p.id === host).cards);
        const own = await api(friend, null, code);
        const reveal = commandEnvelope({type: 'voluntary_reveal', code}, own);
        await api(friend, reveal);
        await api(friend, reveal); // A lost reply cannot reveal twice.
        room = await api(host, null, code);
        assert.deepEqual(room.players.find(p => p.name === 'Integration Friend').cards, privateFriend.players.find(p => p.id === friend).cards);
        const hunt = commandEnvelope({type: 'rabbit_hunt', code}, room);
        await api(host, hunt);
        await api(host, hunt);
        room = await api(host, null, code);
        const after = await readExport();
        assert.equal(after.hands[0].reveals.length, 1);
        assert.equal(after.hands[0].rabbitHunt.board.length, 5);
        assert.equal(after.hands[0].visibleHoleCards.length, 2);
        assert.ok(!JSON.stringify(after).includes(host));
        assert.ok(!JSON.stringify(after).includes(friend));
        assert.equal(JSON.stringify(after).includes('privateCards'), false);
        const csv = await request(new URL(`/api/hand-history?code=${code}&format=csv`, base), {headers: {Cookie: cookies.get(host)}});
        assert.equal(csv.status, 200);
        assert.match(await csv.text(), /rabbit_hunt/);
        const unauthorized = await request(exportUrl);
        assert.equal(unauthorized.status, 401);
        await unauthorized.arrayBuffer();
        console.log('Verified authenticated JSON/CSV exports, hidden-card privacy, voluntary seat reveal, Rabbit Hunt and command retry deduplication.');
      }
      assert.equal(room.players.reduce((n, p) => n + p.stack, 0), 2850);
      await assert.rejects(api(host, commandEnvelope({
        type: 'deal',
        code
      }, room)), /payouts/);
    }
    assert.equal(games.size, 3);
    assert.equal(room.history.length, 7);
    // No incoming requests or socket pings: the alarm alone must finish a turn.
    await sleep(Math.max(0, room.payoutFinishedAt - Date.now() + 50));
    room = await api(host, commandEnvelope({
      type: 'deal',
      code
    }, room));
    if (['staging', 'production'].includes(environment)) {
      const stand = commandEnvelope({type:'stand_up', code}, room);
      room = await api(host, stand);
      room = await api(host, stand);
      assert.equal(room.players.find(p => p.id === host).pendingSeatAction, 'leave');
      room = await api(host, commandEnvelope({type:'cancel_stand_up', code}, room));
      assert.equal(room.players.find(p => p.id === host).pendingSeatAction, null);
    }
    const dealtVersion = room.version;
    const timed = await waitFor(() => liveHost.messages.find(m => m.room?.version > dealtVersion && m.room?.phase === 'showdown'), 45_000);
    assert.equal(timed.room.completed, 8);
    room = await api(host, null, code);
    room = await api(observer, commandEnvelope({
      type: 'end',
      code
    }, room));
    if (room.phase !== 'closed') {
      assert.equal(room.terminationPending, true);
      await sleep(Math.max(0, room.payoutFinishedAt - Date.now()) + 300);
      room = await api(host, null, code);
    }
    assert.equal(room.phase, 'closed');
    if (['staging', 'production'].includes(environment)) {
      const closedSend = await request(new URL('/api/chat', base), {method:'POST', headers:{Cookie:cookies.get(host),'Content-Type':'application/json'}, body:JSON.stringify({code,requestId:crypto.randomUUID(),text:'too late'})});
      assert.equal(closedSend.status, 409);
      const archive = await (await request(new URL(`/api/chat?code=${code}`, base), {headers:{Cookie:cookies.get(host)}})).json();
      assert.equal(archive.entries.filter(e => e.kind === 'message').length, 1);
    }
    assert.equal(room.players.reduce((n, p) => n + p.cashout, 0), 2850);
    const headers = {
      Cookie: cookies.get(observer)
    };
    const history = await (await request(new URL('/api/history', base), {
      headers
    })).json();
    assert.equal(history.viewerKey, await historyPlayerKey(observer));
    assert.equal(history.games.length, 1);
    assert.equal(history.games[0].players.reduce((n, p) => n + p.net, 0), 0);
    for (const id of [host, friend]) assert.ok(!JSON.stringify(history).includes(id));
    const participantHistory = await (await request(new URL('/api/history', base), {
      headers: {
        Cookie: cookies.get(host)
      }
    })).json();
    assert.equal(participantHistory.viewerKey, await historyPlayerKey(host));
    assert.ok(participantHistory.games[0].players.some(p => p.key === participantHistory.viewerKey));
    const day = indiaDate(room.closedAt),
      settled = await (await request(new URL(`/api/settlement?from=${day}&to=${day}`, base), {
        headers
      })).json();
    assert.equal(settled.gameCount, 1);
    assert.equal(settled.suggestionsOnly, true);
    assert.equal(settled.totals.reduce((n, p) => n + p.net, 0), 0);
    for (const p of settled.totals) assert.equal(settled.payments.reduce((n, t) => n + (t.to === p.key ? t.amount : 0) - (t.from === p.key ? t.amount : 0), 0), p.net);
    const invalid = await request(new URL('/api/settlement?from=2026-02-30&to=2026-03-01', base), {
      headers
    });
    assert.equal(invalid.status, 400);
    await invalid.arrayBuffer();
    for (const endpoint of ['history', 'settlement']) {
      const response = await request(new URL(`/api/${endpoint}?demo=1&from=2020-01-01&to=2099-12-31`, base), {headers});
      const body = await response.json();
      if (environment === 'production') {
        assert.equal(response.status, 403);
        assert.match(body.error, /only available in staging/);
      } else {
        assert.equal(response.status, 200);
        assert.equal(body.demo, true);
        if (endpoint === 'history') assert.equal(body.games.length, 0);
      }
    }
    console.log('Verified authenticated game history, inclusive date-range suggestions, reconciliation and demo isolation.');
    for (const message of liveHost.messages) assert.ok(!JSON.stringify(message).includes(friend));
    for (const message of liveFriend.messages) assert.ok(!JSON.stringify(message).includes(host));
    const next = await api(friend, commandEnvelope({
      type: 'create',
      name: 'Ignored name'
    }));
    await waitFor(() => liveObserver.messages.find(m => m.lobby?.activeGame?.code === next.code));
    assert.equal(next.players[0].id, friend);
    assert.equal(next.players[0].name, 'Integration Friend');
    assert.notEqual(next.code, code);
    assert.equal((await api(host, null, code)).history.length, 8);
    assert.equal((await api(friend, commandEnvelope({
      type: 'join',
      code,
      name: 'Existing friend'
    }))).phase, 'closed');
    await api(friend, commandEnvelope({
      type: 'end',
      code: next.code
    }, next));
    const logout = await request(new URL('/api/logout', base), {
      method: 'POST',
      headers: {
        Cookie: cookies.get(host),
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    assert.equal(logout.status, 200);
    await logout.arrayBuffer();
    await assert.rejects(api(host, null, code), /sign in/);
    console.log('PIN multiplayer passed: fixed roster, cookie identity, shared lobby, private push, device recovery, PIN change/revocation, retries, restart, 8 hands, 3 variants, independent alarm and retained sessions.');
  } finally {
    peers.forEach(s => s.terminate());
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.POKER_TEST_URL) throw new Error('Set POKER_TEST_URL for a disposable local server seeded with tests/player-fixtures.mjs.');
  await runApiSuite(process.env.POKER_TEST_URL);
}
