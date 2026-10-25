import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PlayerAuth, hashPin, sessionCookie, validPin } from '../server/player-auth.mjs';
import { nextRaise } from '../lib/client/raise-selection.mjs';
async function fixture(){
 const db=new DatabaseSync(':memory:');
 const sql={exec:(query,...args)=>({toArray:()=>db.prepare(query).all(...args)})};
 // Cloudflare executes .exec immediately; Node's adapter must do the same.
 sql.exec=(query,...args)=>{const rows=db.prepare(query).all(...args);return {toArray:()=>rows}};
 const transaction=work=>{db.exec('BEGIN');try{const result=work();db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}};
 const auth=new PlayerAuth(sql,transaction),id=crypto.randomUUID(),{salt,hash}=await hashPin('0123');
 sql.exec('INSERT INTO players(id,name,pin_salt,pin_hash) VALUES(?,?,?,?)',id,'Friend',salt,hash);
 return {auth,id,sql,db};
}
const request=token=>new Request('https://dunzo.test',{headers:{Cookie:sessionCookie(token).split(';')[0]}});
test('only fixed enabled players can log in; PINs stay hashed and leading zeroes work',async()=>{
 const {auth,id,db}=await fixture();try{
 assert.deepEqual(auth.players(),[{id,name:'Friend'}]);
 for(const pin of ['123','12345','abcd',1234])assert.equal(validPin(pin),false);
 await assert.rejects(auth.login(crypto.randomUUID(),'0123'),/incorrect/);
 const result=await auth.login(id,'0123');assert.equal((await auth.session(request(result.token))).id,id);
 assert.match(sessionCookie(result.token),/HttpOnly; SameSite=Strict/);
 const row=auth.rows('SELECT * FROM players')[0];assert.notEqual(row.pin_hash,'0123');assert.equal(row.pin_hash.length,64);
 }finally{db.close()}
});
test('PIN attempts and lockouts survive a new auth instance',async()=>{
 const {auth,id,sql,db}=await fixture();try{
 for(let i=0;i<5;i++)await assert.rejects(auth.login(id,'9999',1000),/incorrect/);
 const recovered=new PlayerAuth(sql);await assert.rejects(recovered.login(id,'0123',1001),/15 minutes/);
 assert.ok(await recovered.login(id,'0123',1000+15*60000));
 }finally{db.close()}
});
test('sessions recover stable identity on another device; changing PIN revokes old sessions and keeps current login',async()=>{
 const {auth,id,db}=await fixture();try{
 const first=await auth.login(id,'0123'),second=await auth.login(id,'0123');
 assert.notEqual(first.token,second.token);assert.deepEqual(first.player,second.player);
 await assert.rejects(auth.changePin(id,'9999','1234'),/incorrect/);
 const fresh=await auth.changePin(id,'0123','0042');
 assert.equal(await auth.session(request(first.token)),null);assert.equal(await auth.session(request(second.token)),null);
 assert.equal((await auth.session(request(fresh.token))).id,id);
 await assert.rejects(auth.login(id,'0123'),/incorrect/);assert.ok(await auth.login(id,'0042'));
 await auth.logout(request(fresh.token));assert.equal(await auth.session(request(fresh.token)),null);
 }finally{db.close()}
});
test('expired or disabled sessions cannot access a seat',async()=>{
 const {auth,id,sql,db}=await fixture();try{
 const session=await auth.login(id,'0123',1000);
 assert.equal(await auth.session(request(session.token),1000+31*86400000),null);
 sql.exec('UPDATE players SET enabled=0 WHERE id=?',id);
 assert.equal(await auth.session(request(session.token),1001),null);assert.deepEqual(auth.players(),[]);
 }finally{db.close()}
});
test('raise resets for each new opportunity, not repeated snapshots of the same turn',()=>{
 const room={code:'ABC234',handStartedAt:100,phase:'preflop',turn:'me',me:'me',actionSeq:1,currentBet:50,legal:{min:100,max:2500}};
 assert.deepEqual(nextRaise(null,room,1000),{reset:true,amount:100});
 assert.deepEqual(nextRaise(room,{...room,version:99},1000),{reset:false,amount:1000});
 for(const changed of [{handStartedAt:200},{phase:'flop'},{actionSeq:3},{currentBet:100,legal:{min:200,max:2500}}]){
  const next={...room,...changed};assert.equal(nextRaise(room,next,1000).amount,Math.min(next.legal.min,next.legal.max));
 }
 const waiting={...room,turn:'other',legal:null};assert.equal(nextRaise(waiting,room,1000).amount,100);
 assert.equal(nextRaise(room,{...room,legal:{min:100,max:80}},1000).amount,80);
});
