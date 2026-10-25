import { DatabaseSync } from 'node:sqlite';
import { hashPin } from '../server/player-auth.mjs';
import { testPlayers } from '../tests/player-fixtures.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { validateStagingArtifact } from '../lib/staging-artifact.mjs';
import { runApiSuite, localTarget } from '../tests/api.test.mjs';
const base = process.env.POKER_STAGING_TEST_URL || 'http://127.0.0.1:8787';
localTarget(base); validateStagingArtifact();
const external = Boolean(process.env.POKER_STAGING_TEST_URL);
const directory = mkdtempSync(join(tmpdir(),'dunzo-club-test-'));
let server, logs='';
async function stop() {
  if(server&&server.exitCode===null){
    const child=server,exited=once(child,'exit');
    const signal=name=>{try{process.kill(-child.pid,name)}catch{child.kill(name)}};
    signal('SIGTERM');const force=setTimeout(()=>signal('SIGKILL'),5000);
    try{await exited}finally{
      clearTimeout(force);child.stdout?.destroy();child.stderr?.destroy();child.unref();
    }
  }
  server=undefined;
}
async function start() {
  server=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','dist/server/wrangler.json','--local','--persist-to',directory,'--ip','127.0.0.1','--port',String(new URL(base).port||8787),'--inspector-port','0'],{detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_CF_FETCH_ENABLED:'false'}});
  server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk);
  for(let i=0;i<90;i++){
    if(server.exitCode!==null) throw new Error(`Preview exited: ${logs}`);
    try{if((await fetch(new URL('/api/health',base),{signal:AbortSignal.timeout(5000)})).ok)return}catch{}
    await sleep(500);
  }
  throw new Error(`Preview did not become ready: ${logs}`);
}
try {
  if(!external){
    await start();
    await fetch(new URL('/api/players',base)); // Initialize the schema, then seed only offline disposable storage.
    await stop();
    console.log('Stopped schema preview; provisioning disposable players.');
    const files=readdirSync(directory,{recursive:true}).filter(path=>/v3\/do\/.*ClubTable\/[a-f0-9]{64}\.sqlite$/.test(path));
    assert.equal(files.length,1,'Expected one disposable table database');
    const database=new DatabaseSync(join(directory,files[0]));
    try{for(const p of testPlayers){const {salt,hash}=await hashPin(p.pin);database.prepare('INSERT INTO players(id,name,pin_salt,pin_hash) VALUES(?,?,?,?)').run(p.id,p.name,salt,hash)}}finally{database.close()}
    await start();
    console.log('Restarted preview with fixed test players.');
  }
  const health=await fetch(new URL('/api/health',base),{signal:AbortSignal.timeout(5000)}),data=await health.json();
  assert.equal(health.status,200);assert.equal(data.app,'Dunzo Club');assert.equal(data.environment,'staging');assert.equal(data.mode,'multiplayer');assert.equal(data.multiplayerReady,true);assert.match(data.version,/^[a-f0-9]{40}$/);
  const page=await fetch(base),html=await page.text();assert.equal(page.status,200);assert.match(html,/Dunzo Club/);assert.doesNotMatch(html,/Club access code|Room code/);
  for(const asset of ['/manifest.webmanifest','/sw.js','/icon-192.png','/icon-512.png'])assert.equal((await fetch(new URL(asset,base))).status,200,asset);
  await runApiSuite(base,external?undefined:async()=>{await stop();await start()});
  console.log('Built multiplayer Worker smoke passed; no remote resources used.');
} catch(error) { console.error(logs.slice(-12000)); throw error; } finally {await stop();rmSync(directory,{recursive:true,force:true});}
