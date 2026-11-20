import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { presenceView, PRESENCE_LEASE_MS } from '../lib/presence.mjs';
import { TableService } from '../server/table-service.mjs';
import { MemoryStorage } from './memory-storage.mjs';
import { commandEnvelope } from '../lib/protocol/poker.mjs';
const source = ts.transpileModule(readFileSync(new URL('../lib/client/poker-client.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace('../protocol/poker.mjs', new URL('../lib/protocol/poker.mjs', import.meta.url).href);
const { PokerClient } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const host = crypto.randomUUID(), friend = crypto.randomUUID();
function browser(t, handler, socketCommand) {
  const originals = Object.fromEntries(['fetch','localStorage','WebSocket','navigator','document','window','location'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const stored = new Map(), sockets = [];
  const room = {code:'ABC234', version:4,handStartedAt:123};
  const state = {protocol:4,type:'state',lobby:{activeGame:{code:room.code,joined:true}},room};
  const statuses=[], updates=[], notices=[]; let expired=0;
  class FakeSocket {
    static OPEN=1; static CLOSED=3;
    readyState=1;
    constructor(){sockets.push(this);queueMicrotask(()=>this.emit(state));}
    emit(data){this.onmessage?.({data:JSON.stringify(data)});}
    send(raw){const data=JSON.parse(raw); if(data.type==='command') socketCommand?.(this,data.input); else if(data.type==='ping' && navigator.onLine)this.emit({protocol:4,type:'pong'}); else if(data.type==='resync')this.emit(state);}
    close(code=1000){this.readyState=3;this.onclose?.({code});}
  }
  const fakeFetch=async(url,options={})=>{
    const result=await handler(String(url),options,room);
    return new Response(JSON.stringify(result?.data ?? (String(url).includes('session')?{player:{id:host}}:String(url).includes('lobby')?state.lobby:room)),{status:result?.status||200});
  };
  const vars={fetch:fakeFetch,localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},WebSocket:FakeSocket,navigator:{onLine:true},document:Object.assign(new EventTarget(),{hidden:false}),window:new EventTarget(),location:{href:'https://table.test/',protocol:'https:'}};
  for(const [k,value] of Object.entries(vars))Object.defineProperty(globalThis,k,{value,writable:true,configurable:true});
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:100000});
  const client=new PokerClient(host);
  const stop=client.connect(s=>updates.push(s),s=>statuses.push(s),()=>expired++,undefined,undefined,s=>notices.push(s));
  t.after(()=>{stop();t.mock.timers.reset();for(const [k,d]of Object.entries(originals))d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
  return {client,room,state,sockets,statuses,updates,notices,stored,get expired(){return expired;}};
}
test('HTTP reply lost after acceptance: WebSocket reuses command ID, applies once and unlocks',async t=>{
  const receipts=new Map();let applied=0;const ids=[];
  const accept=input=>{ids.push(input.commandId);if(!receipts.has(input.commandId)){applied++;receipts.set(input.commandId,{code:'ABC234',version:5});}return receipts.get(input.commandId);};
  const f=browser(t,async(url,o)=>{if(o.method==='POST'){accept(JSON.parse(o.body));throw new TypeError('Reply lost');}},(socket,input)=>socket.emit({protocol:4,type:'command_result',commandId:input.commandId,snapshot:accept(input)}));
  await settle();await f.client.send({type:'call',code:'ABC234'},f.room);
  assert.equal(applied,1);assert.equal(ids[0],ids[1]);assert.equal(f.client.hasPending(),false);
});
test('HTTP unavailable with healthy WebSocket: fallback accepts action without HTTP session preflight',async t=>{
  let calls=0;
  const f=browser(t,async()=>{throw new TypeError('HTTP unavailable');},(socket,input)=>{calls++;socket.emit({protocol:4,type:'command_result',commandId:input.commandId,snapshot:{code:'ABC234',version:5}});});
  await settle();await f.client.send({type:'check',code:'ABC234'},f.room);
  assert.equal(calls,1);assert.equal(f.expired,0);assert.equal(f.client.hasPending(),false);
});
test('a decision bet sends on the socket immediately even when HTTP stalls',async t=>{
  let posts=0, sends=0;
  const f=browser(t,async (_url,options)=>{
    if(options.method==='POST'){posts++;return new Promise(()=>{});}
  },(socket,input)=>{
    sends++;
    assert.equal(input.decision,'current-decision');
    socket.emit({protocol:4,type:'command_result',commandId:input.commandId,snapshot:{code:input.code,version:5}});
  });
  await settle();
  await f.client.send({type:'call',code:f.room.code},{...f.room,bettingDecision:'current-decision'});
  t.mock.timers.tick(300);
  assert.equal(sends,1);
  assert.equal(posts,0);
  assert.equal(f.client.hasPending(),false);
});
test('a slow socket starts HTTP promptly and both paths use the same command ID',async t=>{
  let sent;
  const f=browser(t,async (_url,options)=>{
    if(options.method==='POST'){
      assert.deepEqual(JSON.parse(options.body),sent);
      return {data:{code:sent.code,version:5}};
    }
  },(_socket,input)=>{sent=input;});
  await settle();
  const delivered=f.client.send({type:'call',code:f.room.code},{...f.room,bettingDecision:'current-decision'});
  await settle();
  assert.ok(sent);
  t.mock.timers.tick(250);
  assert.equal((await delivered).version,5);
  assert.equal(f.client.hasPending(),false);
});
test('a recovered socket picks up a bet while the initial HTTP request still stalls',async t=>{
  let httpCommand, socketCommand;
  const f=browser(t,async (_url,options)=>{
    if(options.method==='POST'){
      httpCommand=JSON.parse(options.body);
      return new Promise(()=>{});
    }
  },(socket,input)=>{
    socketCommand=input;
    socket.emit({protocol:4,type:'command_result',commandId:input.commandId,snapshot:{code:input.code,version:5}});
  });
  await settle();
  f.sockets[0].close();
  await settle();
  const delivery=f.client.send({type:'call',code:f.room.code},{...f.room,bettingDecision:'current-decision'});
  await settle();
  assert.ok(httpCommand);
  assert.equal(socketCommand,undefined);
  t.mock.timers.tick(1000);
  assert.equal((await delivery).version,5);
  assert.deepEqual(socketCommand,httpCommand);
  assert.equal(f.client.hasPending(),false);
  assert.equal(f.statuses.at(-1),'connected');
});
test('malformed and invalid saved commands are discarded without blocking the next decision',async t=>{
  let posts=0;
  const f=browser(t,async (_url,options)=>{if(options.method==='POST')posts++;});
  const key='dunzo-club-command:'+host;
  for(const stored of ['{"commandId":',JSON.stringify({commandId:crypto.randomUUID(),type:'call'}),'null']){
    f.stored.set(key,stored);
    f.sockets[0].emit(f.state);
    await settle();
    assert.equal(f.stored.has(key),false);
    assert.equal(f.statuses.at(-1),'connected');
  }
  assert.equal(posts,0);
  await f.client.send({type:'call',code:f.room.code},f.room);
  assert.equal(posts,1);
});
test('a betting rejection publishes the fresh snapshot and releases controls immediately',async t=>{
  const f=browser(t,async ()=>undefined,(socket,input)=>{
    socket.emit({protocol:4,type:'command_result',commandId:input.commandId,status:409,error:'Decision changed',
      snapshot:{code:input.code,version:5,bettingDecision:null}});
  });
  await settle();
  await assert.rejects(f.client.send({type:'call',code:f.room.code},{...f.room,bettingDecision:'current-decision'}),/Decision changed/);
  assert.equal(f.updates.at(-1).room.version,5);
  assert.equal(f.statuses.at(-1),'connected');
  assert.equal(f.client.hasPending(),false);
});
test('a newer room version keeps a pending bet while its decision still matches',async t=>{
  const f=browser(t,async (_url,options)=>options.method==='POST'
    ? {status:429,data:{error:'Too many requests'}} : undefined);
  await settle();
  const room={...f.room,bettingDecision:'current-decision'};
  f.sockets[0].close();
  await settle();
  await assert.rejects(f.client.send({type:'call',code:room.code},room),/Too many requests/);
  t.mock.timers.tick(1000);
  await settle();
  f.sockets.at(-1).emit({...f.state,room:{...room,version:room.version+1}});
  assert.equal(f.client.hasPending(),true);
  f.sockets.at(-1).emit({...f.state,room:{...room,version:room.version+2,bettingDecision:null}});
  assert.equal(f.client.hasPending(),false);
  assert.equal(f.statuses.at(-1),'connected');
});
test('both transports fail, turn passes: automatic stale rejection clears pending and restores next turn',async t=>{
  let offline=true;
  const f=browser(t,async(url,o)=>{if(offline)throw new TypeError('Disconnected');if(o.method==='POST')return {status:409,data:{error:'The table changed'}};},socket=>socket.close());
  await settle();await assert.rejects(f.client.send({type:'call',code:'ABC234'},f.room),/Reconnecting/);
  assert.equal(f.client.hasPending(),true);offline=false;
  t.mock.timers.tick(3100);await settle();
  assert.equal(f.client.hasPending(),false);assert.equal(f.expired,0);assert.ok(f.notices.some(n=>n.includes('not applied')));
  assert.equal(f.statuses.at(-1),'connected');
});
test('socket policy close does not sign out on a failed HTTP session check; valid session reconnects',async t=>{
  let httpDown=true;
  const f=browser(t,async()=>{if(httpDown)throw new TypeError('offline');});
  await settle();f.sockets[0].close(1008);await settle();assert.equal(f.expired,0);
  httpDown=false;t.mock.timers.tick(3100);await settle();assert.ok(f.sockets.length>1);assert.equal(f.expired,0);
});
test('confirmed expired session signs out, ordinary socket closure does not',async t=>{
  const f=browser(t,async url=>url.includes('session')?{data:{player:null}}:undefined);
  await settle();f.sockets[0].close(1008);await settle();assert.equal(f.expired,1);
});
test('HTTP snapshot fallback supplies fresh state when socket is unavailable',async t=>{
  const f=browser(t,async()=>undefined);await settle();f.sockets[0].close();
  await settle();assert.ok(f.updates.length>=2);assert.equal(f.statuses.at(-1),'connected');
});
test('going back online refreshes the turn even when the old socket still answers pings',async t=>{
  const f = browser(t, async () => { throw new TypeError('HTTP unavailable'); });
  await settle();
  navigator.onLine = false;
  window.dispatchEvent(new Event('offline'));
  assert.equal(f.statuses.at(-1), 'offline');
  navigator.onLine = true;
  window.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(f.sockets.length, 1);
  assert.ok(f.updates.length >= 2);
  assert.equal(f.statuses.at(-1), 'connected');
});
test('a definitive access rejection releases the command slot for the next valid move',async t=>{
  let posts = 0;
  const f = browser(t, async (_url, options) => {
    if (options.method === 'POST' && ++posts === 1) return {status:403,data:{error:'Access denied'}};
  });
  await settle();
  await assert.rejects(f.client.send({type:'call',code:f.room.code},f.room), /Access denied/);
  assert.equal(f.client.hasPending(), false);
  await f.client.send({type:'fold',code:f.room.code},f.room);
  assert.equal(posts, 2);
});
test('rate-limited bets back off and a newer snapshot unblocks the next move',async t=>{
  let posts = 0;
  const f = browser(t, async (_url, options) => {
    if (options.method === 'POST' && ++posts === 1) return {status:429,data:{error:'Too many requests'}};
  });
  await settle();
  await assert.rejects(f.client.send({type:'call',code:f.room.code},f.room), /Too many requests/);
  f.sockets[0].emit(f.state);
  t.mock.timers.tick(3100);
  await settle();
  assert.equal(posts, 1);
  assert.equal(f.client.hasPending(), true);
  const nextRoom = {...f.room, version:f.room.version + 1};
  f.sockets[0].emit({...f.state,room:nextRoom});
  assert.equal(f.client.hasPending(), false);
  assert.equal(f.statuses.at(-1), 'connected');
  await f.client.send({type:'fold',code:nextRoom.code},nextRoom);
  assert.equal(posts, 2);
});
test('a command acknowledgment restores controls if the preceding push arrived while it was pending',async t=>{
  let release;
  const reply = new Promise(resolve => { release = resolve; });
  const f = browser(t, async (_url, options) => {
    if (options.method === 'POST') await reply;
  });
  await settle();
  const command = f.client.send({type:'call',code:f.room.code},f.room);
  f.sockets[0].emit(f.state);
  assert.equal(f.statuses.at(-1), 'reconnecting');
  release();
  await command;
  assert.equal(f.client.hasPending(), false);
  assert.equal(f.statuses.at(-1), 'connected');
});
test('reload restores a persisted pending action automatically without another tap',async t=>{
  const pending=commandEnvelope({type:'call',code:'ABC234'},{version:4,handStartedAt:123});let delivered;
  const f=browser(t,async(url,o)=>{if(o.method==='POST'){delivered=JSON.parse(o.body);return {data:{code:'ABC234',version:5}};}});
  f.stored.set('dunzo-club-command:'+host,JSON.stringify(pending));
  await settle();assert.equal(delivered.commandId,pending.commandId);assert.equal(f.client.hasPending(),false);
  assert.ok(f.notices.some(n=>n.includes('confirmed')));
});
test('presence expires, survives restart and honors another device or HTTP fallback lease',()=>{
  const peer={playerId:host,lastSeenAt:1000};
  assert.equal(presenceView([peer],{},1001).connected.has(host),true);
  assert.equal(presenceView([peer],{},1000+PRESENCE_LEASE_MS).connected.has(host),false);
  assert.equal(presenceView([peer,{playerId:host,lastSeenAt:9000}],{},17000).connected.has(host),true);
  assert.equal(presenceView([],{[host]:10000},17000).connected.has(host),true);
  assert.equal(presenceView([],{},17000).deadline,Infinity);
});
test('missed turn expires normally; old unaccepted action cannot execute in the next hand',async()=>{
  const storage=new MemoryStorage(), service=new TableService(storage);
  let r=(await service.execute(host,commandEnvelope({type:'create',name:'Host',timer:10}),1000)).snapshot;
  await service.execute(friend,commandEnvelope({type:'join',code:r.code,name:'Friend'}),1001);
  r=await service.snapshot(host,r.code);
  r=(await service.execute(host,commandEnvelope({type:'deal',code:r.code},r),2000)).snapshot;
  const actor=r.turn===host?host:friend, own=await service.snapshot(actor,r.code);
  const stale=commandEnvelope({type:own.legal.call?'call':'check',code:r.code},own);
  await service.advance(r.deadline+1);
  await assert.rejects(service.execute(actor,stale,r.deadline+2),/betting decision has changed/i);
  const latest=await service.snapshot(actor,r.code);
  assert.equal(latest.players.find(p=>p.id===actor).away,false);
  assert.equal(latest.players.find(p=>p.id===actor).left,false);
  const nextAt=Math.max(latest.nextDealAt||0,latest.payoutFinishedAt+5000);
  await service.advance(nextAt);
  let raw=await storage.get('room:'+r.code);
  assert.notEqual(raw.handStartedAt,r.handStartedAt);
  assert.equal(raw.players.find(p=>p.id===actor).inHand,true);
  assert.equal(raw.players.find(p=>p.id===actor).folded,false);
  if(raw.turn!==actor){
    const other=await service.snapshot(raw.turn,r.code);
    await service.execute(raw.turn,commandEnvelope({type:other.legal.call?'call':'check',code:r.code},other),nextAt+1);
  }
  const back=await service.snapshot(actor,r.code);
  assert.ok(back.legal,'Returned player can act on their next turn');
  await service.execute(actor,commandEnvelope({type:back.legal.call?'call':'check',code:r.code},back),nextAt+2);
});

test('healthy pong/chat traffic cannot hide stale state; HTTP recovers within the same hand', async t => {
  let snapshotReads = 0, commandSends = 0;
  const f = browser(t, async (url, options, room) => {
    if (url.startsWith('/api/poker?')) {
      snapshotReads++;
      return { data: { ...room, phase: 'flop', version: 5, turn: host } };
    }
  }, () => commandSends++);
  await settle();
  f.room.phase = 'flop';
  f.sockets[0].emit(f.state);
  f.sockets[0].emit({protocol:4, type:'social', entry:{text:'still connected'}});
  t.mock.timers.tick(3000);
  await settle();
  assert.ok(snapshotReads > 0, 'Independent snapshot audit runs despite healthy pongs');
  assert.equal(f.updates.at(-1).room.version, 5);
  assert.equal(f.updates.at(-1).room.handStartedAt, 123, 'Recovery does not wait for a new hand');
  assert.equal(f.statuses.at(-1), 'connected');
  assert.equal(commandSends, 0, 'Resync never replays a betting action');
  assert.equal(f.client.hasPending(), false);
});

test('a slow lobby does not prevent the known table snapshot from recovering', async t => {
  const f = browser(t, async (url, options, room) => {
    if (url.includes('/api/lobby')) return new Promise(() => {});
    if (url.startsWith('/api/poker?')) return {data:{...room, phase:'turn', version:8}};
  });
  await settle();
  f.room.phase = 'turn';
  f.sockets[0].emit(f.state);
  t.mock.timers.tick(3000);
  await settle();
  assert.equal(f.updates.at(-1).room.version, 8);
  assert.equal(f.statuses.at(-1), 'connected');
});

test('active tables receive periodic HTTP audits even while full socket snapshots keep arriving', async t => {
  let reads = 0;
  const f = browser(t, async (url, options, room) => {
    if (url.startsWith('/api/poker?')) { reads++; return {data:{...room, phase:'river'}}; }
  });
  await settle();
  f.room.phase = 'river';
  f.sockets[0].emit(f.state);
  t.mock.timers.tick(3000);
  await settle();
  const initial = reads;
  for (let i=0; i<4; i++) {
    f.sockets[0].emit(f.state);
    t.mock.timers.tick(3000);
    await settle();
  }
  assert.ok(reads > initial, 'Full-state traffic does not disable the independent audit');
});

test('late older snapshots never roll the published table backwards', async t => {
  const f = browser(t, async () => {});
  await settle();
  f.sockets[0].emit({...f.state, room:{...f.room, version:10}});
  f.sockets[0].emit({...f.state, room:{...f.room, version:8}});
  assert.equal(f.updates.at(-1).room.version, 10);
});
