import test from 'node:test';
import assert from 'node:assert/strict';
import { queuePreaction, preactionValid, resolvePreaction } from '../lib/client/preaction.mjs';
const fixture = () => ({code:'ABC234',me:'me',handStartedAt:123,phase:'flop',currentBet:100,version:1,
  players:[{id:'me',inHand:true,bet:50,stack:500},{id:'other',inHand:true,bet:100,stack:500}]});
test('pre-call authorizes the exact amount; calls/version changes preserve intent but a raise cancels',()=>{
  const r=fixture(),q=queuePreaction('call',r);
  assert.equal(q.amount,50);assert.equal(preactionValid(q,r),true);assert.equal(resolvePreaction(q,50),'call');
  assert.equal(preactionValid(q,{...r,version:20}),true);
  assert.equal(resolvePreaction(q,100),null);
  assert.equal(preactionValid(q,{...r,currentBet:150}),false);
  assert.equal(resolvePreaction(q,0),null);
});
test('a raise cancels even when a short stack still faces the same capped call',()=>{
  const r=fixture();r.players[0].stack=20;const q=queuePreaction('call',r);
  assert.equal(q.amount,20);assert.equal(preactionValid(q,{...r,currentBet:200}),false);
});
test('pre-check cancels on a bet; check/fold remains selected and never calls',()=>{
  const r=fixture();r.currentBet=50;
  const check=queuePreaction('check',r),cf=queuePreaction('check-fold',r);
  assert.equal(preactionValid(check,r),true);
  assert.equal(preactionValid(check,{...r,currentBet:100}),false);
  assert.equal(preactionValid(cf,{...r,currentBet:200}),true);
  assert.equal(resolvePreaction(cf,0),'check');assert.equal(resolvePreaction(cf,150),'fold');
});
test('pre-call clears for another player/table/street/hand or a folded/away/departed player',()=>{
  const r=fixture(),q=queuePreaction('call',r);
  for(const patch of [{code:'XYZ234'},{me:'other'},{phase:'turn'},{phase:'runout_vote'},{handStartedAt:124}])assert.equal(preactionValid(q,{...r,...patch}),false);
  for(const patch of [{away:true},{left:true},{folded:true},{inHand:false},{stack:0}])assert.equal(preactionValid(q,{...r,players:[{...r.players[0],...patch}]}),false);
});

test('a raise racing the queued call is rejected by the server version guard without charging chips',async()=>{
  const {TableService}=await import('../server/table-service.mjs');
  const {MemoryStorage}=await import('./memory-storage.mjs');
  const {commandEnvelope}=await import('../lib/protocol/poker.mjs');
  const ids=Array.from({length:3},()=>crypto.randomUUID()),service=new TableService(new MemoryStorage());
  let room=(await service.execute(ids[0],commandEnvelope({type:'create',name:'Host',sb:5,bb:10,seats:3,buyin:1000,games:['NLH']}))).snapshot;
  for(let i=1;i<3;i++)await service.execute(ids[i],commandEnvelope({type:'join',code:room.code,name:'Player '+i}));
  room=await service.snapshot(ids[0],room.code);
  room=(await service.execute(ids[0],commandEnvelope({type:'deal',code:room.code},room))).snapshot;
  const before=await service.snapshot(ids[1],room.code),queued=queuePreaction('call',before);
  const request=commandEnvelope({type:'call',code:room.code},before);
  assert.equal(preactionValid(queued,before),true);
  await service.execute(ids[0],commandEnvelope({type:'raise',code:room.code,amount:30},room));
  await assert.rejects(service.execute(ids[1],request),/table changed/i);
  const after=await service.snapshot(ids[1],room.code);
  assert.equal(after.players.find(p=>p.id===ids[1]).stack,before.players.find(p=>p.id===ids[1]).stack);
  assert.equal(preactionValid(queued,after),false);
});
