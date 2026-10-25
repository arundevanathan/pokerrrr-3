import { commandEnvelope, PROTOCOL_VERSION } from '../protocol/poker.mjs';

type Snapshot = { code: string; version: number; handStartedAt?: number } & Record<string, any>;
export type Connection = 'connecting' | 'connected' | 'reconnecting' | 'offline';
export class PokerClient {
  constructor(private playerId: string) {}

  static async auth(path: string, body?: Record<string,unknown>) {
    const response=await fetch(`/api/${path}`,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15_000)});
    const result=await response.json() as any;
    if(!response.ok)throw Object.assign(new Error(result.error||'Could not sign in'),{status:response.status});
    return result;
  }

  private async request(input?: Record<string, any>, code?: string) {
    const response = await fetch(input ? '/api/poker' : `/api/poker?code=${encodeURIComponent(code || '')}`, {
      method: input ? 'POST' : 'GET',
      headers: { ...(input && { 'Content-Type': 'application/json' }) },
      ...(input && { body: JSON.stringify(input) }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json() as Snapshot & { error?: string };
    if (!response.ok) throw Object.assign(new Error(data.error || 'Could not reach the table'), { status: response.status });
    return data as Snapshot;
  }

  snapshot(code: string) { return this.request(undefined, code); }
  private get pendingKey() { return `dunzo-club-command:${this.playerId}`; }
  hasPending() { return Boolean(localStorage.getItem(this.pendingKey)); }
  async retryPending() {
    const stored = localStorage.getItem(this.pendingKey);
    if (!stored) return null;
    return this.deliver(JSON.parse(stored));
  }
  async send(input: Record<string, any>, room?: Snapshot) {
    if (this.hasPending()) throw new Error('An earlier action is unconfirmed. Use Retry last action before sending another.');
    const envelope = commandEnvelope(input, room);
    // Retain the same command ID across lost replies, reloads and manual retries.
    localStorage.setItem(this.pendingKey, JSON.stringify(envelope));
    return this.deliver(envelope);
  }
  private async deliver(input: Record<string, any>) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const snapshot = await this.request(input);
        localStorage.removeItem(this.pendingKey);
        return snapshot;
      } catch (error: any) {
        if (error.status && error.status < 500) {
          // Authentication/rate failures happen before receipt lookup; preserve
          // an earlier, possibly accepted command until it can be checked.
          if (![401, 403, 429].includes(error.status)) localStorage.removeItem(this.pendingKey);
          throw error;
        }
        if (attempt === 2) throw new Error('Action unconfirmed. Reconnect and use Retry last action; it will not apply twice.');
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    throw new Error('Connection failed');
  }

  connect(update: (state: {lobby:any;room:Snapshot|null}) => void, status: (state: Connection) => void, expired: () => void) {
    let stopped = false, socket: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0, watchdog: ReturnType<typeof setTimeout> | undefined;
    const dial = async () => {
      if (stopped) return;
      try { const session=await PokerClient.auth('session');if(stopped)return;if(!session.player){expired();return;} } catch { if(stopped)return;retry=setTimeout(dial,5000);return; }
      status(navigator.onLine ? (attempts ? 'reconnecting' : 'connecting') : 'offline');
      const url = new URL('/api/poker/socket', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url);
      watchdog = setTimeout(() => socket?.close(), 15_000);
      socket.onopen = () => {}; // Server authenticates the HttpOnly session cookie.
      socket.onmessage = event => {
        if (stopped) return;
        try {
          const message = JSON.parse(event.data);
          if (message.protocol !== PROTOCOL_VERSION) { socket?.close(); return; }
          if (message.type === 'pong') { clearTimeout(watchdog); return; }
          if (message.type !== 'state' || (message.room && !Number.isSafeInteger(message.room.version))) return;
          clearTimeout(watchdog); attempts = 0; status('connected');
          update(message);
        } catch { socket?.close(); }
      };
      socket.onclose = event => {
        clearTimeout(watchdog);
        if (stopped) return;
        if(event.code===1008){expired();return;}
        status(navigator.onLine ? 'reconnecting' : 'offline');
        retry = setTimeout(dial, Math.min(15_000, 500 * 2 ** Math.min(attempts++, 5)) + Math.random() * 300);
      };
      socket.onerror = () => socket?.close();
    };
    const resume = () => {
      if (document.hidden || stopped) return;
      if (socket?.readyState === WebSocket.OPEN) {
        // A ping detects half-open mobile connections; reconnect sends a full view.
        socket.send(JSON.stringify({ protocol: PROTOCOL_VERSION, type: 'ping' }));
        clearTimeout(watchdog); watchdog = setTimeout(() => socket?.close(), 10_000);
      } else if (!socket || socket.readyState === WebSocket.CLOSED) { clearTimeout(retry); dial(); }
    };
    const heartbeat = setInterval(resume, 20_000);
    window.addEventListener('online', resume); document.addEventListener('visibilitychange', resume);
    dial();
    return () => {
      stopped = true; clearTimeout(retry); clearTimeout(watchdog); clearInterval(heartbeat); socket?.close();
      window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume);
    };
  }
}
