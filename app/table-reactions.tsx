'use client';

import { useEffect, useId, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { reactionRenderers } from './reaction-art';
import { REACTIONS, reactionDefinition } from '../lib/reactions.mjs';
import { seatPosition } from '../lib/table-presentation.mjs';
import { type PokerAudio, type PokerSound } from '../lib/poker-audio';
import { type ReactionEvent, type ReactionRoom, type ReactionPlayer, useReactions } from '../lib/client/use-reactions';
import './table-reactions.css';

// Authored vector art stays crisp at every phone size and needs no image request.
function ChappalArt() {
  const rubber = useId();
  const sole = useId();
  return <svg viewBox="0 0 80 120" aria-hidden="true" fill="none">
    <defs>
      <linearGradient id={sole}><stop stopColor="#382b25" /><stop offset=".45" stopColor="#7b5c48" /><stop offset="1" stopColor="#4d392f" /></linearGradient>
      <linearGradient id={rubber}><stop stopColor="#2d2826" /><stop offset=".5" stopColor="#60554b" /><stop offset="1" stopColor="#28221f" /></linearGradient>
    </defs>
    <path d="M24 113C13 109 12 98 15 83L20 30C21 13 29 5 42 6C57 7 65 18 63 35L57 78C56 91 59 104 49 112C42 117 31 117 24 113Z" fill="#211c18" />
    <path d="M24 109C16 105 17 94 19 81L24 29C25 16 31 9 42 10C54 11 61 21 59 35L53 78C52 92 55 101 46 108C39 112 31 112 24 109Z" fill="#684b35" />
    <path d="M26 103C21 100 22 89 24 78L28 30C29 20 33 15 41 16C50 17 56 23 54 35L49 78C47 92 51 99 43 104C37 107 31 107 26 103Z" fill={`url(#${sole})`} />
    <path d="M24 109C34 115 45 113 51 105" stroke="#ad8b67" strokeWidth=".8" />
    <path d="M23 59L40 36L58 56L54 68L40 47L24 70Z" fill="#302820" />
    <path d="M24 57L40 34L58 55L55 62L40 43L24 65Z" fill={`url(#${rubber})`} />
    <path d="M26 56L40 37L55 54" stroke="#967355" strokeWidth="1.2" />
    <path d="M39 35L41 23" stroke="#302820" strokeWidth="5" strokeLinecap="round" />
    <path d="M27 76L33 80L39 77L45 81M26 83L32 87L38 84L44 88M26 90L32 94L37 91L43 95M27 97L32 101L38 98L42 102" stroke="#b39379" strokeWidth="1.1" opacity=".45" />
  </svg>;
}

function ChappalAnimation() {
  return <>
    <div className="reaction-projectile"><div className="reaction-projectile-art"><ChappalArt /></div></div>
    <div className="reaction-impact"><i /><i /><i /></div>
  </>;
}

// Each reaction owns its art, animation and sound. The transport, targeting,
// freshness rules and overlay lifecycle remain the same for future additions.
const renderers: Record<string, { Icon: ComponentType; Animation: ComponentType; sound: PokerSound }> = {
  chappal: { Icon: ChappalArt, Animation: ChappalAnimation, sound: 'chappal' },
  ...reactionRenderers
};

function ReactionAnimation({ event, room, mySeat, audio }: {
  event: ReactionEvent; room: ReactionRoom; mySeat: number; audio: PokerAudio | null;
}) {
  const definition = reactionDefinition(event.reaction);
  const renderer = renderers[event.reaction];
  const [delay] = useState(() => event.startedAt - Date.now());
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!definition?.jolt || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const target = overlay.current?.closest('.table-stage')?.querySelector(`[data-seat-index="${event.to.seat}"] .seat-info`);
    if (!target || Date.now() > event.startedAt + definition.impactAt + 100) return;
    // A short physical jolt at contact sells the hit without moving the seat's
    // layout or interrupting the player clock, cards or betting controls.
    const hit = target.animate([
      { translate: '0 0', offset: 0 }, { translate: '5px 1px', offset: .18 },
      { translate: '-3px -1px', offset: .42 }, { translate: '2px 0', offset: .7 },
      { translate: '0 0', offset: 1 }
    ], { duration: 130, delay: Math.max(0, event.startedAt + definition.impactAt - Date.now()), easing: 'ease-out' });
    return () => hit.cancel();
  }, [event.id, event.startedAt, event.to.seat, definition?.impactAt, definition?.jolt]);
  useEffect(() => {
    // Dropped/late effects never play a detached slap after the animation ends.
    if (definition && renderer && Date.now() < event.startedAt + definition.impactAt) audio?.play(renderer.sound, event.startedAt - Date.now());
  }, [event.id, event.startedAt, definition?.impactAt, renderer, audio]);
  if (!renderer || !definition) return null;
  const from = event.from.seat === null ? { x: 50, y: 90 } : seatPosition(event.from.seat, mySeat, room.settings.seats);
  const to = seatPosition(event.to.seat, mySeat, room.settings.seats);
  const { Animation } = renderer;
  return <div ref={overlay} className={`reaction-overlay reaction-${event.reaction}`} style={{
    '--cheers-side': from.x <= to.x ? -1 : 1,
    '--strike-angle': `${Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI + 90}deg`,
    '--reaction-from-x': `clamp(var(--seat-edge-x), ${from.x}%, calc(100% - var(--seat-edge-x)))`,
    '--reaction-from-y': `clamp(var(--seat-edge-y), ${from.y}%, calc(100% - var(--seat-edge-y)))`,
    '--reaction-to-x': `clamp(var(--seat-edge-x), ${to.x}%, calc(100% - var(--seat-edge-x)))`,
    '--reaction-to-y': `clamp(var(--seat-edge-y), ${to.y}%, calc(100% - var(--seat-edge-y)))`,
    '--reaction-delay': `${delay}ms`, '--reaction-duration': `${definition.duration}ms`
  } as CSSProperties} aria-hidden="true">
    <Animation />
  </div>;
}

