'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { MessageCircle, X, RefreshCw } from 'lucide-react';
import { reactionHistoryLabel } from '../lib/reactions.mjs';
import { seatPosition } from '../lib/table-presentation.mjs';
import { type SocialRoom, type useSocial } from '../lib/client/use-social';
import './table-chat.css';
type Social = ReturnType<typeof useSocial>;
export function ChatButton({ social, readOnly = false }: { social: Social; readOnly?: boolean }) {
  return <button className="icon-button chat-toggle" aria-label="Table chat" aria-expanded={social.open || social.historyOpen} onClick={() => {
    if (readOnly) { social.openHistory(); return; }
    flushSync(() => social.setOpen(true));
    document.getElementById('chat-message')?.focus({ preventScroll: true });
  }}>
    <MessageCircle size={21} />
    {social.unread > 0 && <span className="chat-unread" aria-label="Unread chat">•</span>}
  </button>;
}
export function SpeechBubbles({ room, social }: { room: SocialRoom; social: Social }) {
  const me = room.players.find((p) => p.id === room.me && !p.left);
  return <div className="speech-layer" >{social.bubbles.map(entry => {
    const player = room.players.find((p) => !p.left && p.seat === entry.sender.seat && p.name === entry.sender.name);
    const pos = player ? seatPosition(player.seat, me?.seat || 0, room.settings.seats) : { x: 50, y: 15 };
    return <button type="button" onClick={() => {
      flushSync(() => social.openHistory(entry.id));
      document.getElementById('chat-message')?.focus({ preventScroll: true });
    }} aria-label={`${entry.sender.name}: ${entry.text}. Open table chat`} key={entry.id} data-relative-seat={player ? (player.seat - (me?.seat || 0) + room.settings.seats) % room.settings.seats : undefined} className={`speech-bubble ${player ? 'has-speaker' : ''} ${pos.y > 60 ? 'bubble-above' : 'bubble-below'}`} style={{ left: `clamp(80px, ${pos.x}%, calc(100% - 80px))`, top: `clamp(45px, ${pos.y}%, calc(100% - 45px))` }}>
      <span className="speech-bubble-content">{!player && <b>{entry.sender.name} · </b>}{entry.text}</span>
    </button>;
  })}</div>;
}
export function ChatDrawer({ room, social, myTurn }: { room: SocialRoom; social: Social; myTurn: boolean }) {
  const { draft, setDraft, historyOpen } = social;
  const visible = social.open || historyOpen;
  const composing = social.open && room.phase !== 'closed';
  const close = () => { social.setOpen(false); social.closeHistory(); };
  const input = useRef<HTMLInputElement>(null);
  const restoreTriggerFocus = useRef(true);
  const history = useRef<HTMLElement>(null);
  useEffect(() => {
    if (room.phase === 'closed' && social.open) { social.setOpen(false); social.openHistory(); }
  }, [room.phase, social.open]);
  useLayoutEffect(() => {
    if (!visible) return;
    restoreTriggerFocus.current = true;
    const previous = document.activeElement;
    if (!composing) history.current?.querySelector<HTMLButtonElement>('[aria-label="Close game chat"]')?.focus();
    return () => {
      if (restoreTriggerFocus.current && previous instanceof HTMLElement && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [visible, composing]);
  useLayoutEffect(() => {
    if (!visible) return;
    const overlay = history.current?.parentElement;
    const viewport = window.visualViewport;
    const measure = () => {
      if (!overlay || !viewport) return;
      overlay.style.setProperty('--chat-top', `${viewport.offsetTop}px`);
      overlay.style.setProperty('--chat-left', `${viewport.offsetLeft}px`);
      overlay.style.setProperty('--chat-height', `${viewport.height}px`);
      overlay.style.setProperty('--chat-width', `${viewport.width}px`);
    };
    measure();
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    return () => {
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
    };
  }, [visible]);
  const scroll = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastSequence = social.entries.at(-1)?.sequence;
  useLayoutEffect(() => { if (visible) atBottom.current = true; }, [visible]);
  useLayoutEffect(() => {
    if (!visible) return;
    const target = historyOpen && social.historyFocus && document.getElementById(`chat-entry-${social.historyFocus}`);
    if (target) { atBottom.current = false; target.scrollIntoView({ block: 'center' }); }
    else if (atBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [lastSequence, visible, historyOpen, social.historyFocus]);
  useLayoutEffect(() => {
    const messages = scroll.current;
    if (!messages || !visible) return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) messages.scrollTop = messages.scrollHeight;
    });
    observer.observe(messages);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'Tab') {
        const controls = [...(history.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') || [])];
        const first = controls[0], last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [visible, social]);
  if (!visible) return null;
  return createPortal(<div className="chat-overlay" onClick={e => { if (e.target === e.currentTarget) close(); }}>
  <aside ref={history} className="chat-drawer" role="dialog" aria-modal="true" aria-label="Table chat">
    <header><h2>Table chat</h2><div className="chat-history-actions">
      {social.readError && <button className="icon-button" aria-label="Refresh game chat" onClick={() => void social.refresh()}><RefreshCw size={17} /></button>}
      <button className="icon-button" aria-label="Close game chat" onClick={close}><X size={20} /></button>
    </div></header>
    {myTurn && <button className="chat-turn" onClick={close}>Your turn · Back to game</button>}
    <div className="chat-messages" ref={scroll} onScroll={() => { const el = scroll.current; if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64; }}>
      {social.cursor && <button className="chat-older" disabled={social.loading} onClick={async () => {
        const el = scroll.current, height = el?.scrollHeight || 0, top = el?.scrollTop || 0;
        atBottom.current = false;
        await social.loadMore();
        requestAnimationFrame(() => { if (el) el.scrollTop = top + el.scrollHeight - height; });
      }}>{social.loading ? 'Loading…' : 'Earlier messages'}</button>}
      {!social.entries.length && <p className="chat-empty">{social.loading ? 'Loading conversation…' : 'Say something to the table.'}</p>}
      {social.entries.map(entry => entry.kind === 'reaction' ? <div className="chat-activity" key={entry.id}>{reactionHistoryLabel(entry.reaction)?.icon || '✦'} {entry.sender.name} → {entry.to?.name} · {reactionHistoryLabel(entry.reaction)?.label || 'Reaction'}</div> : <article id={`chat-entry-${entry.id}`} className="chat-message" key={entry.id}>
        <div><b>{entry.sender.name}</b><time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
        <p>{entry.text}</p>
      </article>)}
    </div>
    {social.readError && <p className="chat-error" role="status">{social.readError}</p>}
    {composing && social.sendError && <p className="chat-error" role="status">{social.sendError}</p>}
    {composing && <form className="chat-compose" onSubmit={async e => {
      e.preventDefault();
      if (!await social.send(draft)) return;
      restoreTriggerFocus.current = false;
      setDraft(current => current === draft ? '' : current);
      input.current?.blur();
      close();
    }}>
      <label className="sr-only" htmlFor="chat-message">Message</label><input ref={input} id="chat-message" value={draft} onChange={e => setDraft(e.target.value)} maxLength={500} readOnly={social.sending} placeholder="Message the table…" autoComplete="off" enterKeyHint="send" />
      <button type="submit" onPointerDown={e => e.preventDefault()} disabled={social.sending || !draft.trim()}>{social.sending ? 'Sending…' : 'Send'}</button>
    </form>}
  </aside></div>, document.body);
}
