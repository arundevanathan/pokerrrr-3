import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {commandEnvelope} from '../lib/protocol/poker.mjs';
const base='http://127.0.0.1:8792', directory=mkdtempSync(join(tmpdir(),'dunzo-lab-smoke-'));
let server;
function start(){server=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','dist/server/wrangler.json','--local','--persist-to',directory,'--ip','127.0.0.1','--port','8792','--inspector-port','0'],{detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,CLOUDFLARE_CF_FETCH_ENABLED:'false',WRANGLER_SEND_METRICS:'false'}});server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);}
let logs='';start();
async function stop(){if(server.exitCode!==null)return;const closed=new Promise(r=>server.once('exit',r));process.kill(-server.pid,'SIGTERM');await closed;}
async function ready(){for(let i=0;i<90;i++){try{if((await request('/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw new Error('Preview not ready');}
const request=(path,options={})=>fetch(base+path,{...options,headers:{...options.headers,Connection:'close'},signal:AbortSignal.timeout(15000)});
const body=value=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
try{
  await ready();
  const production=process.env.POKER_LAB_PRODUCTION==='1';
  if(production){assert.equal((await request('/test-lab')).status,404);assert.equal((await request('/test-lab/table')).status,404);assert.equal((await request('/api/test-lab/create',body({}))).status,404);console.log('PASS test lab is unavailable in production.');}
  else{
    assert.equal((await request('/test-lab')).status,200);
    const create=async cfg=>{const r=await request('/api/test-lab/create',body(cfg));const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
    const a=await create({scenario:'betting',players:4,game:'PLO5',seed:'server-42'}),b=await create({scenario:'rabbit',players:6,game:'NLH',seed:'other'});
    assert.notEqual(a.session,b.session);
    const prefix=`/api/test-lab/session/${a.session}/0`, prefixB=`/api/test-lab/session/${b.session}/0`;
    const boot=await request(prefix+'/bootstrap',{method:'POST'});assert.equal(boot.status,200);const cookie=boot.headers.get('set-cookie').split(';')[0];
    assert.match(boot.headers.get('set-cookie'),new RegExp('Path='+prefix+'/;'));
    const session=await (await request(prefix+'/api/session',{headers:{Cookie:cookie}})).json();assert.ok(session.player);
    const get=async()=>{const r=await request(prefix+'/api/poker?code=LAB222',{headers:{Cookie:cookie}});assert.equal(r.status,200);return r.json();};
    let room=await get();assert.equal(room.game,'PLO5');assert.equal(room.players.length,4);assert.equal(room.me,session.player.id);
    const normal=await (await request('/api/session',{headers:{Cookie:cookie}})).json();assert.equal(normal.player,null);
    const other=await (await request(prefixB+'/api/session',{headers:{Cookie:cookie}})).json();assert.equal(other.player,null);
    const nativeCookie=await request(prefix+'/api/session',{headers:{Cookie:cookie.replace('dunzo-test-lab=','dunzo-player-session=')}});assert.equal((await nativeCookie.json()).player,null);
    const at=room.players.find(p=>p.id===room.me).stack, input=commandEnvelope({type:room.legal.call?'call':'check',code:room.code},room);
    const first=await request(prefix+'/api/poker',{...body(input),headers:{...body(input).headers,Cookie:cookie}});assert.equal(first.status,200);const accepted=await first.json();
    const retry=await request(prefix+'/api/poker',{...body(input),headers:{...body(input).headers,Cookie:cookie}});assert.equal(retry.status,200);assert.deepEqual((await retry.json()).ack,accepted.ack);
    room=await get();assert.ok(room.players.find(p=>p.id===room.me).stack<=at);
    const step=await request(prefix+'/control',{...body({type:'step'}),headers:{'Content-Type':'application/json',Cookie:cookie}});assert.equal(step.status,200);
    const beforeRestart=await get();await stop();start();await ready();const restored=await get();assert.equal(restored.version,beforeRestart.version);assert.deepEqual(restored.players.map(p=>p.stack),beforeRestart.players.map(p=>p.stack));
    const bootB=await request(prefixB+'/bootstrap',{method:'POST'}),cookieB=bootB.headers.get('set-cookie').split(';')[0];
    const history=await request(prefixB+'/api/hand-history?code=LAB222&format=json',{headers:{Cookie:cookieB}});assert.equal(history.status,200);assert.equal((await history.json()).hands[0].rabbitHunt.board.length,5);
    const completed=await create({scenario:'closed',players:3}),endPrefix=`/api/test-lab/session/${completed.session}/0`;
    const endBoot=await request(endPrefix+'/bootstrap',{method:'POST'}),endCookie=endBoot.headers.get('set-cookie').split(';')[0];
    const endedLobby=await (await request(endPrefix+'/api/lobby',{headers:{Cookie:endCookie}})).json();assert.equal(endedLobby.activeGame.code,'LAB222');assert.equal(endedLobby.activeGame.phase,'closed');
    const hostile=await request('/api/test-lab/create',{...body({}),headers:{'Content-Type':'application/json',Origin:'https://other.test'}});assert.equal(hostile.status,403);
    assert.equal((await request('/__test-lab/setup',body({}))).status,404);
    console.log('PASS isolated real-Worker lab: scoped identities/cookies, independent sessions, chip actions, durable duplicate receipt, scenario history, origin and internal-route guards.');
  }
}catch(e){console.error(logs.slice(-6000));throw e;}finally{try{process.kill(-server.pid,'SIGTERM');}catch{}server.stdout.destroy();server.stderr.destroy();server.unref();setTimeout(()=>{try{rmSync(directory,{recursive:true,force:true});}catch{}},500).unref();}
