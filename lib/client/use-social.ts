'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PokerClient, type Connection } from './poker-client';
export type SocialEntry = {
  code: string; id: string; sequence: number; kind: 'message' | 'reaction'; at: number;
  text?: string; reaction?: string; sender: { key: string; name: string; seat: number | null };
  to?: { name: string; seat: number };
};
export type SocialRoom = {
  code: string; createdAt?: number; phase: string; me: string;
  players: { id: string; name: string; seat: number; left?: boolean }[];
  settings: { seats: number };
};
export function useSocial(room: SocialRoom | null, practice: boolean, connection: Connection, enabled: boolean) {
  const [entries, setEntries] = useState<SocialEntry[]>([]);
  const [bubbles, setBubbles] = useState<SocialEntry[]>([]);
  const [open, setOpenState] = useState(false);
  const composeBaseline = useRef(0);
  const [draft, setDraft] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFocus, setHistoryFocus] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(room);
  const seen = useRef(new Set<string>());
  const inFlight = useRef<string | null>(null);
  const newestLoad = useRef<{ epoch: string; at: number } | null>(null);
  const loadedEpoch = useRef<string | null>(null);
  const latest = useRef(0);
  const epoch = `${room?.code || ''}:${room?.createdAt || ''}:${room?.me || ''}`;
  const epochRef = useRef(epoch);
  const local = useRef(practice);
  useLayoutEffect(() => { active.current = room; epochRef.current = epoch; local.current = practice; }, [room, epoch, practice]);
  const setOpen = useCallback((value: boolean) => { setOpenState(value); }, []);
  const retry = useRef<{ code: string; requestId: string; text: string } | null>(null);
  const merge = useCallback((incoming: SocialEntry[]) => {
    latest.current = Math.max(latest.current, ...incoming.map(e => e.sequence));
    setEntries(previous => [...new Map([...previous, ...incoming].map(e => [e.sequence, e])).values()].sort((a, b) => a.sequence - b.sequence));
  }, []);
  const receive = useCallback((entry: SocialEntry) => {
    const current = active.current;
    if (!enabled || !current || entry.code !== current.code || seen.current.has(entry.id)) return;
    seen.current.add(entry.id);
    merge([entry]);
    if (entry.kind === 'message' && !document.hidden && Math.abs(Date.now() - entry.at) < 10000) {
      setBubbles(previous => [...previous.filter(e => e.sender.key !== entry.sender.key), { ...entry, at: Date.now() }].slice(-8));
    }
  }, [enabled, merge]);
  const load = useCallback(async (before?: string, background = false) => {
    const current = active.current;
    if (!enabled || !current || local.current) return;
    const started = epochRef.current;
    if (background && newestLoad.current?.epoch === started && Date.now() - newestLoad.current.at < 5000) return;
    if (!before) newestLoad.current = { epoch: started, at: Date.now() };
    if (!background) setLoading(true);
    try {
      const watermark = latest.current;
      const hasBaseline = loadedEpoch.current === started;
      let data = await PokerClient.auth(`chat?code=${encodeURIComponent(current.code)}${before ? `&before=${before}` : ''}`);
      const incoming: SocialEntry[] = [...data.entries];
      // Fill reconnect gaps even when more than one page arrived while asleep.
      while (!before && watermark > 0 && data.nextCursor && data.entries[0]?.sequence > watermark) {
        if (started !== epochRef.current) return;
        data = await PokerClient.auth(`chat?code=${encodeURIComponent(current.code)}&before=${data.nextCursor}`);
        incoming.push(...data.entries);
      }
      if (started !== epochRef.current) return;
      for (const entry of incoming) {
        if (background && hasBaseline && entry.sequence > watermark) receive(entry);
        seen.current.add(entry.id);
      }
      merge(incoming);
      loadedEpoch.current = started;
      setCursor(previous => before || watermark === 0 ? data.nextCursor : previous === null || data.nextCursor === null ? null : String(Math.min(Number(previous), Number(data.nextCursor))));
      if (!background) setError('');
    } catch (e) { if (!background && started === epochRef.current) setError((e as Error).message); }
    finally { if (!background && started === epochRef.current) setLoading(false); }
  }, [enabled, merge, receive]);
  useEffect(() => {
    // Reset the external game's conversation on identity/session changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntries([]); setDraft(''); setHistoryOpen(false); setHistoryFocus(null); setSending(false); inFlight.current = null; latest.current = 0; setBubbles([]); setOpen(false); setCursor(null); setError('');
    seen.current.clear(); retry.current = null;
    void load();
  }, [epoch, load, setOpen]);
  useEffect(() => {
    // Synchronize history when the external WebSocket connection recovers.
    if (connection === 'connected') void load(undefined, true);
  }, [connection, load]);
  useEffect(() => {
    if (!enabled || practice || !room?.code || room.phase === 'closed') return;
    const refresh = () => { if (!document.hidden && navigator.onLine) void load(undefined, true); };
    const timer = setInterval(refresh, 8000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [enabled, practice, room?.code, room?.phase, load]);
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
      kind: 'message', sender: { key: current.me, name: me?.name || 'You', seat: me && !me.left ? me.seat : null }, ...data });
  }
  async function send(text: string) {
    const current = active.current;
    if (!current || !enabled || current.phase === 'closed' || inFlight.current || !text.trim()) return false;
    const started = epochRef.current;
    setSending(true); setError('');
    const request = retry.current && retry.current.code === current.code && retry.current.text === text.trim() ? retry.current
      : { code: current.code, requestId: crypto.randomUUID(), text: text.trim() };
    retry.current = request;
    inFlight.current = request.requestId;
    try {
      if (practice) practiceEntry({ text: request.text });
      else {
        const result = await PokerClient.auth('chat', request);
        if (started === epochRef.current) receive(result.entry);
      }
      if (retry.current?.requestId === request.requestId) retry.current = null;
      return true;
    } catch (e) { if (started === epochRef.current) setError(`${(e as Error).message}. Send again to retry.`); return false; }
    finally { if (inFlight.current === request.requestId) inFlight.current = null; if (started === epochRef.current) setSending(false); }
  }
  function openHistory(id: string | null = null) {
    setOpen(false); setHistoryFocus(id); setHistoryOpen(true);
  }
  return { entries, bubbles, open, setOpen, composeBaseline, draft, setDraft, historyOpen, setHistoryOpen, historyFocus, openHistory, cursor, loading, sending, error, receive, send,
    loadMore: () => cursor ? load(cursor) : load(), practiceEntry };
}
