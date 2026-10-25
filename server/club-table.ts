import { DurableObject } from 'cloudflare:workers';
import { TableService, TableError } from './table-service.mjs';
import { PlayerAuth, sessionCookie } from './player-auth.mjs';
import { PROTOCOL_VERSION } from '../lib/protocol/poker.mjs';

type Peer = { playerId: string; cookie: string };
const json = (data: unknown, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store, private', Vary: 'Cookie, Authorization', ...headers } });

export class ClubTable extends DurableObject<Cloudflare.Env> {
  private service: TableService;
  private auth: PlayerAuth;
  private queue: Promise<unknown> = Promise.resolve();
  private rates = new Map<string, { count: number; until: number }>();

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.service = new TableService(ctx.storage);
    this.auth = new PlayerAuth(ctx.storage.sql, work => ctx.storage.transactionSync(work));
  }

  // Serialize fetches, alarms and socket callbacks across asynchronous awaits.
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }

  private limit(key: string, max: number) {
    const now = Date.now();
    for (const [k, value] of this.rates) if (value.until < now) this.rates.delete(k);
    const value = this.rates.get(key) || { count: 0, until: now + 60_000 };
    this.rates.set(key, value);
    if (++value.count > max) throw new TableError('Too many requests. Try again in a minute.', 429);
  }

  private async body(request: Request) {
    // Read incrementally to bound chunked payloads as well as Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new TableError('JSON body required');
    let bytes = 0, text = '';
    const decoder = new TextDecoder();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TableError('Request timed out', 408)), 5000); });
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), timeout]);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 4096) throw new TableError('Request too large', 413);
        text += decoder.decode(value, { stream: true });
      }
      return JSON.parse(text + decoder.decode());
    } finally { clearTimeout(timer); await reader.cancel(); }
  }

  fetch(request: Request) {
    return this.serial(async () => {
      try {
        const url = new URL(request.url);
        if (url.pathname === '/api/players' && request.method === 'GET') return json({players:this.auth.players()});
        if (url.pathname === '/api/login' && request.method === 'POST') {
          this.limit(`login:${request.headers.get('CF-Connecting-IP')||'local'}`,40);
          const {playerId,pin}=await this.body(request);
          if(typeof playerId!=='string')throw new TableError('Choose your name',400);
          const result=await this.auth.login(playerId,pin);
          return json({player:result.player},200,{'Set-Cookie':sessionCookie(result.token,url.protocol==='https:')});
        }
        const player=await this.auth.session(request);
        if(url.pathname==='/api/session' && request.method==='GET')return json({player});
        if(!player)return json({error:'Please sign in with your name and PIN',code:'LOGIN_REQUIRED'},401);
        const token=player.id;
        if(url.pathname==='/api/logout' && request.method==='POST') {
          if(request.body)await this.body(request);
          await this.auth.logout(request);await this.broadcast();
          return json({ok:true},200,{'Set-Cookie':sessionCookie('',url.protocol==='https:',0)});
        }
        if(url.pathname==='/api/pin' && request.method==='POST') {
          this.limit(`pin:${token}`,10);
          const {currentPin,newPin}=await this.body(request);
          const result=await this.auth.changePin(token,currentPin,newPin);
          // Keep this browser's sockets on the new session before revocation
          // broadcasts. Other devices have different tokens and are signed out.
          for(const socket of this.ctx.getWebSockets()){
            const peer=socket.deserializeAttachment() as Peer;
            const peerRequest=new Request('https://dunzo.invalid',{headers:{Cookie:peer.cookie}});
            if(peer.playerId===token&&this.auth.token(peerRequest)===this.auth.token(request)){
              socket.serializeAttachment({...peer,cookie:sessionCookie(result.token,false).split(';')[0]});
            }
          }
          await this.broadcast();
          return json({player:result.player},200,{'Set-Cookie':sessionCookie(result.token,url.protocol==='https:')});
        }
        if(url.pathname==='/api/lobby' && request.method==='GET')return json(await this.lobby(token));
        if (url.pathname === '/api/poker/socket') {
          if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket upgrade required' }, 426);
          if (this.ctx.getWebSockets().length >= 32) return json({ error: 'Too many table connections' }, 429);
          const pair = new WebSocketPair();
          this.ctx.acceptWebSocket(pair[1]);
          pair[1].serializeAttachment({ playerId:token, cookie: sessionCookie(this.auth.token(request),false).split(';')[0] });
          await this.sendState(pair[1]);
          return new Response(null, { status: 101, webSocket: pair[0] });
        }
        this.limit(`player:${token}`, 180);
        if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
        // Catch overdue work before accepting any new player action.
        const advanced = await this.service.advance();
        if (advanced) await this.broadcast(advanced);
        if (request.method === 'GET') return json(await this.service.snapshot(token, url.searchParams.get('code') || ''));
        const input=await this.body(request);
        if(['create','join'].includes(input.type))input.name=player.name;
        const result = await this.service.execute(token, input);
        await this.broadcast(result.snapshot.code);
        return json({ ...result.snapshot, ack: result.ack });
      } catch (error) {
        if (error instanceof TableError) return json({ error: error.message }, error.status);
        // Engine validation messages are safe; parser/storage details are not.
        if (error instanceof SyntaxError || (error as Error)?.name === 'ZodError') return json({ error: 'Invalid request' }, 400);
        if (error instanceof Error && !/SQL|storage|internal/i.test(error.message)) return json({ error: error.message }, 400);
        return json({ error: 'Table unavailable. Reconnect and try again.' }, 503);
      }
    });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    return this.serial(async () => {
      try {
        if (typeof message !== 'string' || message.length > 1024) throw new Error('Invalid message');
        const input = JSON.parse(message);
        if (input.protocol !== PROTOCOL_VERSION) throw new Error('Unsupported protocol');
        const peer = socket.deserializeAttachment() as Peer | null;
        if (!peer || !await this.authorized(peer)) throw new Error('Access expired');
        this.limit(`message:${peer.playerId}`,120);
        if (input.type==='ping') { socket.send(JSON.stringify({type:'pong',protocol:PROTOCOL_VERSION}));return; }
        if (input.type!=='resync')throw new Error('Unknown message');
        await this.sendState(socket);
      } catch { socket.close(1008, 'Connection not authorized'); }
    });
  }

  private async lobby(playerId:string) {
    const code=await this.ctx.storage.get<string>('active');
    if(!code)return {activeGame:null};
    const room=await this.ctx.storage.get<any>(`room:${code}`);
    return {activeGame:{code:room.code,phase:room.phase,settings:room.settings,
      players:room.players.filter((p:any)=>!p.left).map((p:any)=>({name:p.name})),
      joined:room.players.some((p:any)=>p.id===playerId&&!p.left)}};
  }

  private async sendState(socket:WebSocket,changedCode?:string) {
    const peer=socket.deserializeAttachment() as Peer;
    const player=await this.authorized(peer);
    if(!player){socket.close(1008,'Please sign in again');return;}
    const lobby=await this.lobby(player.id);
    const code=changedCode||lobby.activeGame?.code;
    let room=null;
    if(code){
      const raw=await this.ctx.storage.get<any>(`room:${code}`);
      if(raw?.players.some((p:any)=>p.id===player.id))room=await this.service.snapshot(player.id,code);
    }
    socket.send(JSON.stringify({protocol:PROTOCOL_VERSION,type:'state',lobby,room}));
  }
  private async broadcast(code?:string) {
    for(const socket of this.ctx.getWebSockets()){
      try{await this.sendState(socket,code)}catch{try{socket.close(1011,'Please reconnect')}catch{}}
    }
  }
  private authorized(peer:Peer) {
    return this.auth.session(new Request('https://dunzo.invalid',{headers:{Cookie:peer.cookie}}));
  }

  webSocketClose(socket: WebSocket, code: number) { try { socket.close(code); } catch {} }
  webSocketError(socket: WebSocket) { try { socket.close(1011, 'Please reconnect'); } catch {} }
  alarm() {
    return this.serial(async () => {
      const code = await this.service.advance();
      if (code) await this.broadcast(code);
    });
  }
}
