import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { pathToFileURL } from 'node:url';
import { commandEnvelope, PROTOCOL_VERSION } from '../lib/protocol/poker.mjs';
import { testPlayers } from './player-fixtures.mjs';
const request=(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(10_000)});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function localTarget(base) {
  const url = new URL(base);
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('API tests require an explicit disposable loopback HTTP server. Never test live balances.');
  return url;
}
export async function runApiSuite(base, restart) {
  localTarget(base);
  const [host,friend,observer]=testPlayers.map(p=>p.id),cookies=new Map();
  const denied=await request(new URL('/api/poker',base));assert.equal(denied.status,401);await denied.arrayBuffer();
  const cross=await request(new URL('/api/login',base),{method:'POST',headers:{Origin:'https://other.test','Content-Type':'application/json'},body:JSON.stringify({playerId:host,pin:'0123'})});assert.equal(cross.status,403);await cross.arrayBuffer();
  const roster=await (await request(new URL('/api/players',base))).json();assert.equal(roster.players.length,3);assert.ok(!JSON.stringify(roster).includes('pin_hash'));
  async function login(id,pin){
    const result=await request(new URL('/api/login',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerId:id,pin})});
    assert.equal(result.status,200);cookies.set(id,result.headers.get('set-cookie').split(';')[0]);return result.json();
  }
  for(const p of testPlayers)await login(p.id,p.pin);
  const cookie=cookies.get(host);
  for (const headers of [{Origin:new URL(base).origin}, {Cookie:cookie,Origin:'https://other.test'}]) {
    const status = await new Promise((resolve,reject) => {
      const socket = new WebSocket(new URL('/api/poker/socket',base).href.replace('http:','ws:'),{headers});
      socket.once('unexpected-response',(_,response)=>{response.resume();resolve(response.statusCode);socket.terminate()});
      socket.once('open',()=>{socket.terminate();reject(new Error('Unauthorized socket opened'))});
      socket.on('error',()=>{});
    });
    assert.equal(status,headers.Cookie?403:401);
  }
  async function api(token, input, code) {
    const res = await request(new URL(input ? '/api/poker' : `/api/poker?code=${code}`, base), {method:input?'POST':'GET',headers:{Cookie:cookies.get(token),...(input&&{'Content-Type':'application/json'})},...(input&&{body:JSON.stringify(input)})});
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(`${res.status}: ${data.error}`), {status:res.status});
    return data;
  }
  const create = commandEnvelope({type:'create',name:'Integration Host',rotation:2,seats:8,sb:5,bb:10,buyin:1000});
  let room = await api(host, create), code = room.code;
  assert.equal((await api(host,create)).code,code);
  await assert.rejects(api(friend,commandEnvelope({type:'create',name:'Duplicate'})),/already running/);
  await assert.rejects(api(observer,null,code),/Join/);
  await api(friend, commandEnvelope({type:'join',code,name:'Integration Friend',buyin:1750}));
  room = await api(host,null,code);
  const peers=[];
  async function peer(token) {
    const messages=[];
    const socket=new WebSocket(new URL('/api/poker/socket',base).href.replace('http:','ws:'),{handshakeTimeout:10_000,headers:{Cookie:cookies.get(token),Origin:new URL(base).origin}});
    peers.push(socket);
    socket.on('message',value=>messages.push(JSON.parse(value.toString())));
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)});
    await waitFor(()=>messages.find(m=>m.type==='state'));
    return {socket,messages};
  }
  async function waitFor(check, ms=5000) {
    const start=Date.now();while(Date.now()-start<ms){const value=check();if(value)return value;await sleep(25)}throw new Error('Timed out waiting for server push');
  }
  try {
    const unseated=await peer(observer);
    assert.equal(unseated.messages[0].room,null);assert.equal(unseated.messages[0].lobby.activeGame.code,code);
    const h=await peer(host), f=await peer(friend);
    console.log('Verified player login, shared lobby and private socket snapshots.');
    const reload=commandEnvelope({type:'rebuy',code,amount:100},room);
    const accepted=await api(host,reload); const retried=await api(host,reload);
    assert.deepEqual(accepted.ack,retried.ack);assert.equal(retried.players.find(p=>p.id===host).buyins,1100);
    await waitFor(()=>f.messages.find(m=>m.room?.version===accepted.version));
    room=await api(host,null,code);
    if(restart){
      peers.forEach(s=>s.close()); await restart();
      const restored=await api(host,null,code);assert.equal(restored.version,room.version);assert.deepEqual(restored.players,room.players);
    }
    const liveHost=restart?await peer(host):h, liveFriend=restart?await peer(friend):f,liveObserver=restart?await peer(observer):unseated;
    const oldCookie=cookies.get(host);
    await login(host,'0123');const secondDevice=cookies.get(host),otherDevice=await peer(host);
    const changed=await request(new URL('/api/pin',base),{method:'POST',headers:{Cookie:oldCookie,'Content-Type':'application/json'},body:JSON.stringify({currentPin:'0123',newPin:'0042'})});
    assert.equal(changed.status,200);assert.notEqual(secondDevice,oldCookie);cookies.set(host,changed.headers.get('set-cookie').split(';')[0]);
    const revoked=await (await request(new URL('/api/session',base),{headers:{Cookie:secondDevice}})).json();assert.equal(revoked.player,null);
    await waitFor(()=>otherDevice.socket.readyState!==WebSocket.OPEN);assert.equal(liveHost.socket.readyState,WebSocket.OPEN);
    const resumed=await login(host,'0042');assert.equal(resumed.player.id,host);
    assert.equal((await api(host,null,code)).me,host);
    console.log('Verified PIN rotation, other-device revocation and current-session continuity.');
    const games=new Set();
    for(let i=0;i<7;i++){
      room=await api(host,null,code);
      if(room.phase==='showdown') await sleep(Math.max(0,room.payoutFinishedAt-Date.now()+50));
      // Pause prevents auto-deal racing this deterministic integration sequence.
      if(!room.paused){room=await api(host,commandEnvelope({type:'pause',code},room));}
      room=await api(host,commandEnvelope({type:'deal',code},room)); games.add(room.game);
      await waitFor(()=>liveFriend.messages.find(m=>m.room?.version===room.version));
      const privateHost=await api(host,null,code),privateFriend=await api(friend,null,code);
      assert.equal(privateHost.players.find(p=>p.name==='Integration Friend').cards,undefined);
      assert.equal(privateFriend.players.find(p=>p.name==='Integration Host').cards,undefined);
      let steps=0;
      while(['preflop','flop','turn','river'].includes(room.phase)){
        assert.ok(++steps<40); const actor=room.turn===host?host:friend,own=await api(actor,null,code);
        room=await api(actor,commandEnvelope({type:i===2?(own.legal.call?'call':'check'):'fold',code},own));
        room=await api(host,null,code);
      }
      assert.equal(room.phase,'showdown');assert.equal(room.players.reduce((n,p)=>n+p.stack,0),2850);
      await assert.rejects(api(host,commandEnvelope({type:'deal',code},room)),/payouts/);
    }
    assert.equal(games.size,3);assert.equal(room.history.length,7);
    // No incoming requests or socket pings: the alarm alone must finish a turn.
    await sleep(Math.max(0,room.payoutFinishedAt-Date.now()+50));
    room=await api(host,commandEnvelope({type:'deal',code},room));
    const dealtVersion=room.version;
    const timed=await waitFor(()=>liveHost.messages.find(m=>m.room?.version>dealtVersion&&m.room?.phase==='showdown'),45_000);
    assert.equal(timed.room.completed,8);
    room=await api(host,null,code);
    room=await api(host,commandEnvelope({type:'end',code},room));assert.equal(room.phase,'closed');
    assert.equal(room.players.reduce((n,p)=>n+p.cashout,0),2850);
    for(const message of liveHost.messages) assert.ok(!JSON.stringify(message).includes(friend));
    for(const message of liveFriend.messages) assert.ok(!JSON.stringify(message).includes(host));
    const next=await api(friend,commandEnvelope({type:'create',name:'Ignored name'}));
    await waitFor(()=>liveObserver.messages.find(m=>m.lobby?.activeGame?.code===next.code));
    assert.equal(next.players[0].id,friend);assert.equal(next.players[0].name,'Integration Friend');assert.notEqual(next.code,code);assert.equal((await api(host,null,code)).history.length,8);
    assert.equal((await api(friend,commandEnvelope({type:'join',code,name:'Existing friend'}))).phase,'closed');
    await api(friend,commandEnvelope({type:'end',code:next.code},next));
    const logout=await request(new URL('/api/logout',base),{method:'POST',headers:{Cookie:cookies.get(host),'Content-Type':'application/json'},body:'{}'});assert.equal(logout.status,200);
    await assert.rejects(api(host,null,code),/sign in/);
    console.log('PIN multiplayer passed: fixed roster, cookie identity, shared lobby, private push, device recovery, PIN change/revocation, retries, restart, 8 hands, 3 variants, independent alarm and retained sessions.');
  } finally { peers.forEach(s=>s.terminate()); }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.env.POKER_TEST_URL)throw new Error('Set POKER_TEST_URL for a disposable local server seeded with tests/player-fixtures.mjs.');
  await runApiSuite(process.env.POKER_TEST_URL);
}
