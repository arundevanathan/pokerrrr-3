import {newRoom, command, startHand, legal, act, tick, view} from '../poker.mjs';
export const LAB_VERSION = 1;
export const labPlayerId = seat => `00000000-0000-4000-8000-${String(seat + 1).padStart(12, '0')}`;
const item = (id, title, group, check, extra = {}) => ({id, title, group, check, ...extra});
export const SCENARIOS = [
  item('deal', 'Deal and card peeks', 'Table', 'Watch cards arrive; nameplates, bets and controls must remain anchored.'),
  item('betting', 'Your turn and betting controls', 'Betting', 'Check the turn beam, timer, legal call, slider and inward spacing.'),
  item('waiting', 'Pre-turn checkboxes', 'Betting', 'Select a pre-action, then Step. Only one checkbox may be armed.'),
  item('precall-raise', 'Raise cancels pre-call', 'Betting', 'Arm Call, then Step opponent raise. The checkbox must clear.'),
  item('short-call', 'Capped short-stack call', 'Betting', 'Arm the capped Call, then Step opponent raise. The checkbox must clear although the displayed call stays unchanged.', {minPlayers:3}),
  item('long-names', 'Long names and large stacks', 'Table', 'Player labels, chip amounts and controls must fit the viewport.'),
  item('empty-seats', 'Empty seats and join controls', 'Table', 'Empty-seat targets and occupied seats must remain distinct.'),
  item('flop', 'Flop betting', 'Betting', 'Three board cards, pot and all visible wagers must be readable.'),
  item('turn', 'Turn betting', 'Betting', 'The fourth card must not move existing community cards.'),
  item('river', 'River betting', 'Betting', 'Five board cards and hole cards remain readable.'),
  item('fold-win', 'Uncontested win', 'Results', 'No private opponent cards may appear; awards and unmatched returns must reconcile.'),
  item('showdown', 'Showdown and winning five', 'Results', 'Inspect winner, amount and exact five highlighted cards; Omaha uses two hole cards.'),
  item('hero-win', 'Your winning hand', 'Results', 'Your deliberately dealt winning hand must receive the award and exact-five highlights.'),
  item('opponent-win', 'Opponent wins', 'Results', 'The opponent, rather than you, must receive the award and winning-card highlights.'),
  item('different-run-winners', 'Different winners on two runs', 'Runouts', 'Each run has a different winner; switch results and inspect the corresponding five cards.', {players:2}),
  item('split', 'Split pot', 'Results', 'Both tied recipients and shares must be displayed; chip totals reconcile.'),
  item('vote', 'Runout vote', 'Runouts', 'Once/Twice overlay must not resize the felt, board or bottom panel.'),
  item('run-once', 'All-in: one run', 'Runouts', 'Follow runout, exact-five highlights and awards without layout jumps.'),
  item('run-twice', 'All-in: two runs', 'Runouts', 'Inspect both boards and switch Run 1/Run 2 results after payout.'),
  item('vote-once', 'One player chooses Once', 'Runouts', 'A single Once vote must resolve to one run.'),
  item('vote-timeout', 'Unanswered vote', 'Runouts', 'An unanswered vote defaults to Once; no table lockout.'),
  item('flop-allin', 'All-in on the flop', 'Runouts', 'The flop is shared; later runout cards and winners remain distinct.'),
  item('turn-allin', 'All-in on the turn', 'Runouts', 'The first four cards are shared; only the river is run twice.'),
  item('deck-limit', 'Insufficient cards for two runs', 'Runouts', 'At eight-player PLO5 preflop, Twice is unavailable with a clear reason.', {players:8, game:'PLO5'}),
  item('side-pots', 'Unequal stacks and side pots', 'Results', 'Switch main/side pots; recipients, amounts and remaining stacks must agree.', {minPlayers:3}),
  item('uncalled', 'Uncalled chips before showdown', 'Results', 'The largest unmatched contribution returns before results, exactly once.', {minPlayers:3}),
  item('rabbit', 'Rabbit Hunt', 'Post-hand', 'Open Hand History: speculative board appears without changing awards or chips.'),
  item('reveal', 'Voluntary reveal', 'Post-hand', 'A folded opponent reveals; their seat/history show cards, other private cards stay hidden.', {minPlayers:3}),
  item('chat', 'Chat, drafts and keyboard', 'Social', 'Open chat on the actual phone; check board, cards, Call and Raise… with the keyboard.'),
  item('history', 'History and player export', 'Post-hand', 'Open Hand History; JSON/CSV must include only this viewpoint’s legitimate cards.'),
  item('away', 'Sit out and return', 'Players', 'Sit Out is distinct from Disconnected; return preserves the seat and chips.'),
  item('stand-up', 'Stand up during a hand', 'Players', 'Departure is queued until safe; cancellation must retain seat and balance.'),
  item('rebuy', 'Reload queued during a hand', 'Players', 'The reload is queued; it must not change the current pot or apply twice.'),
  item('terminate', 'Termination pending', 'Players', 'The notice must not push hole cards, slider or action buttons off-screen.'),
  item('closed', 'Completed game', 'Players', 'Rankings and Return to Lobby remain accessible; final net chips sum to zero.'),
  item('recovery', 'Connection recovery', 'Connection', 'Use Server mode. Fail HTTP/socket, miss a turn, restore; no Retry or sign-in should be needed.'),
  item('simulation', 'Continuous simulation', 'Simulation', 'Play against bots using selected game settings; pause or step whenever needed.')
];
export const QUICK = ['deal','betting','precall-raise','fold-win','showdown','split','vote','run-twice','side-pots','rabbit','chat','terminate'];
export const presets = [
  {id:'actual', title:'Actual device', width:0, height:0},
  {id:'small', title:'Small phone', width:320, height:568},
  {id:'portrait', title:'Portrait', width:390, height:844},
  {id:'short', title:'Short portrait', width:390, height:740},
  {id:'large', title:'Large phone', width:430, height:932},
  {id:'landscape', title:'Landscape', width:844, height:390}
];
export function normalizeConfig(input = {}) {
  const scenario = SCENARIOS.find(s => s.id === input.scenario) || SCENARIOS[0];
  const number = (value, fallback, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback));
  const count = scenario.players || Math.max(scenario.minPlayers || 2, number(input.players, 6, 2, 8));
  const game = scenario.game || (['NLH','PLO4','PLO5'].includes(input.game) ? input.game : 'NLH');
  const bb = number(input.bb, 50, 2, 100000); const evenBB = bb + bb % 2;
  return {scenario:scenario.id, players:count, game, games:Array.isArray(input.games) && input.games.length && input.games.every(g=>['NLH','PLO4','PLO5'].includes(g)) ? [...new Set(input.games)] : [game],
    viewer:number(input.viewer,0,0,count-1), seed:String(input.seed || '42').slice(0,64), bb:evenBB,
    buyin:number(input.buyin,evenBB * 50,evenBB * 2,100000000), timer:[10,15,20,30].includes(Number(input.timer))?Number(input.timer):15,
    rotation:number(input.rotation,3,2,4), speed:[.25,.5,1,2].includes(Number(input.speed))?Number(input.speed):1};
}
export function seededRandom(seed) {
  let h=2166136261; for(const c of String(seed)) h=Math.imul(h^c.charCodeAt(0),16777619);
  return () => {h += 0x6D2B79F5; let t=Math.imul(h^h>>>15,1|h);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};
}
export function seededDeck(seed) {
  const rand=seededRandom(seed), deck=Array.from({length:52},(_,i)=>i);
  for(let i=51;i>0;i--){const j=Math.floor(rand()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];} return deck;
}
// A complete unique deck is supplied before dealing, never by replacing payouts.
function splitDeck(count, game, seed) {
  const card=s=>'cdhs'.indexOf(s[1])*13+'23456789TJQKA'.indexOf(s[0]);
  const fixed={0:['Kc','Kd'].map(card),1:['Kh','Ks'].map(card)}, board=['Ac','Ad','Ah','2c','3d'].map(card);
  const used=new Set([...fixed[0],...fixed[1],...board,card('As')]), rest=seededDeck(seed).filter(c=>!used.has(c));
  const pop=()=>rest.pop(), draw=[], n=game==='NLH'?2:game==='PLO4'?4:5;
  for(let round=0;round<n;round++) for(let i=0;i<count;i++){const seat=(i+1)%count;draw.push(fixed[seat]?.[round]??pop());}
  draw.push(card('As'),...board.slice(0,3).reverse(),pop(),board[3],pop(),board[4]);
  return [...rest,...draw.reverse()];
}
function winnerDeck(count, game, seed, winner, twoRuns=false) {
  const card=s=>'cdhs'.indexOf(s[1])*13+'23456789TJQKA'.indexOf(s[0]);
  const fixed=twoRuns?{0:['2c','3c'].map(card),1:['2d','3d'].map(card)}:{[winner]:['Ac','Ad'].map(card)};
  const boards=(twoRuns?[['4c','5c','6c','9h','Th'],['4d','5d','6d','9s','Ts']]:[['Qc','Qd','Qh','2c','3d']]).map(b=>b.map(card));
  const reserved=(twoRuns?['7c','8c','7d','8d']:['Ah','As','Qs']).map(card);
  const used=new Set([...Object.values(fixed).flat(),...boards.flat(),...reserved]);
  const rest=seededDeck(seed).filter(c=>!used.has(c)),draw=[],pop=()=>rest.pop(),n=game==='NLH'?2:game==='PLO4'?4:5;
  for(let round=0;round<n;round++)for(let i=0;i<count;i++){const seat=(i+1)%count;draw.push(fixed[seat]?.[round]??pop());}
  for(const board of boards)draw.push(twoRuns?pop():reserved.shift(),...board.slice(0,3).reverse(),twoRuns?pop():reserved.shift(),board[3],twoRuns?pop():reserved.shift(),board[4]);
  return [...reserved,...rest,...draw.reverse()];
}
export function summary(room, viewer=0) {
  const v=view(room,labPlayerId(viewer),room.labNow || room.createdAt), hand=room.history[0];
  return {phase:room.phase, variant:room.game, hand:room.completed+(room.phase==='showdown'||room.phase==='closed'?0:1), pot:room.result?room.history[0]?.pot:room.players.reduce((n,p)=>n+p.total,0),
    chips:room.players.reduce((n,p)=>n+p.stack+p.cashout+(['showdown','closed'].includes(room.phase)?0:p.total),0),
    buyins:room.players.reduce((n,p)=>n+p.buyins,0), winners:(v.result||[]).map(w=>({name:w.name,amount:w.wonAmount??w.amount,hand:w.description||w.hand})),
    returns:(v.uncalledReturns||[]).map(e=>({name:e.name,amount:e.amount})), runCount:room.runCount||1,
    visible: v.players.filter(p=>p.cards?.length).map(p=>p.seat), rabbit:hand?.rabbitHunt?.board || null, reveals:hand?.reveals?.length || 0};
}
export function buildScenario(input = {}, origin=Date.now()) {
  const config=normalizeConfig(input), spec=SCENARIOS.find(s=>s.id===config.scenario), id=config.scenario;
  let now=origin, checkpoints=[]; const transcript=[];
  const big=id==='long-names', bb=big?100000:config.bb, buyin=big?50000000:config.buyin;
  const room=newRoom('LAB222',labPlayerId(0),{name:big?'Alexandria Longname':'You · Test player',bb,buyin,seats:id==='empty-seats'?8:config.players,games:id==='simulation'?config.games:[config.game],timer:config.timer,rotation:config.rotation},now);
  for(let i=1;i<config.players;i++) command(room,labPlayerId(i),{type:'join',name:big?`Player ${i} Longname`:`Player ${i+1}`,buyin},now);
  room.paused=true;
  if(['side-pots','uncalled','short-call'].includes(id)) room.players.forEach((p,i)=>{p.stack=p.buyins=bb*(i===0?40:i===1?12:i===2?6:20);});
  if(id==='short-call')room.players.forEach((p,i)=>{p.stack=p.buyins=bb*(i===config.viewer?2:40);});
  const capture=label=>{room.labNow=now; room.version++;checkpoints.push({label,now,room:structuredClone(room)});};
  const action=(type,amount)=>{const p=room.players.find(p=>p.id===room.turn);now+=500;act(room,room.turn,type,amount,now);transcript.push({at:now-origin,seat:p.seat,type,amount});capture(`${p.name}: ${type}${amount?' '+amount:''}`);};
  startHand(room,now,id==='split'?splitDeck(config.players,config.game,config.seed):['hero-win','opponent-win','different-run-winners'].includes(id)?winnerDeck(config.players,config.game,config.seed,id==='hero-win'?config.viewer:(config.viewer+1)%config.players,id==='different-run-winners'):seededDeck(config.seed));capture('Cards dealt');now+=room.dealDuration+50;capture('Ready to act');
  const call=()=>action(legal(room,room.turn).call?'call':'check');
  const street=target=>{let n=0;while(room.turn&&room.phase!==target&&n++<160)call();};
  const finishFold=()=>{let n=0;while(room.turn&&n++<16)action('fold');};
  const allin=()=>{let n=0;while(room.turn&&n++<200){const l=legal(room,room.turn);if(l.canRaise) action('raise',l.max);else call();}};
  const resolve=(twice=true,timeout=false)=>{if(room.phase!=='runout_vote')return;now=room.runVote.opensAt+10;
    if(!timeout) for(const [i,voter] of room.runVote.voters.entries())command(room,voter.id,{type:'runout_vote',choice:twice&&room.runVote.canTwice&&!(id==='vote-once'&&i===0)?2:1},now);
    capture('Votes recorded');now=room.runVote.deadline;tick(room,now,false);capture('Runout begins');now=room.payoutFinishedAt+1;capture('Payouts complete');};
  if(['flop','turn','river','flop-allin','turn-allin'].includes(id))street(id.split('-')[0]);
  if(['fold-win','rabbit','reveal','history','closed'].includes(id))finishFold();
  if(id==='split') {let n=0;while(room.turn&&n++<160){const seat=room.players.find(p=>p.id===room.turn).seat;if(seat>1)action('fold');else call();}}
  if(['showdown','hero-win','opponent-win'].includes(id)){let n=0;while(room.turn&&n++<160)call();}
  if(['different-run-winners','vote','run-once','run-twice','vote-once','vote-timeout','flop-allin','turn-allin','side-pots','uncalled','deck-limit'].includes(id)) {if(config.game==='PLO5'&&config.players===8&&['run-twice','flop-allin','turn-allin'].includes(id)&&room.board.length<3)street('flop');allin();if(!['vote','deck-limit'].includes(id))resolve(!['run-once','vote-once','vote-timeout'].includes(id),id==='vote-timeout');}
  if(['betting','waiting','precall-raise','short-call'].includes(id)){
    let n=0;while(room.turn&&((id==='betting')?room.turn!==labPlayerId(config.viewer):room.turn===labPlayerId(config.viewer))&&n++<16)call();
  }
  if(id==='short-call'){
    let n=0;const before=(config.viewer+config.players-1)%config.players;
    while(room.turn&&[config.viewer,before].includes(room.players.find(p=>p.id===room.turn).seat)&&n++<config.players*2)call();
    const l=legal(room,room.turn);if(l?.canRaise)action('raise',Math.min(l.max,Math.max(l.min,bb*4)));
    capture('Short-stack pre-call is capped');
  }
  if(id==='rabbit'){now=room.payoutFinishedAt+1;command(room,labPlayerId(config.viewer),{type:'rabbit_hunt'},now);capture('Rabbit Hunt recorded');}
  if(id==='reveal'){now=room.payoutFinishedAt+1;command(room,room.players.find(p=>p.folded&&p.seat!==config.viewer).id,{type:'voluntary_reveal'},now);capture('Opponent voluntarily reveals');}
  if(['away','stand-up','rebuy','terminate'].includes(id)){const type={away:'set_away','stand-up':'stand_up',rebuy:'rebuy',terminate:'end'}[id];command(room,labPlayerId(config.viewer),{type,away:true,amount:bb*20},now);capture(spec.title);}
  if(id==='closed'){now=room.payoutFinishedAt+1;command(room,labPlayerId(config.viewer),{type:'end'},now);capture('Game closed');}
  if(room.phase==='showdown'&&id!=='vote'){now=Math.max(now,room.payoutFinishedAt+1);capture('Settled results');}
  if(room.phase==='runout_vote'){now=room.runVote.opensAt+1;capture('Vote open');}
  room.labNow=now;
  return {config,spec,room,now,checkpoints,transcript,expected:summary(room,config.viewer)};
}
export function stepSimulation(room, now, seed, preferRaise=false) {
  if(room.phase==='closed')return;
  if(room.phase==='runout_vote') {const at=Math.max(now,room.runVote.opensAt+1);for(const v of room.runVote.voters)if(v.choice===null)command(room,v.id,{type:'runout_vote',choice:room.runVote.canTwice?2:1},at);tick(room,room.runVote.deadline,false);room.labNow=room.runVote.deadline;return;}
  if(room.phase==='showdown'||room.phase==='lobby') {startHand(room,Math.max(now,room.payoutFinishedAt||0)+1,seededDeck(`${seed}:${room.completed}`));room.labNow=room.handStartedAt+room.dealDuration+1;return;}
  const l=legal(room,room.turn); if(!l)return;
  const roll=seededRandom(`${seed}:${room.completed}:${room.actionSeq}`)();
  act(room,room.turn,l.canRaise&&(preferRaise||roll<.18)?'raise':l.call&&roll<.09?'fold':l.call?'call':'check',l.canRaise?l.min:undefined,now);
  room.labNow=now;
}
