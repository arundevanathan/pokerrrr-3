'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, Smartphone, Download, History, Layers3, MoreHorizontal, Plus, X, Volume2, VolumeX, Trophy, Pause, Play, ChevronRight, CheckCircle2 } from 'lucide-react';
import { useAppViewport } from '../lib/client/use-app-viewport';
import { PokerAudio } from '../lib/poker-audio';
import { useTableEffects } from '../lib/use-table-effects';
import { seatPosition } from '../lib/table-presentation.mjs';
import { RunoutVote, RunoutAnnouncement } from './runout-vote';
import { TableMotion } from './table-motion';
import { TurnBeam } from './turn-beam';
import { TableAwards } from './table-awards';
import { ChatButton, ChatDrawer, SpeechBubbles } from './table-chat';
import { useSocial } from '../lib/client/use-social';
import { TableReactions } from './table-reactions';
import { useReactions } from '../lib/client/use-reactions';
import { reactionsEnabled } from '../lib/reactions.mjs';
import { newRoom, command, startHand, act, legal, view, resolveAlias, tick, shortcutRaiseTo } from '../lib/client/practice.mjs';
import { PokerClient, type Connection } from '../lib/client/poker-client';
import { GameHistory } from './game-history';
import { PlayerLobby, PinSettings } from './player-lobby';
import { installLocalLab } from '../lib/test-lab/local-bridge';
import { publicHandRecord, viewerHandRecord, handHistoryCsv, handHistoryJson } from '../lib/hand-history.mjs';
import { showTestTools } from '../lib/client/environment';
import { nextRaise, bettingOpportunity } from '../lib/client/raise-selection.mjs';
import { preactionValid, resolvePreaction, queuePreaction, waitingCall as queuedCallAmount } from '../lib/client/preaction.mjs';
type Room = any;
// Temporary identities for local practice; multiplayer identity comes from the server.
function playerId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = b[6] & 15 | 64;
  b[8] = b[8] & 63 | 128;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const fmt = (n: number) => new Intl.NumberFormat('en-IN').format(n || 0);
