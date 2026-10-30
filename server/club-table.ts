import { resetStagingHistory } from '../lib/staging-history.mjs';
import { historyViewerKey } from '../lib/game-history.mjs';
import { DurableObject } from 'cloudflare:workers';
import { TableService, TableError, nextDeadline } from './table-service.mjs';
import { PlayerAuth, sessionCookie } from './player-auth.mjs';
import { PROTOCOL_VERSION } from '../lib/protocol/poker.mjs';
import { SocialService } from './social-service.mjs';
import { presenceView } from '../lib/presence.mjs';
import { reactionsEnabled } from '../lib/reactions.mjs';
import { handHistoryCsv, handHistoryJson } from '../lib/hand-history.mjs';
type Peer = {
  playerId: string;
  cookie: string;
  lastSeenAt?: number;
};
const json = (data: unknown, status = 200, headers = {}) => Response.json(data, {
  status,
  headers: {
    'Cache-Control': 'no-store, private',
    Vary: 'Cookie, Authorization',
    ...headers
  }
});
export class ClubTable extends DurableObject<Cloudflare.Env> {
  private service: TableService;
  private auth: PlayerAuth;
  private social: SocialService;
  private queue: Promise<unknown> = Promise.resolve();
  private rates = new Map<string, {
    count: number;
    until: number;
  }>();
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.service = new TableService(ctx.storage);
    this.social = new SocialService(ctx.storage);
    this.auth = new PlayerAuth(ctx.storage.sql, work => ctx.storage.transactionSync(work));
    if (env.APP_ENV === 'staging') {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS history_examples (id TEXT PRIMARY KEY, record TEXT NOT NULL)');
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS staging_history_resets (id TEXT PRIMARY KEY, requested_at INTEGER NOT NULL, completed_at INTEGER, removed_games INTEGER, seeded_games INTEGER)');
    }
  }

  // Serialize fetches, alarms and socket callbacks across asynchronous awaits.
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => { });
    return result;
  }
  private limit(key: string, max: number) {
    const now = Date.now();
    for (const [k, value] of this.rates) if (value.until < now) this.rates.delete(k);
    const value = this.rates.get(key) || {
      count: 0,
      until: now + 60_000
    };
    this.rates.set(key, value);
    if (++value.count > max) throw new TableError('Too many requests. Try again in a minute.', 429);
  }
  private async body(request: Request) {
    // Read incrementally to bound chunked payloads as well as Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new TableError('JSON body required');
    let bytes = 0,
      text = '';
    const decoder = new TextDecoder();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TableError('Request timed out', 408)), 5000);
    });
    try {
      for (; ;) {
        const {
          done,
          value
        } = await Promise.race([reader.read(), timeout]);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 4096) throw new TableError('Request too large', 413);
        text += decoder.decode(value, {
          stream: true
        });
      }
      return JSON.parse(text + decoder.decode());
    } finally {
      clearTimeout(timer);
      await reader.cancel();
    }
  }
  fetch(request: Request) {
    return this.serial(async () => {
      try {
        const url = new URL(request.url);
        if (url.pathname === '/api/players' && request.method === 'GET') return json({
          players: this.auth.players()
        });
        if (url.pathname === '/api/login' && request.method === 'POST') {
          this.limit(`login:${request.headers.get('CF-Connecting-IP') || 'local'}`, 40);
          const {
            playerId,
            pin
          } = await this.body(request);
          if (typeof playerId !== 'string') throw new TableError('Choose your name', 400);
          const result = await this.auth.login(playerId, pin);
          return json({
            player: result.player
          }, 200, {
            'Set-Cookie': sessionCookie(result.token, url.protocol === 'https:')
          });
        }
        const player = await this.auth.session(request);
        if (url.pathname === '/api/session' && request.method === 'GET') return json({
          player
        });
        if (!player) return json({
          error: 'Please sign in with your name and PIN',
          code: 'LOGIN_REQUIRED'
        }, 401);
        const token = player.id;
        if (request.headers.get('X-Poker-Presence') === 'poll') {
          const leases = await this.ctx.storage.get<Record<string, number>>('presence:http') || {};
          leases[token] = Date.now();
          for (const id of Object.keys(leases)) if (leases[id] + 15000 <= Date.now()) delete leases[id];
          await this.ctx.storage.put('presence:http', leases);
        }
        if (['/api/reactions', '/api/chat'].includes(url.pathname)) {
          if (!reactionsEnabled(this.env.APP_ENV)) return json({ error: 'Social features are not enabled' }, 404);
          if (url.pathname === '/api/chat' && request.method === 'GET') {
            this.limit(`chat-read:${token}`, 120);
            return json(await this.social.history(url.searchParams.get('code') || '', url.searchParams.get('before')));
          }
          if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
          this.limit(`social:${token}`, 90);
          const advanced = await this.service.advance();
          if (advanced) await this.broadcast(advanced);
          const result = await this.social.send(player, await this.body(request), url.pathname === '/api/chat' ? 'message' : 'reaction');
          if (!result.replayed) await this.broadcastSocial(result.entry);
          return json({ ...result, serverTime: Date.now() });
        }
        if (['/api/history', '/api/settlement'].includes(url.pathname) && request.method === 'GET') {
          this.limit(`history:${token}`, 60);
          if (this.env.APP_ENV === 'staging') {
            const requests = this.ctx.storage.sql.exec('SELECT id,requested_at FROM staging_history_resets WHERE completed_at IS NULL ORDER BY requested_at').toArray();
            for (const pending of requests) {
              const reset = await resetStagingHistory(this.ctx.storage, {
                environment: this.env.APP_ENV, requestId: String(pending.id), roster: this.auth.players(), now: Number(pending.requested_at)
              });
              // Retrying after a process exit uses the receipt and never reseeds.
              this.ctx.storage.transactionSync(() => {
                this.ctx.storage.sql.exec('DELETE FROM history_examples');
                this.ctx.storage.sql.exec('UPDATE staging_history_resets SET completed_at=?,removed_games=?,seeded_games=? WHERE id=?', reset.completedAt, reset.removedGames, reset.seededGames, pending.id);
              });
            }
          }
          const demo = url.searchParams.get('demo') === '1';
          if (demo && this.env.APP_ENV !== 'staging') throw new TableError('Simulated history is only available in staging', 403);
          const available = this.env.APP_ENV === 'staging' && this.ctx.storage.sql.exec('SELECT id FROM history_examples LIMIT 1').toArray().length > 0;
          const examples = demo ? this.ctx.storage.sql.exec('SELECT record FROM history_examples ORDER BY id').toArray().map(row => JSON.parse(String(row.record))) : undefined;
          const options = {
            from: url.searchParams.get('from') || undefined,
            to: url.searchParams.get('to') || undefined,
            cursor: url.searchParams.get('cursor') || undefined,
            // The Home-screen hand-history view must never become a directory
            // of the club's games.  Limit it to sessions in which this signed-in
            // player actually participated.
            participantId: url.searchParams.get('mine') === '1' ? token : undefined,
            participantName: demo && url.searchParams.get('mine') === '1' ? player.name : undefined,
            examples,
            roster: this.auth.players()
          };
          const data = url.pathname === '/api/history' ? await this.service.history(options) : await this.service.settlement(options);
          return json({
            ...data,
            viewerKey: await historyViewerKey(player, examples),
            demo,
            demoAvailable: available,
            timeZone: 'Asia/Kolkata'
          });
        }
        if (url.pathname === '/api/hand-history' && request.method === 'GET') {
          this.limit(`hand-history:${token}`, 30);
          const format = url.searchParams.get('format') || 'json';
          if (!['json', 'csv'].includes(format)) throw new TableError('Choose JSON or CSV export', 400);
          const records = await this.service.handHistory(token, url.searchParams.get('code') || undefined);
          const body = format === 'csv' ? handHistoryCsv(records) : handHistoryJson(records);
          const filename = `dunzo-club-hand-history${url.searchParams.get('code') ? `-${url.searchParams.get('code')}` : ''}.${format}`;
          return new Response(body, {
            headers: {
              'Cache-Control': 'no-store, private',
              Vary: 'Cookie, Authorization',
              'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
              'Content-Disposition': `attachment; filename="${filename}"`
            }
          });
        }
        if (url.pathname === '/api/logout' && request.method === 'POST') {
          if (request.body) await this.body(request);
          await this.auth.logout(request);
          await this.broadcast();
          return json({
            ok: true
          }, 200, {
            'Set-Cookie': sessionCookie('', url.protocol === 'https:', 0)
          });
        }
        if (url.pathname === '/api/pin' && request.method === 'POST') {
          this.limit(`pin:${token}`, 10);
          const {
            currentPin,
            newPin
          } = await this.body(request);
          const result = await this.auth.changePin(token, currentPin, newPin);
          // Keep this browser's sockets on the new session before revocation
          // broadcasts. Other devices have different tokens and are signed out.
          for (const socket of this.ctx.getWebSockets()) {
            const peer = socket.deserializeAttachment() as Peer;
            const peerRequest = new Request('https://dunzo.invalid', {
              headers: {
                Cookie: peer.cookie
              }
            });
            if (peer.playerId === token && this.auth.token(peerRequest) === this.auth.token(request)) {
              socket.serializeAttachment({
                ...peer,
                cookie: sessionCookie(result.token, false).split(';')[0]
              });
            }
          }
          await this.broadcast();
          return json({
            player: result.player
          }, 200, {
            'Set-Cookie': sessionCookie(result.token, url.protocol === 'https:')
          });
        }
        if (url.pathname === '/api/lobby' && request.method === 'GET') return json(await this.lobby(token));
        if (url.pathname === '/api/poker/socket') {
          if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({
            error: 'WebSocket upgrade required'
          }, 426);
          if (this.ctx.getWebSockets().length >= 32) return json({
            error: 'Too many table connections'
          }, 429);
          const pair = new WebSocketPair();
          this.ctx.acceptWebSocket(pair[1]);
          pair[1].serializeAttachment({
            playerId: token,
            lastSeenAt: Date.now(),
            cookie: sessionCookie(this.auth.token(request), false).split(';')[0]
          });
          await this.broadcast();
          return new Response(null, {
            status: 101,
            webSocket: pair[0]
          });
        }
        this.limit(`player:${token}`, 180);
        if (!['GET', 'POST'].includes(request.method)) return json({
          error: 'Method not allowed'
        }, 405);
        // Catch overdue work before accepting any new player action.
        const advanced = await this.service.advance();
        if (advanced) await this.broadcast(advanced);
        if (request.method === 'GET') return json(await this.snapshot(token, url.searchParams.get('code') || ''));
        const input = await this.body(request);
        if (['stand_up', 'cancel_stand_up', 'set_away'].includes(input.type) && !reactionsEnabled(this.env.APP_ENV)) throw new TableError('This control is not enabled', 403);
        if (['create', 'join'].includes(input.type)) input.name = player.name;
        const result = await this.service.execute(token, input);
        await this.broadcast(result.snapshot.code);
        return json({
          ...await this.withPresence(result.snapshot),
          ack: result.ack
        });
      } catch (error) {
        if (error instanceof TableError) return json({
          error: error.message
        }, error.status);
        // Engine validation messages are safe; parser/storage details are not.
        if (error instanceof SyntaxError || (error as Error)?.name === 'ZodError') return json({
          error: 'Invalid request'
        }, 400);
        if (error instanceof Error && !/SQL|storage|internal/i.test(error.message)) return json({
          error: error.message
        }, 400);
        return json({
          error: 'Table unavailable. Reconnect and try again.'
        }, 503);
      } finally {
        // Optional effects cannot turn a successful poker command into an error.
        try { await this.maintainSocial(); } catch (error) { console.error('Social maintenance failed', error); }
      }
    });
  }
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    return this.serial(async () => {
      let commandId: string | undefined;
      try {
        if (typeof message !== 'string' || message.length > 4096) throw new TableError('Invalid message', 400);
        const input = JSON.parse(message);
        if (input.protocol !== PROTOCOL_VERSION) throw new TableError('Unsupported protocol', 400);
        const peer = socket.deserializeAttachment() as Peer | null;
        if (!peer || !(await this.authorized(peer))) { socket.close(1008, 'Access expired'); return; }
        const wasConnected = (await this.presence()).connected.has(peer.playerId);
        socket.serializeAttachment({ ...peer, lastSeenAt: Date.now() });
        this.limit(`message:${peer.playerId}`, 180);
        if (input.type === 'command') {
          commandId = input.input?.commandId;
          this.limit(`player:${peer.playerId}`, 180);
          const player = await this.authorized(peer);
          if (!player) { socket.close(1008, 'Access expired'); return; }
          const advanced = await this.service.advance();
          if (advanced) await this.broadcast(advanced);
          if (['create', 'join'].includes(input.input?.type)) input.input.name = player.name;
          const result = await this.service.execute(peer.playerId, input.input);
          socket.send(JSON.stringify({ protocol: PROTOCOL_VERSION, type: 'command_result', commandId,
            snapshot: { ...await this.withPresence(result.snapshot), ack: result.ack } }));
          await this.broadcast(result.snapshot.code);
        } else if (input.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', protocol: PROTOCOL_VERSION }));
          if (!wasConnected) await this.broadcast();
        } else if (input.type === 'resync') await this.sendState(socket);
        else throw new TableError('Unknown message', 400);
      } catch (error) {
        if (commandId) {
          const status = error instanceof TableError ? error.status : error instanceof SyntaxError || (error as Error)?.name === 'ZodError' || error instanceof Error && !/SQL|storage|internal/i.test(error.message) ? 400 : 503;
          socket.send(JSON.stringify({ protocol: PROTOCOL_VERSION, type: 'command_result', commandId, status,
            error: status < 500 ? (error as Error).message : 'Table unavailable. Reconnecting…' }));
        } else socket.close(1008, 'Please reconnect');
      } finally {
        try { await this.maintainSocial(); } catch (error) { console.error('Socket maintenance failed', error); }
      }
    });
  }
  private async presence() {
    const peers = this.ctx.getWebSockets().filter(socket => socket.readyState === WebSocket.OPEN)
      .map(socket => socket.deserializeAttachment() as Peer);
    return presenceView(peers, await this.ctx.storage.get<Record<string, number>>('presence:http'));
  }
  private async withPresence(room: any) {
    const { connected } = await this.presence();
    const raw = await this.ctx.storage.get<any>(`room:${room.code}`);
    const aliases = new Set(raw?.players.flatMap((player: any, index: number) => connected.has(player.id)
      ? [player.id === room.me ? player.id : `seat-${player.seat}-${index}`] : []) || []);
    return { ...room, players: room.players.map((player: any) => ({ ...player, disconnected: !aliases.has(player.id) })) };
  }
  private async snapshot(playerId: string, code: string) {
    return this.withPresence(await this.service.snapshot(playerId, code));
  }
  private async lobby(playerId: string) {
    const code = await this.ctx.storage.get<string>('active');
    if (!code) return {
      activeGame: null
    };
    const room = await this.ctx.storage.get<any>(`room:${code}`);
    return {
      activeGame: {
        code: room.code,
        phase: room.phase,
        settings: room.settings,
        players: room.players.filter((p: any) => !p.left).map((p: any) => ({
          name: p.name
        })),
        joined: room.players.some((p: any) => p.id === playerId && !p.left)
      }
    };
  }
  private async sendState(socket: WebSocket, changedCode?: string) {
    const peer = socket.deserializeAttachment() as Peer;
    const player = await this.authorized(peer);
    if (!player) {
      socket.close(1008, 'Please sign in again');
      return;
    }
    const lobby = await this.lobby(player.id);
    const code = changedCode || lobby.activeGame?.code;
    let room = null;
    if (code) {
      const raw = await this.ctx.storage.get<any>(`room:${code}`);
      if (raw) room = await this.snapshot(player.id, code);
    }
    socket.send(JSON.stringify({
      protocol: PROTOCOL_VERSION,
      type: 'state',
      lobby,
      room
    }));
  }
  private async broadcast(code?: string) {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        await this.sendState(socket, code);
      } catch {
        try {
          socket.close(1011, 'Please reconnect');
        } catch { }
      }
    }
  }
  // Reactions are ephemeral and scoped to current table participants. No replay
  // in sendState: reconnects receive poker state, never a queue of old effects.
  private async broadcastReaction(event: { code: string } & Record<string, unknown>) {
    const room = await this.ctx.storage.get<{ players: { id: string; left?: boolean }[] }>(`room:${event.code}`);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const peer = socket.deserializeAttachment() as Peer;
        if (!room || !peer) continue;
        if (!(await this.authorized(peer))) continue;
        socket.send(JSON.stringify({ protocol: PROTOCOL_VERSION, type: 'reaction', event, serverTime: Date.now() }));
      } catch { /* A disconnected spectator must not fail an accepted reaction. */ }
    }
  }
  private async broadcastSocial(entry: Record<string, unknown>) {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const peer = socket.deserializeAttachment() as Peer;
        if (peer && await this.authorized(peer)) socket.send(JSON.stringify({ protocol: PROTOCOL_VERSION, type: 'social', entry }));
      } catch { /* Delivery is best effort; reconnect restores durable history. */ }
    }
  }
  private async maintainSocial() {
    if (!reactionsEnabled(this.env.APP_ENV)) return;
    const code = await this.ctx.storage.get<string>('active');
    if (!code) return;
    for (const event of await this.social.drain(code)) await this.broadcastReaction(event);
    const room = await this.ctx.storage.get<any>(`room:${code}`);
    const presenceDeadline = (await this.presence()).deadline;
    const deadlines = [nextDeadline(room), await this.social.deadline(code), Number.isFinite(presenceDeadline) ? presenceDeadline : null].filter((t): t is number => t !== null);
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...deadlines)));
    else await this.ctx.storage.deleteAlarm();
  }
  private authorized(peer: Peer) {
    return this.auth.session(new Request('https://dunzo.invalid', {
      headers: {
        Cookie: peer.cookie
      }
    }));
  }
  webSocketClose(socket: WebSocket, code: number) {
    try { socket.close(code); } catch { }
    return this.serial(async () => { await this.broadcast(); await this.maintainSocial(); });
  }
  webSocketError(socket: WebSocket) { return this.webSocketClose(socket, 1011); }
  alarm() {
    return this.serial(async () => {
      for (const socket of this.ctx.getWebSockets()) {
        const peer = socket.deserializeAttachment() as Peer;
        if (!peer?.lastSeenAt || peer.lastSeenAt + 15000 <= Date.now()) { try { socket.close(4000, 'Heartbeat expired'); } catch { } }
      }
      const code = await this.service.advance();
      if (code) await this.broadcast(code);
      try { await this.maintainSocial(); } catch (error) {
        console.error('Social alarm failed', error);
        // Retry independently; betting state has already committed.
        const existing = await this.ctx.storage.getAlarm();
        await this.ctx.storage.setAlarm(Math.min(existing || Infinity, Date.now() + 1000));
      }
    });
  }
}
