'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { MessageCircle, Send, X, Maximize2 } from 'lucide-react';
import { reactionDefinition } from '../lib/reactions.mjs';
import { seatPosition } from '../lib/table-presentation.mjs';
import { type SocialRoom, type useSocial } from '../lib/client/use-social';
import './table-chat.css';
type Social = ReturnType<typeof useSocial>;
export function ChatButton({ social, readOnly = false }: { social: Social; readOnly?: boolean }) {
  return <button className="icon-button chat-toggle" aria-label="Write a message" aria-expanded={social.open} onClick={() => {
    if (readOnly) { social.openHistory(); return; }
    social.composeBaseline.current = window.visualViewport?.height || window.innerHeight;
    flushSync(() => social.setOpen(true));
    document.getElementById('chat-message')?.focus();
  }}>
    <MessageCircle size={21} />
  </button>;
}
export function SpeechBubbles({ room, social }: { room: SocialRoom; social: Social }) {
  const me = room.players.find((p) => p.id === room.me && !p.left);
  return <div className="speech-layer" >{social.bubbles.map(entry => {
    const player = room.players.find((p) => !p.left && p.seat === entry.sender.seat && p.name === entry.sender.name);
    const pos = player ? seatPosition(player.seat, me?.seat || 0, room.settings.seats) : { x: 50, y: 15 };
    return <button type="button" onClick={() => social.openHistory(entry.id)} aria-label={`${entry.sender.name}: ${entry.text}. Open chat history`} key={entry.id} data-relative-seat={player ? (player.seat - (me?.seat || 0) + room.settings.seats) % room.settings.seats : undefined} className={`speech-bubble ${player ? 'has-speaker' : ''} ${pos.y > 60 ? 'bubble-above' : 'bubble-below'}`} style={{ left: `clamp(80px, ${pos.x}%, calc(100% - 80px))`, top: `clamp(45px, ${pos.y}%, calc(100% - 45px))` }}>
      <span className="speech-bubble-content">{!player && <b>{entry.sender.name} · </b>}{entry.text}</span>
    </button>;
  })}</div>;
}
export function ChatDrawer({ room, social, myTurn }: { room: SocialRoom; social: Social; myTurn: boolean }) {
  const { draft, setDraft, historyOpen } = social;
  const input = useRef<HTMLInputElement>(null);
  const history = useRef<HTMLElement>(null);
  useEffect(() => {
    if (room.phase === 'closed' && social.open) { social.setOpen(false); social.openHistory(); }
  }, [room.phase, social.open]);
  useLayoutEffect(() => { if (social.open) input.current?.focus(); }, [social.open]);
  useLayoutEffect(() => {
    if (!historyOpen) return;
    history.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { document.querySelector<HTMLButtonElement>('.chat-toggle')?.focus(); };
  }, [historyOpen]);
  const scroll = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastSequence = social.entries.at(-1)?.sequence;
  useEffect(() => {
    if (historyOpen && !social.historyFocus && atBottom.current) scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [lastSequence, historyOpen, social.historyFocus]);
  useEffect(() => {
    if (!social.open && !historyOpen) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { social.setOpen(false); social.setHistoryOpen(false); }
      if (e.key === 'Tab' && historyOpen) {
        const buttons = [...(history.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
        const first = buttons[0], last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [social]);
  useLayoutEffect(() => {
    if (historyOpen && social.historyFocus) document.getElementById(`chat-entry-${social.historyFocus}`)?.scrollIntoView({ block: 'center' });
  }, [historyOpen, social.historyFocus]);
  // Native keyboard dismissal blurs the input on some phones but only resizes on
  // others. Wait until it has actually opened before watching for its dismissal.
  useEffect(() => {
    if (!social.open || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const baseline = social.composeBaseline.current || Math.max(window.innerHeight, document.documentElement.clientHeight);
    let keyboardSeen = false;
    const resize = () => {
      if (baseline - viewport.height > 140) keyboardSeen = true;
      else if (keyboardSeen) { input.current?.blur(); social.setOpen(false); }
    };
    viewport.addEventListener('resize', resize);
    resize();
    return () => viewport.removeEventListener('resize', resize);
  }, [social.open, social.setOpen]);
  if (!social.open && !historyOpen) return social.error ? <button className="chat-retry" onClick={() => { flushSync(() => social.setOpen(true)); input.current?.focus(); }}>Message not sent · Tap to retry</button> : null;
  const content = <aside ref={historyOpen ? history : undefined} className={historyOpen ? 'chat-drawer chat-history' : 'chat-composer'} role={historyOpen ? 'dialog' : 'region'} aria-modal={historyOpen || undefined} aria-label={historyOpen ? 'Game chat history' : 'Write a message'}>
    {historyOpen && <><header><div><h2>Game chat</h2><small>{room.phase === 'closed' ? 'Read-only · Game ended' : 'This game only'}</small></div><button className="icon-button" aria-label="Close game chat" onClick={() => social.setHistoryOpen(false)}><X size={20} /></button></header>
    {myTurn && <button className="chat-turn" onClick={() => social.setHistoryOpen(false)}>Your turn · Back to game</button>}
    <div className="chat-messages" ref={scroll} onScroll={() => { const el = scroll.current; if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64; }}>
      {social.cursor && <button className="chat-older" disabled={social.loading} onClick={async () => {
        const el = scroll.current, height = el?.scrollHeight || 0, top = el?.scrollTop || 0;
        atBottom.current = false;
        await social.loadMore();
        requestAnimationFrame(() => { if (el) el.scrollTop = top + el.scrollHeight - height; });
      }}>{social.loading ? 'Loading…' : 'Earlier messages'}</button>}
      {!social.entries.length && <p className="chat-empty">{social.loading ? 'Loading conversation…' : 'Say something to the table.'}</p>}
      {social.entries.map(entry => entry.kind === 'reaction' ? <div className="chat-activity" key={entry.id}>{reactionDefinition(entry.reaction)?.icon || '✦'} {entry.sender.name} → {entry.to?.name} · {reactionDefinition(entry.reaction)?.label || 'Reaction'}</div> : <article id={`chat-entry-${entry.id}`} className="chat-message" key={entry.id}>
        <div><b>{entry.sender.name}</b><time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
        <p>{entry.text}</p>
      </article>)}
    </div><button className="chat-back" onClick={() => social.setHistoryOpen(false)}>Back to game</button></>}
    {social.error && <p className="chat-error" role="status">{social.error}<button onClick={() => void social.loadMore()}>Refresh</button></p>}
    {!historyOpen && room.phase !== 'closed' && <form className="chat-compose" onSubmit={async e => { e.preventDefault(); const sentDraft = draft; const request = social.send(sentDraft); input.current?.blur(); social.setOpen(false); if (await request) setDraft(current => current === sentDraft ? '' : current); }}>
      <button type="button" className="chat-expand" onPointerDown={e => e.preventDefault()} aria-label="Expand chat history" onClick={() => { input.current?.blur(); social.openHistory(); }}><Maximize2 size={19} /></button>
      <label className="sr-only" htmlFor="chat-message">Message</label><input ref={input} id="chat-message" value={draft} onChange={e => setDraft(e.target.value)} maxLength={500} readOnly={social.sending} placeholder="Message the table…" autoComplete="off" enterKeyHint="send" />
      <button type="submit" onPointerDown={e => e.preventDefault()} aria-label="Send message" disabled={social.sending || !draft.trim()}><Send size={20} /></button>
      <button type="button" aria-label="Close message composer" onClick={() => social.setOpen(false)}><X size={20} /></button>
    </form>}
  </aside>;
  return historyOpen ? createPortal(content, document.body) : content;
}