const gameName: Record<string, string> = {
  NLH: 'Texas Hold’em',
  PLO4: '4-card Omaha',
  PLO5: '5-card Omaha'
};
function Card({
  value,
  small = false,
  back = false,
  highlight = false,
  dim = false
}: {
  value?: number;
  small?: boolean;
  back?: boolean;
  highlight?: boolean;
  dim?: boolean;
}) {
  if (back) return <div className={`card back ${small ? 'small' : ''}`}>
    <span>♠</span>
  </div>;
  if (value === undefined) return <div className="card empty" />;
  const rank = '23456789TJQKA'[value % 13],
    suit = ['♣', '♦', '♥', '♠'][Math.floor(value / 13)];
  return <div className={`card ${small ? 'small' : ''} ${'♦♥'.includes(suit) ? 'red' : ''} ${highlight ? 'winning-card' : ''} ${dim ? 'dimmed-card' : ''}`} aria-label={`${rank === 'T' ? '10' : rank} ${['clubs', 'diamonds', 'hearts', 'spades'][Math.floor(value / 13)]}${highlight ? ', winning card' : ''}`}>
    <b>
      {rank === 'T' ? '10' : rank}
    </b>
    <span>
      {suit}
    </span>
  </div>;
}
const isStaging = process.env.NEXT_PUBLIC_APP_ENV === 'staging';
const enableReactions = reactionsEnabled(process.env.NEXT_PUBLIC_APP_ENV);
export default function Home({lab = false}: {lab?: boolean} = {}) {
  const [labTime, setLabTime] = useState(Date.now());
  const [labPlaying,setLabPlaying] = useState(false);
  const labRuntime = useRef<any>(null);
  const [room, setRoom] = useState<Room>(null),
    [name, setName] = useState(''),
    [rotation] = useState(3),
    [sb] = useState(25),
    [bb] = useState(50),
    [buyin] = useState(2500),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [panel, setPanel] = useState(''),
    [raise, setRaise] = useState(0),
    [rebuy, setRebuy] = useState(2500),
    [install, setInstall] = useState<any>(null),
    [clock, setClock] = useState(Date.now()),
    [confirm, setConfirm] = useState(''),
    [sound, setSound] = useState(true),
    [preaction, setPreaction] = useState<'check-fold' | 'check' | 'call' | null>(null),
    [selectedWinner, setSelectedWinner] = useState(''),
    [selectedShortcut, setSelectedShortcut] = useState(''),
    [selectedRun, setSelectedRun] = useState(0),
    [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const appViewport = useAppViewport(Boolean(room));
  const queuedAction = useRef<ReturnType<typeof queuePreaction> | null>(null);
  const lastTurnAlert = useRef('');
  const audio = useRef<PokerAudio | null>(null);
  if (!audio.current) audio.current = new PokerAudio();
  const socialAudio = useRef<PokerAudio | null>(null);
  if (!socialAudio.current) socialAudio.current = new PokerAudio();
  const effects = useTableEffects(room, audio.current, lab ? labTime : undefined),
    animationBusy = useRef(false);
  animationBusy.current = effects.presentationBusy;
  const [player, setPlayer] = useState<{
    id: string;
    name: string;
  } | null>(null),
    [players, setPlayers] = useState<any[]>([]),
    [lobby, setLobby] = useState<any>({
      activeGame: null
    }),
    [authLoading, setAuthLoading] = useState(true),
    [authEpoch, setAuthEpoch] = useState(0),
    [buildInfo, setBuildInfo] = useState<{ builtAt?: string; revision?: string; dirty?: boolean } | null>(null);
  const autoResume = useRef(true);
  const [connection, setConnection] = useState<Connection>('connecting');
  const transport = useRef<PokerClient | null>(null);
  const token = useRef(''),
    demo = useRef<Room>(null),
    current = useRef<Room>(null),
    pending = useRef(false),
    offset = useRef(0);
  const social = useSocial(room, Boolean(demo.current), connection, enableReactions);
  const reactions = useReactions(current, demo, enableReactions);
  // HTTP replies and socket pushes can race. Never replace a newer snapshot.
  function update(r: Room) {
    if (!lab && current.current?.code === r.code && current.current.version > r.version) return;
    const selection = nextRaise(current.current, r, raiseRef.current);
    if (current.current?.handStartedAt !== r.handStartedAt || current.current?.code !== r.code || current.current?.labReplayKey !== r.labReplayKey) {
      setSelectedWinner('');
      setSelectedRun(0);
    }
    current.current = r;
    offset.current = lab ? 0 : (r.serverTime || Date.now()) - Date.now();
    setRoom(r);
    if (r.legal) {
      setRaise(selection.amount);
      raiseRef.current = selection.amount;
    }
    if (selection.reset) setSelectedShortcut('');
  }
  useEffect(() => {
    if (!lab || !showTestTools) return;
    return installLocalLab({playing:setLabPlaying, demo, token, runtime: labRuntime, update, identity: (p: any) => {setPlayer(p);setAuthLoading(false);setConnection('connected');}, time: (n: number) => {setLabTime(n);setClock(n);} });
  }, [lab]);
  useEffect(() => {
    if(lab || !showTestTools || !location.pathname.startsWith('/test-lab/table') || !room)return;
    window.parent.postMessage({type:'lab-state',backend:'server',connection,label:room.phase,expected:{phase:room.phase,variant:room.game,version:room.version,runCount:room.runCount,
      winners:room.result?.map((p:any)=>({name:p.name,amount:p.wonAmount??p.amount})),chips:room.players.reduce((n:number,p:any)=>n+p.stack+p.cashout+(['showdown','closed'].includes(room.phase)?0:p.total),0),buyins:room.players.reduce((n:number,p:any)=>n+p.buyins,0)},transcript:room.handActionLog||[]},location.origin);
  }, [room, connection]);
  const raiseRef = useRef(raise);
  raiseRef.current = raise;
  const identityRetry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // An offline reload must retry identity restoration instead of stranding the login screen.
  async function refreshIdentity() {
    clearTimeout(identityRetry.current);
    let answered = false;
    try {
      const [list, session] = await Promise.all([PokerClient.auth('players'), PokerClient.auth('session')]);
      answered = true;
      setPlayers(list.players);
      setPlayer(session.player);
      if (session.player) {
        token.current = session.player.id;
        setName(session.player.name);
        transport.current = new PokerClient(session.player.id);
        if (transport.current.hasPending()) setNotice('Restoring your connection…');
        setError('');
      }
    } catch {
      setError('Reconnecting… Restoring your sign-in automatically.');
      identityRetry.current = setTimeout(() => void refreshIdentity(), 3000);
    } finally {
      setAuthLoading(!answered);
    }
  }
  function expired() {
    demo.current = null;
    transport.current = null;
    setPlayer(null);
    current.current = null;
    setRoom(null);
    setPanel('');
    setError('Please sign in again.');
  }
  async function login(id: string, pin: string) {
    setBusy(true);
    setError('');
    try {
      const result = await PokerClient.auth('login', {
        playerId: id,
        pin
      });
      autoResume.current = false;
      setPlayer(result.player);
      token.current = result.player.id;
      setName(result.player.name);
      transport.current = new PokerClient(result.player.id);
      setLobby(await PokerClient.auth('lobby'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await PokerClient.auth('logout', {});
      demo.current = null;
      expired();
      setError('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function changePin(currentPin: string, newPin: string) {
    setBusy(true);
    setError('');
    try {
      await PokerClient.auth('pin', {
        currentPin,
        newPin
      });
      setAuthEpoch(n => n + 1);
      setPanel('');
      setNotice('PIN updated.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function api(input?: any, roomCode?: string) {
    if (!transport.current) throw new Error('Player identity is loading');
    return input ? transport.current.send(input, current.current || undefined) : transport.current.snapshot(roomCode || current.current?.code || '');
  }
  useEffect(() => {
    const unlockSocial = () => socialAudio.current?.unlock();
    document.addEventListener('pointerdown', unlockSocial);
    document.addEventListener('keydown', unlockSocial);
    const enabled = !lab && localStorage.getItem('hg-sound') !== 'off';
    setSound(enabled);
    audio.current?.setEnabled(enabled);
    socialAudio.current?.setEnabled(enabled);
    if (!lab) { token.current = playerId(); void refreshIdentity(); }
    if (!lab && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { });
    const installer = (e: any) => {
      e.preventDefault();
      setInstall(e);
    };
    window.addEventListener('beforeinstallprompt', installer);
    const timer = setInterval(() => {if (!lab) setClock(Date.now());}, 500);
    return () => {
      clearInterval(timer);
      clearTimeout(identityRetry.current);
      document.removeEventListener('pointerdown', unlockSocial);
      document.removeEventListener('keydown', unlockSocial);
      window.removeEventListener('beforeinstallprompt', installer);
    };
  }, []);
  useEffect(() => {
    let active = true;
    fetch('/build-info.json', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(info => {
      if (active) setBuildInfo(info as { builtAt?: string; revision?: string; dirty?: boolean } | null);
    }).catch(() => {
      if (active) setBuildInfo(null);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (lab || !player || !transport.current) return;
    return transport.current.connect(state => {
      setLobby(state.lobby);
      const r = state.room;
      if (r && !demo.current && (current.current && current.current.code === r.code || !current.current && autoResume.current && state.lobby.activeGame?.joined && state.lobby.activeGame?.code === r.code)) update(r);
    }, setConnection, expired, (event, serverTime) => {
      if (!demo.current) reactions.receive(event, serverTime);
    }, entry => { if (!demo.current) social.receive(entry); }, message => { setError(''); setNotice(message); });
  }, [player?.id, authEpoch]);
  useEffect(() => {
    const id = setInterval(() => {
      if (lab) return;
      const r = demo.current;
      if (r?.phase === 'runout_vote') {
        for (const voter of r.runVote.voters) {
          if (voter.id !== token.current && voter.choice === null && Date.now() >= r.runVote.opensAt && Date.now() < r.runVote.deadline) command(r, voter.id, {
            type: 'runout_vote',
            choice: r.runVote.canTwice ? 2 : 1
          });
        }
        update(view(r, token.current));
        return;
      }
      if (!r || !r.turn || r.turn === token.current || pending.current || animationBusy.current) return;
      const l = legal(r, r.turn);
      if (!l) return;
      try {
        const roll = Math.random();
        if (l.canRaise && roll < .16) act(r, r.turn, 'raise', Math.min(l.min, l.max));
  else if (l.call && roll < .2) act(r, r.turn, 'fold');
  else act(r, r.turn, l.call ? 'call' : 'check');
        update(view(r, token.current));
      } catch (e: any) {
        setError(e.message);
      }
    }, 850);
    return () => clearInterval(id);
  }, []);
  useLayoutEffect(() => {
    if (!room) return;
    const html = document.documentElement,
      body = document.body,
      oldHtml = html.style.overflow,
      oldBody = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = oldHtml;
      body.style.overflow = oldBody;
    };
  }, [Boolean(room)]);
  useEffect(() => {
    const id = setInterval(() => {
      const r = demo.current;
      if (lab || !r || pending.current) return;
      try {
        if (tick(r)) update(view(r, token.current));
      } catch (e: any) {
        setError(e.message);
      }
    }, 200);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(''), 3500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  function toggleSound() {
    const enabled = !sound;
    setSound(enabled);
    audio.current?.setEnabled(enabled);
    socialAudio.current?.setEnabled(enabled);
    localStorage.setItem('hg-sound', enabled ? 'on' : 'off');
    localStorage.removeItem('hg-social-sound');
    if (enabled) {
      audio.current?.unlock();
      socialAudio.current?.unlock();
      audio.current?.play('deal', 100);
    }
  }
  // Block duplicate taps and wait for a fresh connection before submitting actions.
  async function send(type: string, extra: any = {}) {
    if (pending.current) return false;
    if (!demo.current && connection !== 'connected') {
      setError('Reconnecting to the table. Wait for a fresh view.');
      return false;
    }
    // A direct action supersedes any armed intention, even if its reply is lost.
    if (['fold', 'check', 'call', 'raise'].includes(type)) { queuedAction.current = null; setPreaction(null); }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (demo.current) {
        if (lab && type==='deal') startHand(demo.current, labRuntime.current.now, labRuntime.current.newDeck(demo.current));
        else command(demo.current, token.current, {
          type,
          ...extra,
          player: extra.player ? resolveAlias(demo.current, extra.player) : undefined
        }, lab ? labRuntime.current.now : Date.now());
        update(view(demo.current, token.current, lab ? labRuntime.current.now : Date.now()));
        if(lab) {labRuntime.current?.record(type,extra);labRuntime.current?.report();}
      } else {
        const r = await api({
          type,
          code: current.current?.code,
          version: current.current?.version,
          ...extra
        });
        update(r);
      }
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
      pending.current = false;
    }
  }
  async function downloadHandHistory(format: 'csv' | 'json') {
    const code = current.current?.code;
    if (!code) return;
    setError('');
    try {
      if (demo.current) {
        const records = demo.current.history.map((h: any) => viewerHandRecord(publicHandRecord(code, h), h.privateCards?.find((p: any) => p.id === token.current)));
        const url = URL.createObjectURL(new Blob([format === 'csv' ? handHistoryCsv(records) : handHistoryJson(records)], {type: format === 'csv' ? 'text/csv' : 'application/json'}));
        const a = document.createElement('a'); a.href=url;a.download=`simulation-${code}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
      }
      const response = await fetch(`/api/hand-history?${new URLSearchParams({ code, format })}`, { cache: 'no-store' });
      if (!response.ok) {
        const body: any = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not prepare hand history');
      }
      const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `dunzo-club-hand-history-${code}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || 'Could not prepare hand history');
    }
  }
  async function openTable(settings: any) {
    if (showTestTools && settings.simulate) { location.href = '/test-lab?config=' + encodeURIComponent(JSON.stringify({...settings, scenario: 'simulation', game: settings.games[0], players: settings.opponents+1})); return; }
    if (!player) return;
    setBusy(true);
    setError('');
    try {
      const active = lobby.activeGame;
      const r = active ? await api(undefined, active.code) : await api({
        type: 'create',
        ...settings,
        seats: 8,
        takeSeat: false
      });
      autoResume.current = true;
      update(r);
      const returning = r.players.find((p: any) => p.id === r.me && !p.left);
      if (enableReactions && returning?.away && !returning.pendingSeatAction && r.phase !== 'closed') {
        const back = await api({ type: 'set_away', code: r.code, away: false });
        update(back);
      }
    } catch (e: any) {
      setError(e.message);
      try {
        setLobby(await PokerClient.auth('lobby'));
      } catch { }
    } finally {
      setBusy(false);
    }
  }
  async function retryLastAction() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const r = await transport.current?.retryPending();
      if (r) {
        update(r);
      }
      setError('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function exit() {
    if (showTestTools && location.pathname.startsWith('/test-lab/table')) {if(lab)labRuntime.current?.exit();else window.parent.postMessage({type:'lab-exit'},location.origin);return;}
    const r = current.current;
    const leaving = r?.players.find((p: any) => p.id === r.me && !p.left);
    if (enableReactions && leaving && !leaving.away && !leaving.pendingSeatAction && r.phase !== 'closed') {
      if (!await send('set_away', { away: true })) return;
    }
    social.setOpen(false);
    social.setHistoryOpen(false);
    demo.current = null;
    current.current = null;
    setRoom(null);
    setPanel('');
    setError('');
    autoResume.current = false;
  }
  async function installApp() {
    if (install) {
      await install.prompt();
      setInstall(null);
    } else setPanel('install');
  }
  const controlsBusy = busy || !demo.current && connection !== 'connected';
  const me = room?.players.find((p: any) => p.id === room.me),
    live = room && ['preflop', 'flop', 'turn', 'river'].includes(room.phase),
    myTurn = room?.turn === room?.me,
    l = room?.legal,
    seconds = room?.deadline ? Math.max(0, Math.ceil((room.deadline - clock - offset.current) / 1000)) : 0;
  function selectPreaction(choice: 'check-fold' | 'check' | 'call') {
    const next = preaction === choice ? null : choice;
    queuedAction.current = next ? queuePreaction(next, room) : null;
    setPreaction(next);
    audio.current?.unlock();
  }
  useEffect(() => {
    const queued = queuedAction.current;
    if (queued && (!preactionValid(queued, room) || !demo.current && connection !== 'connected')) {
      queuedAction.current = null;
      setPreaction(null);
      return;
    }
    if (!myTurn || !live || !l || effects.presentationBusy || controlsBusy) return;
    const alertKey = bettingOpportunity(room) || '';
    if (lastTurnAlert.current !== alertKey) {
      lastTurnAlert.current = alertKey;
    }
    if (!queued) return;
    // Consume before sending: rerenders and reconnects must never send it twice.
    queuedAction.current = null;
    setPreaction(null);
    const action = resolvePreaction(queued, l.call);
    if (action) void send(action);
  }, [room, myTurn, live, controlsBusy, connection, effects.presentationBusy]);
  const voting = room?.phase === 'runout_vote',
    handActive = live || voting;
  useEffect(() => {
    if (lab || !voting) return;
    const id = setInterval(() => setClock(Date.now()), 100);
    return () => clearInterval(id);
  }, [voting]);
  const stackLabel = (p: any) => effects.playerStack(p) > 0 ? fmt(effects.playerStack(p)) : room?.phase === 'closed' ? 'Cashed out' : (handActive || room?.phase === 'showdown' && !effects.settled) && p.inHand && !p.folded ? 'All-in' : p.buyins === 0 ? 'Buy-in pending' : 'Busted';
  const openReload = () => {
    if (room?.phase === 'closed' || room?.terminationPending || me?.pendingSeatAction === 'leave') return;
    setRebuy(Math.max(room.settings.bb, Math.min(room.settings.buyin, room.settings.maxBuyin)));
    setPanel('buyin');
  };
  const seated = Boolean(me && !me.left);
  function chooseSeat(seat: number) {
    setSelectedSeat(seat);
    setRebuy(room.settings.buyin);
    setError('');
    setPanel('seat');
  }
  const visiblePlayers = room?.players.filter((p: any) => !p.left) || [],
    gameIndex = room?.rotationIndex || 0;
  const displayedRun = effects.activeRun || selectedRun || room?.runCount || 1;
  const awardRun = effects.activeAwardRun,
    runPayments = effects.payouts.filter((p: { run: number }) => p.run === (awardRun || displayedRun)),
    currentPayment = runPayments.filter((p: { at: number }) => p.at <= effects.now).at(-1) || runPayments[0],
    currentPot = runPayments.filter((p: { label: string }) => p.label === currentPayment?.label),
    allWinners = room?.phase === 'showdown' ? (room.result || []).filter((w: any) => (w.wonAmount ?? w.amount) > 0) : [],
    winners = awardRun ? allWinners.flatMap((w: any) => {
      const h = w.runHands?.find((h: any) => h.run === awardRun),
        payment = currentPot.find((p: { id: string }) => p.id === w.id);
      return payment?.wonAmount > 0 ? [{
        ...w,
        ...h,
        wonAmount: payment.wonAmount,
        runHands: h ? [h] : [],
        pots: w.pots?.filter((p: any) => p.run === awardRun && p.label === payment.label)
      }] : [];
    }) : allWinners,
    focusCandidates = awardRun ? winners : winners.filter((w: any) => w.runHands?.some((h: { run: number }) => h.run === displayedRun) || !w.runHands?.length && displayedRun === 1),
    focusedWinner = focusCandidates.find((w: any) => w.id === (awardRun ? currentPayment?.id : selectedWinner)) || focusCandidates[0],
    focusedHand = focusedWinner?.runHands?.find((h: any) => h.run === (awardRun || displayedRun)) || focusedWinner?.runHands?.[0] || focusedWinner,
    focusedRunNumber = focusedHand?.run || 1;
  const raiseMin = l ? Math.min(l.min, l.max) : 0,
    raiseMax = l?.max || 0,
    raiseValid = Boolean(l && Number.isSafeInteger(raise) && raise >= raiseMin && raise <= raiseMax),
    raiseValue = Math.min(raiseMax, Math.max(raiseMin, raise || raiseMin));
  const readyPlayers = visiblePlayers.filter((p: any) => p.stack > 0 && !p.away).length;
  const turnFraction = Math.max(0, Math.min(1, (room?.deadline - clock - offset.current) / ((room?.settings.timer || 15) * 1000)));
  const nextHandFraction = Math.max(0, Math.min(1, (room?.nextDealAt - clock - offset.current) / 3000));
  const waitingCall = queuedCallAmount(room);
  const displayedCall = myTurn ? (l?.call || 0) : waitingCall;
  const canQueueAction = Boolean(live && !myTurn && me?.inHand && !me.folded && !me.away && me.stack > 0);
  const clampRaise = (v: number) => Math.min(raiseMax, Math.max(raiseMin, Math.round(v || raiseMin)));
  const buildDisclosure = buildInfo?.builtAt ? `Updated ${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(buildInfo.builtAt))} · ${buildInfo.revision}${buildInfo.dirty ? ' + local changes' : ''}` : 'Build information unavailable';
  return <div ref={appViewport} className={`app ${lab && !labPlaying ? 'lab-clock-paused' : ''} ${room ? 'in-game' : ''} ${social.open ? 'composing-chat' : ''}`} onPointerDownCapture={() => audio.current?.unlock()} onKeyDownCapture={() => audio.current?.unlock()}>

    <header className="topbar">
      <button className="brand" onClick={() => {if(showTestTools && location.pathname.startsWith('/test-lab/table'))window.parent.postMessage({type:'lab-controls'},location.origin);else if(room)void exit();}} aria-label="Dunzo Club">
        <span className="brand-icon">♠</span>
        <span>Dunzo Club<span className="brand-dot">.</span>{isStaging && <small className="staging-badge">STAGING</small>}</span>
      </button>
      <div className="top-right">
        <button className="icon-button sound-toggle" onClick={toggleSound} aria-label={sound ? 'Mute all sounds' : 'Enable all sounds'} aria-pressed={sound} title={sound ? 'Sound on' : 'Sound off'}>
          {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        {player && <button className="text-button" onClick={() => {
          setError('');
          setPanel('account');
        }}>
          {player.name}
        </button>}
        {room ? <>
          <span className="connection">
            <i />
            {demo.current ? (lab ? 'Test simulation' : 'Simulation') : connection === 'connected' ? 'Live table' : connection === 'offline' ? 'Offline' : 'Reconnecting…'}
          </span>
          <button className="icon-button" onClick={() => setPanel('menu')} aria-label="Table menu">
            <MoreHorizontal size={22} />
          </button>
        </> : <>
          <button className="install-top" onClick={installApp}>
            <Download size={15} />
            <span>Install app</span>
          </button>
        </>}
      </div>
    </header>

    {!room ? <main className="lobby simple-lobby">

      <PlayerLobby player={player} players={players} activeGame={lobby.activeGame} loading={authLoading} busy={busy} error={error} onLogin={login} onOpen={openTable} onPractice={showTestTools ? () => {location.href='/test-lab';} : undefined} onRetry={retryLastAction} hasPending={transport.current?.hasPending() || false} />

      {player && <GameHistory key={player.id} refreshKey={lobby.activeGame?.code || ''} />}



    </main> : <main className="game-layout" aria-label="Poker table">

      <div className="game-main">
        <section className="play-area">
          <div className="rotation-bar">
            <strong>{room.game || room.settings.games?.[0] || 'NLH'}</strong>
            <span className="table-stakes">{fmt(room.settings.sb)}/{fmt(room.settings.bb)}</span>
            <span>Hand {room.phase === 'lobby' ? 0 : room.completed + (['showdown', 'closed'].includes(room.phase) ? 0 : 1)}</span>
            <span className={`typing-turn-status ${myTurn && live ? 'is-your-turn' : ''}`} role="status">
              {myTurn && live ? `Your turn · ${seconds}s` : live ? `${room.players.find((p: { id: string; name: string }) => p.id === room.turn)?.name || 'Player'}’s turn` : voting ? 'Runout vote' : room.phase === 'showdown' ? 'Showdown' : room.game}
            </span>
            {(room.settings.games?.length || 0) > 1 && room.phase !== 'closed' && <small className="next-variant">
              {room.settings.games[(gameIndex + 1) % room.settings.games.length]} {room.settings.rotation === room.handsIntoRotation ? 'next hand' : `in ${room.settings.rotation - room.handsIntoRotation} ${room.settings.rotation - room.handsIntoRotation === 1 ? 'hand' : 'hands'}`}
            </small>}
            <small className="build-disclosure" title={buildDisclosure}>{buildDisclosure}</small>
          </div>

          <div className={`table-stage ${room.runCount === 2 ? 'two-runouts' : ''} ${room.runVote ? 'has-run-vote' : ''}`}>
            <TurnBeam target={live && !effects.presentationBusy ? room.turn : null} />
            <div className="felt">
              <div className="felt-inner" />

              <div className="board-zone">
                {room.phase === 'lobby' ? <div className="waiting">
                  <span>♠</span>
                  <h3>Waiting for players</h3>
                  <p>Two seated players with chips are required.</p>
                </div> : room.phase === 'closed' ? <div className="waiting">
                  <span>♠</span>
                  <h3>Game Ended</h3>
                  <button className="secondary" onClick={() => setPanel('ledger')}>Current Game Rankings</button>
                </div> : <>
                  <div className="pot-label">
                    {awardRun && currentPayment ? `${room.runCount === 2 ? `RUN ${awardRun} · ` : ''}${currentPayment.label}` : room.phase === 'showdown' ? 'LAST POT' : 'POT'}
                  </div>
                  <div className="pot-amount">
                    {fmt(awardRun && currentPayment ? currentPot.reduce((sum: number, p: { wonAmount: number; amount: number }) => sum + (p.wonAmount || p.amount), 0) : room.phase === 'showdown' ? room.lastPot : room.players.reduce((s: number, p: any) => s + (p.inHand ? p.total : 0), 0))}
                  </div>
                  <div className="runout-boards">
                    {(room.runCount === 2 ? room.runBoards : [room.board]).map((board: number[], runIndex: number) => <div className={`runout-board ${effects.activeRun === runIndex + 1 ? 'active-run' : ''}`} key={runIndex}>
                      {room.runCount === 2 && <span className="run-board-label">RUN {runIndex + 1}</span>}
                      <div className="board-cards">
                        {Array.from({
                          length: 5
                        }, (_, i) => {
                          const shown = effects.boardVisible(i, runIndex),
                            value = shown ? board[i] : undefined,
                            winningBoard = effects.resultReady && runIndex + 1 === focusedRunNumber ? focusedHand?.boardCards || [] : [],
                            timeline = runIndex === 1 ? effects.board2 : effects.board,
                            animationEvent=timeline?.events.find((e:any)=>e.index===i);
                          return <div style={lab && animationEvent ? {animationPlayState:'paused',animationDelay:`${timeline.startedAt + animationEvent.at - labTime}ms`} : undefined} key={`${room.handStartedAt || 0}:${runIndex}:${i}:${shown}`} className={value !== undefined && timeline?.events.some((e: any) => e.index === i) ? 'board-card-wrap board-dealt' : 'board-card-wrap'}>
                            <Card value={value} highlight={value !== undefined && winningBoard.includes(value)} dim={effects.resultReady && winningBoard.length > 0 && value !== undefined && !winningBoard.includes(value)} />
                          </div>;
                        })}
                      </div>
                    </div>)}
                    {room.phase === 'showdown' && <div className="board-results">
                      {room.runCount === 2 && effects.settled && <div className="board-result-runs" aria-label="Run results">
                        {[1, 2].map(run => <button key={run} aria-pressed={displayedRun === run} onClick={() => { setSelectedWinner(''); setSelectedRun(run); }}>Run {run}</button>)}
                      </div>}
                      <TableAwards key={displayedRun} room={room} effects={effects} run={displayedRun} onFocus={(id, run) => {
                        setSelectedWinner(id); setSelectedRun(run);
                      }} />
                    </div>}
                  </div>
                </>}
              </div>
            </div>

            {Array.from({
              length: room.settings.seats
            }, (_, s) => {
              const p = visiblePlayers.find((p: any) => p.seat === s),
                {
                  x,
                  y
                } = seatPosition(s, me?.seat || 0, room.settings.seats),
                win = effects.resultReady ? winners.find((w: any) => w.id === p?.id) : null,
                cardCount = room.game === 'NLH' ? 2 : room.game === 'PLO4' ? 4 : 5,
                visibleCount = effects.visibleHoleCards(s, cardCount);
              return <div key={s} data-bet-direction={y >= 70 ? 'above' : y <= 28 ? 'below' : x < 50 ? 'right' : 'left'} data-seat-index={s} data-relative-seat={(s - (me?.seat || 0) + room.settings.seats) % room.settings.seats} className={`seat ${p ? 'occupied' : 'open'} ${live && !effects.presentationBusy && p?.id === room.turn ? 'acting' : ''} ${p?.folded && handActive ? 'folded' : ''} ${p?.id === room.me ? 'your-seat' : ''} ${p?.id !== room.me && p?.cards?.length ? 'cards-revealed' : 'cards-concealed'} ${cardCount > 2 ? 'omaha-seat' : ''} ${win ? 'winner-seat' : ''}`} data-card-count={cardCount} style={{
                left: `clamp(var(--seat-edge-x), ${x}%, calc(100% - var(--seat-edge-x)))`,
                top: `clamp(var(--seat-edge-y), ${y}%, calc(100% - var(--seat-edge-y)))`
              }}>
                {p ? <>
                  {win && <div className="winner-badge"><Trophy size={10} /> +{fmt(win.wonAmount ?? win.amount)}</div>}
                  <div className="seat-top" data-reaction-target={p.id !== room.me && enableReactions && room.phase !== 'closed' ? s : undefined} onClick={() => {
                    if (p.id !== room.me && enableReactions && room.phase !== 'closed') reactions.setTarget(reactions.target === s ? null : s);
                  }}>
                    {p.id !== room.me && p.inHand && p.cards?.length ? <div className="hole-cards">
                      {p.cards.slice(0, visibleCount).map((c: number, i: number) => <span className={effects.dealing ? 'arriving-hole-card' : ''} style={{ '--fan-angle': `${(i - (cardCount - 1) / 2) * 9}deg`, '--fan-lift': `${Math.abs(i - (cardCount - 1) / 2) * 3}px` } as React.CSSProperties} key={`${room.handStartedAt || 0}:${i}`}>
                        <Card value={c} small highlight={Boolean(effects.resultReady && focusedWinner?.id === p.id && focusedHand?.holeCards?.includes(c))} dim={Boolean(effects.resultReady && focusedWinner?.id === p.id && focusedHand?.boardCards?.length && !focusedHand.holeCards.includes(c))} />
                      </span>)}
                    </div> : p.inHand && (handActive || p.id === room.me && room.phase === 'showdown') ? <div className="hole-cards">
                      {Array.from({
                        length: visibleCount
                      }, (_, i) => <span className={effects.dealing ? 'arriving-hole-card' : ''} style={{ '--fan-angle': `${(i - (cardCount - 1) / 2) * 9}deg`, '--fan-lift': `${Math.abs(i - (cardCount - 1) / 2) * 3}px` } as React.CSSProperties} key={`${room.handStartedAt || 0}:${i}`}>
                        <Card small back />
                      </span>)}
                    </div> : <div className="avatar">
                      {p.name.slice(0, 2).toUpperCase()}
                    </div>}
                  </div>
                  <div className="seat-info"
                    data-reaction-target={enableReactions && p.id !== room.me && room.phase !== 'closed' ? s : undefined}
                    role={room.phase !== 'closed' && (p.id === room.me || enableReactions) ? 'button' : undefined}
                    tabIndex={room.phase !== 'closed' && (p.id === room.me || enableReactions) ? 0 : undefined}
                    aria-label={room.phase !== 'closed' ? p.id === room.me ? `${p.name}, ${stackLabel(p)}, reload chips` : enableReactions ? `Send reaction to ${p.name}` : undefined : undefined}
                    aria-expanded={enableReactions && p.id !== room.me ? reactions.target === s : undefined}
                    title={p.id === room.me ? 'Load chips' : undefined}
                    onClick={() => {
                      if (room.phase === 'closed') return;
                      if (p.id === room.me) openReload();
                      else if (enableReactions) reactions.setTarget(reactions.target === s ? null : s);
                    }}
                    onKeyDown={e => {
                      if ((e.key === 'Enter' || e.key === ' ') && room.phase !== 'closed') {
                        e.preventDefault();
                        if (p.id === room.me) openReload();
                        else if (enableReactions) reactions.setTarget(reactions.target === s ? null : s);
                      }
                    }}>

                    {live && !effects.dealing && p.id === room.turn && room.deadline && <svg className={`seat-timer ${seconds <= 5 ? 'urgent' : ''}`} viewBox="0 0 100 100" preserveAspectRatio="none" role="timer" aria-label={`${p.name}: ${seconds} seconds remaining`}>
                      <rect x="2" y="2" width="96" height="96" rx="10" pathLength="100" strokeDasharray={`${turnFraction * 100} 100`} />
                    </svg>}
                    <span>
                      {p.name}
                    </span>
                    {p.id === room.me && room.phase !== 'closed' && <span className="reload-hint" aria-hidden="true">+</span>}
                    <strong className={stackLabel(p) === 'Busted' ? 'busted-label' : ''}>
                      {stackLabel(p)}
                    </strong>
                    {p.seat === room.dealer && <b className="dealer-chip">D</b>}
                    {handActive && p.bet > 0 && p.action !== 'Check' && <div className="seat-bet">● {fmt(p.bet)}</div>}
                  </div>
                  {p.disconnected && !demo.current ? <span className="seat-state disconnected" role="status">Disconnected</span> : p.away && <span className="seat-state">Sit out</span>}
                  {p.inHand && !p.away && !p.disconnected && p.action === 'Check' && !effects.dealing && room.phase !== 'closed' && <span className="player-action">Check</span>}
                </> : <button className="seat-choice" aria-label={`Choose seat ${s + 1}`} disabled={controlsBusy || seated || room.phase === 'closed' || room.terminationPending} onClick={() => chooseSeat(s)}>
                  <span className="empty-seat">
                    <Plus size={15} />
                  </span>
                </button>}
              </div>;
            })}

            <TableMotion room={room} mySeat={me?.seat || 0} effects={effects} />
            {enableReactions && <TableReactions room={room} mySeat={me?.seat || 0} reactions={{ ...reactions, send: async reaction => {
              const target = room.players.find((p: any) => !p.left && p.seat === reactions.target);
              const sent = await reactions.send(reaction);
              if (sent && demo.current && target) social.practiceEntry({ kind: 'reaction', reaction, to: { name: target.name, seat: target.seat } });
              return sent;
            } }} audio={socialAudio.current} />}

            {enableReactions && <SpeechBubbles room={room} social={social} />}
            <RunoutVote room={room} now={clock + offset.current} busy={busy} send={send} />
            <RunoutAnnouncement room={room} effects={effects} />



          </div>

          <div onPointerDownCapture={e => {
            // Keep the composer focused so the first betting tap cannot move the
            // button by dismissing the keyboard before its click is delivered.
            if (social.open && (e.target as HTMLElement).closest('.betting-controls button, .pause-deal')) e.preventDefault();
          }} className="action-zone">
            <div className="hand-toolbar">
              <span className={`turn-status ${myTurn && live && !effects.presentationBusy ? 'is-your-turn' : ''}`} role="status">
                {myTurn && live && !effects.presentationBusy ? `Your turn · ${seconds}s` : live ? `${room.players.find((p: { id: string; name: string }) => p.id === room.turn)?.name || 'Player'}’s turn` : room.game}
              </span>
              {room.terminationPending && <span className="termination-status" role="status">Ends after this hand</span>}
              <div className="hand-toolbar-actions"><button className="text-button" onClick={() => setPanel('ledger')}>Rankings</button>
                {enableReactions && !social.open && <ChatButton social={social} readOnly={room.phase === 'closed'} />}
              </div>
            </div>
            {seated && <div className="personal-hand" aria-label="Your cards">
              <span className="typing-hole-label" aria-hidden="true">Your cards</span>
              <div className="personal-hole-cards" aria-label="Your cards">
                {me?.inHand && me.cards?.length ? me.cards.map((c: number, i: number) => <Card key={`${room.handStartedAt || 0}:${i}`} value={c} small highlight={Boolean(effects.resultReady && focusedWinner?.id === room.me && focusedHand?.holeCards?.includes(c))} dim={Boolean(effects.resultReady && focusedWinner?.id === room.me && focusedHand?.boardCards?.length && !focusedHand.holeCards.includes(c))} />) : <span className="personal-cards-placeholder">{room.game || 'NLH'} · Your cards</span>}
              </div>
            </div>}
            {me?.pendingSeatAction === 'leave' && <p className="game-status" role="status">Standing up after this hand and payouts. <button className="text-button" disabled={controlsBusy || room.terminationPending} onClick={() => send('cancel_stand_up')}>Cancel</button></p>}
            {!seated && room.phase !== 'closed' ? <>
              <p className="game-status">
                {room.terminationPending ? 'Game termination pending.' : 'Select an empty seat, then load chips.'}
              </p>
              {error && <p className="error" role="alert">
                {error}
              </p>}
              {room.host && room.phase === 'lobby' && <button className="primary" disabled={controlsBusy || readyPlayers < 2} onClick={() => send('deal')}>Deal Hand</button>}
            </> : <>
              {room.requests.some((q: any) => q.id === room.me) && <button className="pending-buyins" onClick={openReload}><Plus size={14} /> Your reload will be added automatically after this hand.</button>}
              {error && <div className="error" role="alert">
                {error}
                {transport.current?.hasPending() && <button type="button" onClick={retryLastAction}>Retry last action</button>}
              </div>}
              {voting ? null : live ? <>
                <div className="betting-controls">
                  <div className="slider-shortcuts">
                    <div className="raise-slider-control">
                      <input type="range" aria-label="Raise amount slider" min={0} max={1000} step={1} value={raiseMax > raiseMin ? Math.round(Math.sqrt((raiseValue - raiseMin) / (raiseMax - raiseMin)) * 1000) : 0} disabled={!myTurn || controlsBusy || effects.presentationBusy || !l?.canRaise || raiseMin === raiseMax} onChange={e => {
                        setSelectedShortcut('');
                        const fraction = Number(e.target.value) / 1000;
                        const raw = raiseMin + (raiseMax - raiseMin) * fraction * fraction;
                        const blind = Math.max(1, Number(room.settings?.bb || 50));
                        const snapped = Math.round(raw / blind) * blind;
                        setRaise(Number(e.target.value) === 1000 ? raiseMax : clampRaise(snapped));
                      }} style={{ '--range-fill': `${raiseMax > raiseMin ? Math.sqrt((raiseValue - raiseMin) / (raiseMax - raiseMin)) * 100 : 0}%` } as React.CSSProperties} />
                    </div>
                    <div className="quick-bets" aria-label="Raise shortcuts">
                      {([['½', .5], ['Pot', 1]] as const).map(([label, n]) => <button className="bet-shortcut" key={label} title={label === '½' ? 'Half pot' : 'Pot'} disabled={!myTurn || controlsBusy || !l?.canRaise || effects.presentationBusy} aria-pressed={selectedShortcut === label} onClick={() => {
                        setSelectedShortcut(label); setRaise(shortcutRaiseTo(current.current, token.current, n));
                      }}>{label}</button>)}
                      <button className="bet-shortcut" title="All-in" disabled={!myTurn || controlsBusy || !l?.canRaise || effects.presentationBusy} aria-pressed={selectedShortcut === 'All'} onClick={() => { setSelectedShortcut('All'); setRaise(l.max); }}>All</button>
                    </div>
                  </div>
                  <div className="action-buttons">
                    <button className={`fold ${!myTurn ? 'preaction-button' : ''}`} role={!myTurn ? 'checkbox' : undefined} aria-checked={!myTurn ? preaction === 'check-fold' : undefined} disabled={controlsBusy || effects.presentationBusy || (!myTurn && !canQueueAction)} onClick={() => myTurn ? send('fold') : selectPreaction('check-fold')}>
                      {!myTurn && <span className="preaction-checkbox" aria-hidden="true">{preaction === 'check-fold' ? '✓' : ''}</span>}
                      <span>{!myTurn ? 'Check / Fold' : 'Fold'}</span>
                    </button>
                    <button className={`secondary check-call ${!myTurn ? 'preaction-button' : ''}`} role={!myTurn ? 'checkbox' : undefined} aria-checked={!myTurn ? preaction === (displayedCall ? 'call' : 'check') : undefined} disabled={controlsBusy || effects.presentationBusy || (!myTurn && !canQueueAction)} onClick={() => myTurn ? send(l?.call ? 'call' : 'check') : selectPreaction(displayedCall ? 'call' : 'check')}>
                      {!myTurn && <span className="preaction-checkbox" aria-hidden="true">{preaction === (displayedCall ? 'call' : 'check') ? '✓' : ''}</span>}
                      <span>{displayedCall ? `Call ${fmt(displayedCall)}` : 'Check'}</span>
                    </button>
                    <button className="primary" disabled={!myTurn || controlsBusy || effects.presentationBusy || !l?.canRaise || !raiseValid} onClick={() => {
                      if (social.open) {
                        // The typing-view button opens amount selection only.
                        // A second explicit tap on the normal Raise button bets.
                        (document.getElementById('chat-message') as HTMLInputElement | null)?.blur();
                        social.setOpen(false);
                        return;
                      }
                      void send('raise', { amount: raise });
                    }}>
                      <span className="raise-button-label">{social.open ? 'Raise…' : 'Raise'}</span>
                      {!social.open && <span className="raise-button-amount">{myTurn && l?.canRaise ? fmt(raise) : '—'}</span>}
                    </button>
                  </div>
                </div>
              </> : <div className="between-hands">
                {room.paused && <span className="paused-state">Auto-deal paused</span>}
                {room.phase === 'showdown' && seated && <div className="post-hand-actions">
                  {me?.inHand && <button className="secondary" disabled={controlsBusy || room.history?.[0]?.reveals?.some((p: any) => p.seat === me.seat)} onClick={() => void send('voluntary_reveal')}>Reveal my cards</button>}
                  {room.history?.[0]?.board?.length < 5 && <button className="secondary" disabled={controlsBusy || Boolean(room.history?.[0]?.rabbitHunt)} onClick={() => void send('rabbit_hunt')}>Rabbit Hunt</button>}
                </div>}
                {room.phase === 'closed' ? <div className="game-ended-actions"><span role="status">Game ended · Chips cashed out</span><button className="primary" onClick={() => setPanel('ledger')}>Current Game Rankings <ArrowUpRight size={16} /></button><button className="text-button" onClick={exit}>Return to Lobby</button></div> : room.phase === 'showdown' ? <div className="auto-deal-status" role="status">
                  {room.nextDealAt && <div className="next-hand-timer" role="timer" aria-label="Next hand countdown"><i style={{transform: `scaleX(${nextHandFraction})`}} /></div>}
                  {room.host && <button className="secondary pause-deal" disabled={controlsBusy} onClick={() => send('pause')} aria-label={room.paused ? 'Resume auto-deal' : 'Pause auto-deal'}>
                    {room.paused ? <Play size={16} /> : <Pause size={16} />}
                  </button>}
                </div> : room.host ? <button className="primary" disabled={controlsBusy || effects.presentationBusy || visiblePlayers.filter((p: any) => p.stack > 0 && !p.away).length < 2} onClick={() => send('deal')}>{room.phase === 'lobby' ? 'Deal first hand' : 'Deal next hand'} <ArrowUpRight size={17} /></button> : <button className="secondary" onClick={openReload}><Plus size={16} /> Load Chips</button>}
              </div>}
            </>}
            {enableReactions && <ChatDrawer key={`${room.code}:${room.createdAt}`} room={room} social={social} myTurn={Boolean(myTurn && live)} />}
          </div>

        </section>
      </div>

    </main>}

    {notice && <div className="toast" role="status">
      <CheckCircle2 size={18} />
      {notice}
    </div>}

    {panel && <div className={`modal-backdrop ${room && ['info', 'ledger'].includes(panel) ? 'table-sheet-backdrop' : ''}`} onClick={() => {
      setPanel('');
      setConfirm('');
    }}>
      <section role="dialog" aria-modal="true" aria-label={panel === 'confirm' ? (confirm === 'stand_up' ? 'Confirm stand up' : 'Confirm terminate game') : panel === 'ledger' ? 'Current Game Rankings' : panel === 'info' ? 'Game Info' : 'Table controls'} className={`modal ${panel === 'menu' ? 'compact-menu' : ''} ${panel === 'confirm' ? 'confirmation-dialog' : ''} ${panel === 'ledger' ? 'wide' : ''} ${room && ['info', 'ledger'].includes(panel) ? 'table-sheet' : ''}`} onClick={e => e.stopPropagation()}>
        <button className="modal-close icon-button" onClick={() => {
          setPanel('');
          setConfirm('');
        }} aria-label="Close">
          <X size={20} />
        </button>

        {panel === 'install' && <>
          <h2>Install App</h2>
          <div className="instruction">
            <Smartphone size={24} />
            <div>
              <h3>iPhone / iPad</h3>
              <p>Open this site in Safari. Tap Share → Add to Home Screen → Add.</p>
            </div>
          </div>
          <div className="instruction">
            <Download size={24} />
            <div>
              <h3>Android</h3>
              <p>Open this site in Chrome. Tap the ⋮ menu → Add to Home screen or Install app.</p>
            </div>
          </div>
          <small>You’ll need an internet connection to play. Sign in with your name and PIN to recover your seat on any device.</small>
        </>}

        {panel === 'account' && <>
          <h2>
            {player?.name}
          </h2>
          <div className="menu-list">
            <button onClick={() => {
              setError('');
              setPanel('pin');
            }}>Change PIN</button>
            <button disabled={busy} onClick={logout}>Sign out</button>
            {room && <button onClick={exit}>Return to Lobby</button>}
          </div>
        </>}

        {panel === 'pin' && <PinSettings onChange={changePin} busy={busy} error={error} />}


        {panel === 'buyin' && <>
          <h2>Load Chips</h2>
          <p>
            {handActive && me?.inHand ? 'Choose your amount. Chips are added automatically after this hand.' : 'Choose how many chips to add. Reloads are automatic.'}
          </p>
          <label>Chips<input type="number" min={room.settings.bb} max={room.settings.maxBuyin} value={rebuy} onChange={e => setRebuy(Number(e.target.value))} /></label>
          <button className="primary full" disabled={controlsBusy || room.requests.some((q: any) => q.id === room.me)} onClick={async () => {
            if (await send('rebuy', {
              amount: rebuy
            })) {
              setNotice(handActive && me?.inHand ? 'Reload queued for next hand' : 'Chips reloaded');
              setPanel('');
            }
          }}>{handActive && me?.inHand ? 'Load Chips After Hand' : 'Load Chips'} <Plus size={17} /></button>
          {room.requests.some((q: any) => q.id === room.me) && <p className="success">Your reload will be added automatically when this hand ends.</p>}
          {error && <p className="error">
            {error}
          </p>}
        </>}

        {panel === 'seat' && <>
          <h2>Load Chips</h2>
          <p>Seat {(selectedSeat ?? 0) + 1}{handActive ? ' · Join from the next hand' : ''}</p>
          <form onSubmit={async e => {
            e.preventDefault();
            if (selectedSeat === null) return;
            if (await send('join', {
              seat: selectedSeat,
              buyin: rebuy,
              name: player?.name || name || 'You'
            })) {
              setSelectedSeat(null);
              setPanel('');
            }
          }}>
            <label>Chips<input type="number" min={room.settings.bb * 2} max={room.settings.maxBuyin} step={1} required value={rebuy} onChange={e => setRebuy(Number(e.target.value))} /></label>
            <button className="primary full" disabled={controlsBusy || selectedSeat === null || room.players.some((p: any) => !p.left && p.seat === selectedSeat) || room.terminationPending}>Load Chips</button>
          </form>
          {selectedSeat !== null && room.players.some((p: any) => !p.left && p.seat === selectedSeat) && <p role="status">That seat is taken. Close this dialog and choose another seat.</p>}
          {error && <p className="error" role="alert">
            {error}
          </p>}
        </>}

        {panel === 'menu' && <>
          <h2>Table Menu</h2>
          <div className="menu-list">
            {seated && room.phase !== 'closed' && <>
              <button onClick={() => send('ready')} disabled={controlsBusy || me.pendingSeatAction === 'leave' || room.terminationPending}>
                {me.pendingSeatAction === 'sit_out' ? 'Cancel Sit Out' : me.away ? 'Sit In' : 'Sit Out'}
              </button>
            </>}
            {enableReactions && seated && room.phase !== 'closed' && <button disabled={controlsBusy || room.terminationPending} onClick={() => {
              if (me.pendingSeatAction === 'leave') void send('cancel_stand_up');
              else { setConfirm('stand_up'); setPanel('confirm'); }
            }}>{me.pendingSeatAction === 'leave' ? 'Cancel Stand Up' : 'Stand Up'}</button>}
            <button onClick={() => setPanel('history')}>Hand History</button>
            <button onClick={() => setPanel('info')}>Game Info</button>

            {room.phase !== 'closed' && <button className="danger" disabled={controlsBusy || room.terminationPending} onClick={() => { setConfirm('end'); setPanel('confirm'); }}>
              {room.terminationPending ? 'Termination Pending' : 'Terminate Game'}
            </button>}
            <button onClick={exit}>Return to Lobby</button>
          </div>
        </>}

        {panel === 'confirm' && <div className="confirm">
            <h2>{confirm === 'stand_up' ? 'Stand up?' : 'Terminate this game?'}</h2>
            <p>
              {confirm === 'stand_up' ? (handActive || room.phase === 'showdown' && !effects.settled ? 'Stand up and cash out after this hand and payouts? Your seat stays reserved until then. Returning requires a new buy-in.' : 'Stand up, cash out your chips and release your seat? Returning requires a new buy-in.') : handActive ? 'End the game for everyone after this hand and payouts? All players’ remaining chips will be cashed out.' : room.phase === 'showdown' && !effects.settled ? 'End the game for everyone after payouts finish and cash out all remaining chips?' : 'End the game for everyone and cash out all remaining chips?'}
            </p>
            <div className="confirm-actions"><button className="secondary" disabled={busy} onClick={() => { setConfirm(''); setPanel('menu'); }}>Cancel</button>
            <button className="primary" disabled={controlsBusy || Boolean(room.terminationPending)} onClick={async () => {
              if (await send(confirm)) {
                setConfirm('');
                setPanel('');
              }
            }}>{busy ? 'Processing…' : confirm === 'stand_up' ? 'Stand Up' : 'Terminate Game'}</button></div>
          {error && <p className="error" role="alert">{error}</p>}
          </div>}

        {panel === 'info' && <>
          <h2>Game Info</h2>
          <dl className="game-info-list">
            <div><dt>Current game</dt><dd>{room.game} · {gameName[room.game]}</dd></div>
            <div><dt>Blinds</dt><dd>{fmt(room.settings.sb)} / {fmt(room.settings.bb)}</dd></div>
            <div><dt>Selected games</dt><dd>{room.settings.games.join(' · ')}</dd></div>
            <div><dt>Rotation</dt><dd>Every {room.settings.rotation} hands</dd></div>
            <div><dt>Action time</dt><dd>{room.settings.timer} seconds</dd></div>
            <div><dt>Players</dt><dd>{visiblePlayers.length} / {room.settings.seats}</dd></div>
          </dl>
        </>}

        {panel === 'ledger' && <>
          <h2>Current Game Rankings</h2>
          <p>
            {room.phase === 'closed' ? 'Final balances. Payments happen outside the app.' : 'Live balances. Final settlement is calculated when the game ends.'}
          </p>
          <div className="ledger-scroll">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Buy-ins</th>
                  <th>
                    {room.phase === 'closed' ? 'Cash-out' : 'Stack + out'}
                  </th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                {[...room.players].sort((a: any, b: any) => b.net - a.net).map((p: any) => <tr key={p.id} className={p.id === room.me ? 'your-ranking' : undefined}>
                  <td>
                    {p.name}
                    {p.id === room.me && p.name !== 'You' ? ' · You' : ''}{p.left ? ' · standing' : ''}
                  </td>
                  <td>
                    {fmt(p.buyins)}
                  </td>
                  <td>
                    {fmt(p.stack + p.cashout)}
                  </td>
                  <td className={p.net >= 0 ? 'positive' : 'negative'}>
                    {p.net > 0 ? '+' : ''}
                    {fmt(p.net)}
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {live && <small>Chips in the current pot are excluded from player stacks until the hand ends.</small>}
          <button className="secondary full" onClick={() => {
            const lines = [['Player', 'Buy-ins', 'Stack', 'Cash-out', 'Net'], ...room.players.map((p: any) => [p.name, p.buyins, p.stack, p.cashout, p.net])];
            const csv = lines.map(row => row.map((v: any) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n'),
              url = URL.createObjectURL(new Blob([csv], {
                type: 'text/csv'
              })),
              a = document.createElement('a');
            a.href = url;
            a.download = `dunzo-club-${room.code}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}><Download size={16} /> Export Rankings CSV</button>
        </>}

        {panel === 'history' && <>
          <div className="history-toolbar"><h2>Hand History</h2><span><button className="secondary" onClick={() => void downloadHandHistory('csv')}>Action Log CSV</button><button className="secondary" onClick={() => void downloadHandHistory('json')}>JSON</button></span></div>
          {room.history.length === 0 ? <p>No completed hands.</p> : <div className="history-list">
            {room.history.map((h: any) => <details key={h.number}>
              <summary>
                <span>#{h.number} <b>
                  {h.game}
                </b></span>
                <span>{fmt(h.pot)} pot <ChevronRight size={14} /></span>
              </summary>
              <div className="history-body">
                <div className="history-run-boards">
                  {(h.boards?.length ? h.boards : [h.board]).map((board: number[], run: number) => <div className="board-cards" key={run}>
                    {h.runCount === 2 && <small>Run {run + 1}</small>}
                    {board.map((c: number, i: number) => <Card key={i} value={c} small />)}
                  </div>)}
                </div>
                {h.result.map((w: any) => <p key={w.id}>{w.name} +{fmt(w.wonAmount ?? w.amount)} · {h.runCount === 2 && w.runHands?.length > 0 ? w.runHands.map((rh: any) => `Run ${rh.run}: ${rh.description} (+${fmt(rh.wonAmount)})`).join(' · ') : w.description || w.hand}{w.returnedAmount > 0 ? ` · ${fmt(w.returnedAmount)} returned` : ''}</p>)}
                {h.showdown.map((p: any) => <div className="history-hole" key={p.name}>
                  <span>
                    {p.name}
                  </span>
                  {p.cards.map((c: number, i: number) => <Card key={i} value={c} small />)}
                </div>)}
                {h.reveals?.map((p: any) => <div className="history-hole" key={`reveal-${p.seat}`}><span>{p.name} · revealed</span>{p.cards.map((c: number, i: number) => <Card key={i} value={c} small />)}</div>)}
                {h.rabbitHunt && <div className="history-hole"><span>Rabbit Hunt · {h.rabbitHunt.requestedBy.name}</span>{h.rabbitHunt.board.map((c: number, i: number) => <Card key={i} value={c} small />)}</div>}
                <div className="history-actions">
                  {h.actions.map((a: string, i: number) => <div key={i}>
                    {a}
                  </div>)}
                </div>
              </div>
            </details>)}
          </div>}
        </>}

      </section>
    </div>}

  </div>;
}
