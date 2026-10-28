import test from 'node:test';
import assert from 'node:assert/strict';
import {SCENARIOS,buildScenario,normalizeConfig,labPlayerId,seededDeck,stepSimulation,summary} from '../lib/test-lab/scenarios.mjs';
import {view,command,startHand} from '../lib/poker.mjs';
const origin=1700000000000;
test('every scenario across variants and 2–8 players builds valid cards and reconciled chips',()=>{
  for(const game of ['NLH','PLO4','PLO5'])for(let players=2;players<=8;players++)for(const spec of SCENARIOS){
    const b=buildScenario({game,players,scenario:spec.id,seed:'matrix'},origin),r=b.room;
    assert.equal(b.expected.chips,b.expected.buyins,`${game}/${players}/${spec.id}`);
    const all=[...r.deck,...r.players.flatMap(p=>p.cards),...(r.runBoards?.length?r.runBoards.flat():r.board)];
    // Shared board cards may repeat across runs, never private or undealt cards.
    const dealt=r.players.flatMap(p=>p.cards);
    assert.equal(new Set(dealt).size,dealt.length);
    assert.ok(dealt.every(c=>!r.deck.includes(c)&&!r.board.includes(c)));
    assert.ok(all.every(c=>Number.isInteger(c)&&c>=0&&c<52));
    if(r.result)assert.equal(r.result.reduce((n,p)=>n+p.amount,0),r.history[0].pot);
    if(spec.id==='split')assert.equal(r.result.length,2);
    if(['run-twice','different-run-winners'].includes(spec.id))assert.equal(r.runCount,2);
    if(spec.id==='hero-win')assert.equal(r.result[0].id,labPlayerId(b.config.viewer));
    if(spec.id==='opponent-win')assert.equal(r.result[0].id,labPlayerId((b.config.viewer+1)%b.config.players));
    if(spec.id==='different-run-winners'){assert.equal(r.result.length,2);assert.ok(r.result.every(w=>w.runHands.length===1));}
    if(['run-once','vote-once','vote-timeout'].includes(spec.id))assert.equal(r.runCount,1);
    if(spec.id==='deck-limit')assert.equal(r.runVote.canTwice,false);
  }
});
test('seed and config reproduce all cards, actions, checkpoints and awards',()=>{
  for(const scenario of ['showdown','side-pots','run-twice','rabbit','split']){
    const cfg={scenario,game:'PLO5',players:6,seed:'issue-42'};
    assert.deepEqual(buildScenario(cfg,origin),buildScenario(cfg,origin));
    assert.notDeepEqual(seededDeck('42'),seededDeck('43'));
  }
});
test('local privacy boundary hides uncontested cards, exposes only voluntary reveals and self',()=>{
  const before=buildScenario({scenario:'fold-win',players:6},origin);
  assert.deepEqual(view(before.room,labPlayerId(0),before.now).players.filter(p=>p.cards?.length).map(p=>p.seat),[0]);
  const after=buildScenario({scenario:'reveal',players:6},origin);
  assert.deepEqual(view(after.room,labPlayerId(0),after.now).players.filter(p=>p.cards?.length).map(p=>p.seat),[0,1]);
  assert.equal(JSON.stringify(view(after.room,labPlayerId(0),after.now)).includes('privateCards'),false);
});
test('post-hand scenarios never alter awards; side pots and unmatched returns really occur',()=>{
  const cfg={players:6,seed:'42'},plain=buildScenario({...cfg,scenario:'fold-win'},origin);
  for(const scenario of ['rabbit','reveal']){const b=buildScenario({...cfg,scenario},origin);assert.deepEqual(b.room.result,plain.room.result);assert.deepEqual(b.room.players.map(p=>p.stack),plain.room.players.map(p=>p.stack));}
  const pots=buildScenario({...cfg,scenario:'side-pots'},origin);
  assert.ok(pots.room.result.flatMap(w=>w.pots).some(p=>p.label!=='Main pot'));
  const returned=buildScenario({...cfg,scenario:'uncalled'},origin);
  assert.ok(returned.room.uncalledReturns.length>0);
});
test('simulation steps reproduce and rotate selected variants without losing chips',()=>{
  const cfg={scenario:'simulation',players:4,games:['NLH','PLO4','PLO5'],seed:'bots',rotation:2};
  const a=buildScenario(cfg,origin),b=buildScenario(cfg,origin);const variants=new Set();
  for(let i=0;i<300&&a.room.completed<7;i++){
    stepSimulation(a.room,origin+100000+i*1000,cfg.seed);stepSimulation(b.room,origin+100000+i*1000,cfg.seed);
    assert.deepEqual(a.room,b.room);variants.add(a.room.game);const result=summary(a.room);assert.equal(result.chips,result.buyins);
  }
  assert.equal(variants.size,3);
});
test('invalid inputs normalize, deck injection is validated and protocol cannot accept it',async()=>{
  const c=normalizeConfig({players:99,game:'x',viewer:99,bb:3,timer:7});assert.equal(c.players,8);assert.equal(c.viewer,7);assert.equal(c.bb,4);assert.equal(c.timer,15);
  const b=buildScenario({scenario:'closed'},origin);
  assert.throws(()=>startHand(b.room,origin,[1]),/Finish|unique/);
  const {parseCommand,commandEnvelope}=await import('../lib/protocol/poker.mjs');
  assert.throws(()=>parseCommand({...commandEnvelope({type:'deal',code:'LAB222'},b.room),testDeck:seededDeck('42')}));
});

test('short-call fixture is capped and the next raise cancels the queued intent',async()=>{
  const {queuePreaction,preactionValid,waitingCall}=await import('../lib/client/preaction.mjs');
  for(const game of ['NLH','PLO4','PLO5'])for(let viewer=0;viewer<3;viewer++){
    const b=buildScenario({scenario:'short-call',players:3,game,viewer},origin),r=b.room;
    const before=view(r,labPlayerId(viewer),b.now),queued=queuePreaction('call',before),call=waitingCall(before);
    assert.ok(r.currentBet>r.players[viewer].bet+r.players[viewer].stack);assert.notEqual(r.turn,labPlayerId(viewer));
    stepSimulation(r,b.now+1000,b.config.seed,true);const after=view(r,labPlayerId(viewer),b.now+1000);
    assert.equal(waitingCall(after),call);assert.equal(preactionValid(queued,after),false);
  }
});