export function TableReactions({ room, mySeat, reactions, audio }: {
  room: ReactionRoom; mySeat: number; reactions: ReturnType<typeof useReactions>; audio: PokerAudio | null;
}) {
  const target = room.players.find((p: ReactionPlayer) => p.seat === reactions.target && !p.left && p.id !== room.me);
  useEffect(() => {
    if (!target) return;
    const dismiss = (e: PointerEvent) => {
      if (!(e.target as Element).closest('[data-reaction-picker], [data-reaction-target]')) reactions.setTarget(null);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') reactions.setTarget(null); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [target, reactions]);
  const pos = target ? seatPosition(target.seat, mySeat, room.settings.seats) : null;
  return <>
    {target && pos && room.phase !== 'closed' && <div className={`reaction-picker ${pos.y > 60 ? 'above-seat' : 'below-seat'}`} data-reaction-picker role="dialog" aria-label={`Reactions for ${target.name}`} style={{
      left: `clamp(128px, ${pos.x}%, calc(100% - 128px))`,
      top: `clamp(12px, calc(${pos.y}% ${pos.y > 60 ? '- 210px' : '+ 38px'}), calc(100% - 190px))`
    }}>
      <div className="reaction-picker-heading"><span>Send to <b>{target.name}</b></span><button type="button" aria-label="Close reactions" onClick={() => reactions.setTarget(null)}>×</button></div>
      <div className="reaction-choices" aria-busy={reactions.sending}>{Object.values(REACTIONS).map(definition => {
        const renderer = renderers[definition.id];
        if (!renderer) return null;
        return <button type="button" key={definition.id} disabled={reactions.sending} onClick={() => void reactions.send(definition.id)} title={definition.label} aria-label={`Send ${definition.label} to ${target.name}`}>
          <renderer.Icon />
        </button>;
      })}</div>
      {reactions.error && <p role="status">{reactions.error}</p>}
    </div>}
    {reactions.events.filter(event => event.code === room.code && room.phase !== 'closed' && room.players.some(p => !p.left && p.seat === event.to.seat && p.name === event.to.name)).map(event => <ReactionAnimation key={event.id} event={event} room={room} mySeat={mySeat} audio={audio} />)}
    <span className="reaction-announcement" role="status" aria-live="polite">{reactions.queued ? 'Reaction sent. Effects wait during all-in runouts and expire after five seconds.' : ''}</span>
  </>;
}
