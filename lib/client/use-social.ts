'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PokerClient, type Connection } from './poker-client';
export type SocialEntry = {
  code: string; id: string; sequence: number; kind: 'message' | 'reaction'; at: number;
  own?: boolean; text?: string; reaction?: string; sender: { key: string; name: string; seat: number | null };
  to?: { name: string; seat: number };
};
export type SocialRoom = {
  code: string; createdAt?: number; phase: string; me: string;
  players: { id: string; name: string; seat: number; left?: boolean }[];
  settings: { seats: number };
};
type ChatRequest = { code: string; requestId: string; text: string };
const deliveryUnknown = (error: unknown) => {
  const status = (error as { status?: number } | null)?.status;
  return !status || status === 408 || status >= 500;
};

export function useSocial(room: SocialRoom | null, practice: boolean, connection: Connection, enabled: boolean) {
  const [entries, setEntries] = useState<SocialEntry[]>([]);
  const [bubbles, setBubbles] = useState<SocialEntry[]>([]);
  const [open, setOpenState] = useState(false);
  const [draft, setDraft] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFocus, setHistoryFocus] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [readError, setReadError] = useState('');
  const [sendError, setSendError] = useState('');
  const [unread, setUnread] = useState(0);
  const active = useRef(room);
  const seen = useRef(new Set<string>());
  const inFlight = useRef<string | null>(null);
  const latestLoad = useRef<Promise<void> | null>(null);
  const olderLoad = useRef<Promise<void> | null>(null);
  const syncedThrough = useRef<number | null>(null);
  const historyVisible = useRef(false);
  const epoch = `${room?.code || ''}:${room?.createdAt || ''}:${room?.me || ''}`;
  const generation = useRef(0);
  const local = useRef(practice);
  useLayoutEffect(() => { active.current = room; local.current = practice; }, [room, practice]);
  const retry = useRef<ChatRequest | null>(null);
  const storedRequestKey = `dunzo-chat-pending:${epoch}`;
  const storeRequest = (request: ChatRequest, clear = false) => {
    try {
      if (!clear) sessionStorage.setItem(storedRequestKey, JSON.stringify(request));
      else if (JSON.parse(sessionStorage.getItem(storedRequestKey) || 'null')?.requestId === request.requestId) sessionStorage.removeItem(storedRequestKey);
    } catch { /* In-memory retries remain available if storage is blocked. */ }
  };
  const merge = useCallback((incoming: SocialEntry[]) => {
    setEntries(previous => [...new Map([...previous, ...incoming].map(e => [e.sequence, e])).values()].sort((a, b) => a.sequence - b.sequence));
  }, []);
  const receive = useCallback((entry: SocialEntry, showBubble = true, notify = true) => {
    const current = active.current;
    if (!enabled || !current || entry.code !== current.code || seen.current.has(entry.id)) return;
    seen.current.add(entry.id);
    merge([entry]);
    if (entry.kind !== 'message') return;
    if (notify && !entry.own && !historyVisible.current) setUnread(count => count + 1);
    if (showBubble && !document.hidden) {
      setBubbles(previous => [...previous.filter(e => e.sender.key !== entry.sender.key), { ...entry, at: Date.now() }].slice(-8));
    }
  }, [enabled, merge]);

  const load = useCallback((before?: string) => {
    const current = active.current;
    if (!enabled || !current || local.current) return Promise.resolve();
    const started = generation.current;
    const pending = before ? olderLoad : latestLoad;
    if (pending.current) return pending.current;
    if (before || syncedThrough.current === null) setLoading(true);
    const query = (cursor?: string) => PokerClient.auth(
      `chat?code=${encodeURIComponent(current.code)}${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`
    );
    const task = (async () => {
      try {
        const watermark = syncedThrough.current;
        let page = await query(before);
        if (started !== generation.current) return;
        const head = page.entries.at(-1)?.sequence ?? 0;
        const serverTime = page.serverTime;
        const incoming: SocialEntry[] = [...page.entries];
        // Live updates can arrive out of order. Only a completed history sync
        // can advance the watermark used for reconnect backfill.
        while (!before && watermark !== null && page.nextCursor && page.entries[0]?.sequence > watermark + 1) {
          page = await query(page.nextCursor);
          if (started !== generation.current) return;
          incoming.push(...page.entries);
        }
        if (before || watermark === null) setCursor(page.nextCursor);
        if (!before) syncedThrough.current = Math.max(watermark ?? 0, head);
        for (const entry of incoming.sort((a, b) => a.sequence - b.sequence)) {
          if (!before && watermark !== null && entry.sequence > watermark) {
            receive(entry, typeof serverTime === 'number' && serverTime - entry.at < 15000);
          }
          seen.current.add(entry.id);
        }
        merge(incoming);
        setReadError('');
      } catch (e) {
        if (started === generation.current) setReadError((e as Error).message);
      }
    })().finally(() => {
      if (pending.current !== task) return;
      pending.current = null;
      if (started === generation.current && !latestLoad.current && !olderLoad.current) setLoading(false);
    });
    pending.current = task;
    return task;
  }, [enabled, merge, receive]);
  const refresh = useCallback(() => load(), [load]);
  const setOpen = useCallback((value: boolean) => {
    setOpenState(value);
    historyVisible.current = value;
    if (value) {
      setHistoryOpen(false);
      setHistoryFocus(null);
      setUnread(0);
      void refresh();
    }
  }, [refresh]);
  useLayoutEffect(() => {
    generation.current++;
    setEntries([]); setDraft(''); historyVisible.current = false; setHistoryOpen(false); setHistoryFocus(null);
    setSending(false); inFlight.current = null; syncedThrough.current = null; latestLoad.current = null; olderLoad.current = null;
    setBubbles([]); setOpen(false); setCursor(null); setLoading(false); setReadError(''); setSendError(''); setUnread(0);
    seen.current.clear(); retry.current = null;
    if (room?.code && !practice) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storedRequestKey) || 'null') as ChatRequest | null;
        if (saved?.code === room.code && typeof saved.text === 'string' && typeof saved.requestId === 'string') {
          retry.current = saved;
          setDraft(saved.text);
          setSendError('Delivery unconfirmed. Retry to check the previous send.');
        }
      } catch { /* A malformed or inaccessible saved draft is ignored. */ }
    }
  }, [epoch, setOpen]);
  useEffect(() => { void refresh(); }, [epoch, refresh]);
  useEffect(() => {
    if (connection === 'connected') void refresh();
  }, [connection, refresh]);
  useEffect(() => {
    if (room?.phase === 'closed') void refresh();
  }, [room?.phase, refresh]);
  useEffect(() => {
    if (!enabled || practice || !room?.code || (room.phase === 'closed' && !historyOpen)) return;
    const sync = () => { if (!document.hidden && navigator.onLine) void refresh(); };
    const timer = setInterval(sync, 8000);
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [enabled, practice, room?.code, room?.phase, historyOpen, refresh]);
  useEffect(() => {
    const timer = setInterval(() => setBubbles(previous => previous.filter(e => Date.now() - e.at < 5000)), 500);
    const hide = () => { if (document.hidden) setBubbles([]); };
    document.addEventListener('visibilitychange', hide);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', hide); };
  }, []);
  function practiceEntry(data: Partial<SocialEntry>) {
    const current = active.current;
    if (!current) return;
    const me = current.players.find((p) => p.id === current.me);
    receive({ code: current.code, id: crypto.randomUUID(), sequence: Date.now(), at: Date.now(),
      kind: 'message', own: true, sender: { key: current.me, name: me?.name || 'You', seat: me && !me.left ? me.seat : null }, ...data });
  }
  async function send(text: string) {
    const current = active.current;
    if (!current || !enabled || current.phase === 'closed' || inFlight.current || !text.trim()) return false;
    const started = generation.current;
    const request = retry.current?.text === text.trim() ? retry.current
      : { code: current.code, requestId: crypto.randomUUID(), text: text.trim() };
    retry.current = request;
    inFlight.current = request.requestId;
    if (!practice) storeRequest(request);
    setSending(true); setSendError('');
    try {
      if (practice) practiceEntry({ text: request.text });
      else {
        let result;
        try { result = await PokerClient.auth('chat', request); }
        catch (e) {
          if (!deliveryUnknown(e) || !navigator.onLine || started !== generation.current) throw e;
          // The first response may have been lost after the write committed.
          result = await PokerClient.auth('chat', request);
        }
        if (!result?.entry) throw new Error('Chat confirmation unavailable');
        if (started === generation.current) receive(result.entry, !result.replayed, false);
        storeRequest(request, true);
      }
      if (retry.current?.requestId === request.requestId) retry.current = null;
      return started === generation.current;
    } catch (e) {
      const error = e as Error;
      if (!deliveryUnknown(error)) storeRequest(request, true);
      if (started === generation.current) setSendError(deliveryUnknown(error)
        ? 'Delivery unconfirmed. Retry to check the previous send.'
        : error.message);
      return false;
    } finally {
      if (inFlight.current === request.requestId) inFlight.current = null;
      if (started === generation.current) setSending(false);
    }
  }
  function openHistory(id: string | null = null) {
    setOpenState(active.current?.phase !== 'closed');
    setHistoryFocus(id); historyVisible.current = true; setHistoryOpen(true); setUnread(0);
    void refresh();
  }
  function closeHistory() {
    historyVisible.current = false;
    setHistoryOpen(false);
  }
  return { entries, bubbles, open, setOpen, draft, setDraft, historyOpen, closeHistory, historyFocus, openHistory,
    cursor, loading, sending, readError, sendError, unread, receive, send, refresh,
    loadMore: () => cursor ? load(cursor) : Promise.resolve(), practiceEntry };
}
