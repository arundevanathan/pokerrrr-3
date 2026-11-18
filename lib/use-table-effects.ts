'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { dealPlan, boardPlan, showdownTiming, presentationAt, payoutAwards, payoutEvents, visibleStack } from './table-presentation.mjs';
import { PokerAudio } from './poker-audio';
import { bettingOpportunity } from './client/raise-selection.mjs';
export function useTableEffects(room: any, audio: PokerAudio | null, hasAutomaticAction = false) {
  const [flow, setFlow] = useState<any>({}),
    [now, setNow] = useState(Date.now());
  const previous = useRef<any>(null),
    heard = useRef<any>(null);
  const waitingForVisibleSnapshot = useRef(true);
  const silence = useRef(true);
  const audibleAfter = useRef(0);
  const turnVibration = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => {
    if (!room || document.hidden) {
      silence.current = true;
      if (!room) waitingForVisibleSnapshot.current = true;
      return;
    }
    const first = waitingForVisibleSnapshot.current || previous.current?.code !== room.code;
    silence.current = first;
    if (first) audibleAfter.current = room.serverTime || Date.now();
    waitingForVisibleSnapshot.current = false;
  }, [room]);
  const handKey = room ? `${room.code}:${room.handStartedAt ?? (room.phase === 'showdown' ? room.completed : room.completed + 1)}` : '';
  useLayoutEffect(() => {
    if (!room) {
      previous.current = null;
      setFlow({});
      audio?.cancel();
      return;
    }
    const before = previous.current,
      first = !before || before.code !== room.code,
      newHand = first || before.handKey !== handKey,
      changedBoard = newHand || before.boardCount !== room.board.length,
      newResult = room.phase === 'showdown' && (newHand || before.phase !== 'showdown');
    const timestamp = Date.now(),
      serverNow = room.serverTime || timestamp;
    let next: any = {};
    if (newHand) {
      audio?.cancel();
      const plan = dealPlan(room),
        elapsed = room.handStartedAt ? Math.max(0, serverNow - room.handStartedAt) : 0,
        animate = ['preflop', 'flop', 'turn', 'river', 'runout_vote'].includes(room.phase) && (!first || room.handStartedAt) && elapsed < plan.duration;
      next = {
        handKey
      };
      if (animate) {
        const startedAt = timestamp - elapsed;
        next.deal = {
          ...plan,
          startedAt,
          key: handKey
        };
        if (!silence.current && elapsed < 250) audio?.play('deal');
      }
    }
    if (newResult) {
      const from = room.runVote?.sharedBoard.length ?? (newHand ? room.board.length : before.boardCount),
        counts = Array.from({
          length: room.runCount || 1
        }, (_, i) => payoutAwards(room.result, room.runCount).filter((p: { run: number }) => p.run === i + 1).length),
        plan = room.presentation || showdownTiming(from, room.board.length, room.result?.length || 1, room.runCount || 1, counts, Boolean(room.runVote?.revealed)),
        startedAt = timestamp - Math.max(0, serverNow - (room.showdownAt || serverNow));
      next.showdown = {
        key: handKey,
        startedAt,
        plan
      };
      for (const run of plan.runs) {
        const timeline = {
          events: run.events,
          startedAt: startedAt + run.boardStart,
          key: `${handKey}:run-${run.run}`
        };
        if (run.run === 1) next.board = timeline; else next.board2 = timeline;
      }
      if (!silence.current) {
        const awards: { at: number; returned?: boolean }[] = payoutEvents(room, startedAt, plan);
        const winTimes = new Set(awards.filter(award => !award.returned).map(award => award.at));
        for (const at of winTimes) if (at >= timestamp) audio?.play('win', at - timestamp);
      }
    } else if (changedBoard && room.board.length && !first) {
      const events = boardPlan(newHand ? 0 : before.boardCount, room.board.length),
        base = next.deal ? Math.max(timestamp, next.deal.startedAt + next.deal.duration) : timestamp;
      next.board = {
        events,
        startedAt: base,
        key: `${handKey}:street`
      };
    }
    if (newHand || changedBoard || newResult) setFlow((old: any) => {
      if (newHand) return next;
      if (!newResult && next.board && old.board) {
        const previousEnd = old.board.startedAt + (old.board.events.at(-1)?.at || 0) + 380;
        if (previousEnd > next.board.startedAt) {
          const offset = previousEnd - old.board.startedAt;
          return {
            ...old, ...next,
            board: {
              ...next.board,
              startedAt: old.board.startedAt,
              events: [...old.board.events, ...next.board.events.map((event: { at: number; index: number }) =>
                ({ ...event, at: event.at + offset }))]
            }
          };
        }
      }
      return { ...old, ...next };
    });
    previous.current = {
      code: room.code,
      handKey,
      phase: room.phase,
      boardCount: room.board.length
    };
    setNow(timestamp);
  }, [room?.code, handKey, room?.board.length, room?.runCount, room?.phase, audio]);
  useEffect(() => {
    const end = Math.max(flow.deal ? flow.deal.startedAt + flow.deal.duration : 0, flow.board ? flow.board.startedAt + (flow.board.events.at(-1)?.at || 0) + 450 : 0, flow.showdown ? flow.showdown.startedAt + flow.showdown.plan.payoutDuration + 100 : 0);
    if (end <= Date.now()) return;
    const id = setInterval(() => {
      const timestamp = Date.now();
      setNow(timestamp);
      if (timestamp >= end) clearInterval(id);
    }, 70);
    return () => clearInterval(id);
  }, [flow]);
  const turnOpportunity = bettingOpportunity(room);
  useLayoutEffect(() => {
    if (!room) {
      heard.current = null;
      return;
    }
    const last = heard.current;
    if (!silence.current && last?.code === room.code) {
      const actions = (room.actionEvents || []).filter((e: any) => e.type !== 'fold' && e.seq > last.seq && e.at > audibleAfter.current);
      actions.forEach((e: any, i: number) => audio?.play(e.type, i * 75));
      if (turnOpportunity && turnOpportunity !== last.turnOpportunity && !hasAutomaticAction) {
        const delay = actions.length ? (actions.length - 1) * 75 + 145 : 0;
        audio?.play('your-turn', delay);
        if (audio?.enabled && typeof navigator.vibrate === 'function') {
          clearTimeout(turnVibration.current);
          turnVibration.current = setTimeout(() => {
            if (!document.hidden && audio.enabled && heard.current?.turnOpportunity === turnOpportunity) navigator.vibrate(45);
          }, delay);
        }
      }
    }
    heard.current = {
      code: room.code,
      seq: room.actionSeq || 0,
      turnOpportunity
    };
  }, [room, turnOpportunity, audio, hasAutomaticAction]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        waitingForVisibleSnapshot.current = true;
        silence.current = true;
        audio?.cancel();
        clearTimeout(turnVibration.current);
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      clearTimeout(turnVibration.current);
      audio?.cancel();
    };
  }, [audio]);
  const deal = flow.handKey === handKey ? flow.deal : null,
    dealing = Boolean(deal && now < deal.startedAt + deal.duration),
    board = flow.handKey === handKey ? flow.board : null,
    board2 = flow.handKey === handKey ? flow.board2 : null,
    showdown = flow.showdown?.key === handKey ? flow.showdown : null;
  const stage = showdown ? presentationAt(showdown.plan, now - showdown.startedAt) : {
    phase: 'summary',
    run: null
  },
    payouts = room?.phase === 'showdown' && showdown ? payoutEvents(room, showdown.startedAt, showdown.plan) : [],
    settled = !showdown || now >= showdown.startedAt + showdown.plan.payoutDuration,
    resultReady = room?.phase === 'showdown' && ['award', 'summary'].includes(stage.phase);
  return {
    now,
    dealing,
    deal,
    board,
    board2,
    showdown,
    stage,
    settled,
    payouts,
    resultReady,
    activeRun: stage.run,
    activeAwardRun: stage.phase === 'award' ? stage.run : null,
    presentationBusy: dealing || Boolean(showdown && !settled) || Boolean(!showdown && board && now < board.startedAt + (board.events.at(-1)?.at || 0) + 380),
    playerStack: (p: any) => room?.phase === 'showdown' && showdown ? visibleStack(p, payouts, now) : p.stack,
    visibleHoleCards: (seat: number, count: number) => dealing ? deal.flights.filter((f: any) => f.seat === seat && now >= deal.startedAt + f.arrival).length : count,
    boardVisible: (index: number, run = 0) => {
      const target = run === 1 ? board2 : board,
        event = target?.events.find((e: any) => e.index === index);
      return !event || now >= target.startedAt + event.at;
    }
  };
}
