'use client';

import { useState } from 'react';
import { seatPosition, FLIGHT_MS } from '../lib/table-presentation.mjs';
function Motion({
  at,
  clock,
  style,
  kind,
  children
}: {
  at: number;
  clock?: number;
  style: any;
  kind: string;
  children: React.ReactNode;
}) {
  const [delay] = useState(() => at - Date.now());
  return <div aria-hidden="true" className={kind} style={{
    ...style,
    animationDelay: `${clock === undefined ? delay : at-clock}ms`,
    animationPlayState: clock === undefined ? undefined : 'paused'
  }}>
    {children}
  </div>;
}
export function TableMotion({
  room,
  mySeat,
  effects
}: {
  room: any;
  mySeat: number;
  effects: any;
}) {
  const {
    deal,
    dealing,
    now
  } = effects;
  return <div className="table-motion" aria-hidden="true">

    {dealing && <div className={`dealing-deck ${now < deal.startedAt + 480 ? 'is-shuffling' : ''}`}>
      <span />
      <span />
      <span>♠</span>
    </div>}

    {dealing && deal.flights.filter((f: any) => now < deal.startedAt + f.arrival).map((f: any) => {
      const pos = seatPosition(f.seat, mySeat, room.settings.seats);
      return <Motion clock={effects.controlledNow} key={`${deal.key}:${f.seat}:${f.round}`} at={deal.startedAt + f.at} kind="flying-card" style={{
        '--target-x': `clamp(var(--seat-edge-x), ${pos.x}%, calc(100% - var(--seat-edge-x)))`,
        '--target-y': `clamp(var(--seat-edge-y), ${pos.y}%, calc(100% - var(--seat-edge-y)))`,
        animationDuration: `${FLIGHT_MS}ms`
      }}>
        <span>♠</span>
      </Motion>;
    })}

    {room.phase === 'showdown' && effects.payouts.map((payment: any) => {
      const p = room.players.find((p: any) => p.id === payment.id);
      if (!p || now > payment.at + payment.duration) return null;
      const pos = seatPosition(p.seat, mySeat, room.settings.seats);
      return <Motion clock={effects.controlledNow} key={`${room.handStartedAt}:${payment.run}:${payment.label}:${payment.id}`} at={payment.at} kind="pot-transfer" style={{
        '--target-x': `clamp(var(--seat-edge-x), ${pos.x}%, calc(100% - var(--seat-edge-x)))`,
        '--target-y': `clamp(var(--seat-edge-y), ${pos.y}%, calc(100% - var(--seat-edge-y)))`,
        animationDuration: `${payment.duration}ms`
      }}>
        <div className="moving-chips">
          <i />
          <i />
          <i />
          <i />
        </div>
        <b>{room.runCount === 2 ? `Run ${payment.run} · ` : ''}{payment.label} +{new Intl.NumberFormat('en-IN').format(payment.amount)}</b>
      </Motion>;
    })}

  </div>;
}
