import { TableError } from './table-service.mjs';
const COOKIE = 'dunzo-player-session';
const SESSION_MS = 30 * 86400000;
const ITERATIONS = 100000;
const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
export const validPin = pin => typeof pin === 'string' && /^\d{4}$/.test(pin);
export async function hashPin(pin, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) {
  if (!validPin(pin)) throw new TableError('Enter exactly four digits');
  const key = await crypto.subtle.importKey('raw',encoder.encode(pin),'PBKDF2',false,['deriveBits']);
  const hash = hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:ITERATIONS},key,256));
  return { salt, hash };
}
async function digest(value) { return hex(await crypto.subtle.digest('SHA-256',encoder.encode(value))); }
const safeEqual = (a,b) => { if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0; };
export function sessionCookie(token, secure = true, maxAge = SESSION_MS/1000) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;
}
export class PlayerAuth {
  constructor(sql, transaction = work => work()) {
    this.sql = sql;
    this.transaction = transaction;
    sql.exec(`CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      pin_salt TEXT NOT NULL, pin_hash TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, auth_version INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS player_sessions (
      token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL,
      auth_version INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )`);
    sql.exec('CREATE INDEX IF NOT EXISTS player_sessions_player ON player_sessions(player_id)');
  }
  rows(query,...args) { return this.sql.exec(query,...args).toArray().map(row=>({...row})); }
  players() { return this.rows('SELECT id,name FROM players WHERE enabled=1 ORDER BY name COLLATE NOCASE'); }
  async verify(id,pin,now=Date.now()) {
    const player = this.rows('SELECT * FROM players WHERE id=? AND enabled=1',id)[0];
    if (!player || !validPin(pin)) throw new TableError('Name or PIN is incorrect',401);
    if (player.locked_until>now) throw new TableError('Too many incorrect PINs. Try again in 15 minutes.',429);
    const {hash} = await hashPin(pin,player.pin_salt);
    if (!safeEqual(hash,player.pin_hash)) {
      const failures = player.failed_attempts+1, locked = failures>=5;
      this.sql.exec('UPDATE players SET failed_attempts=?,locked_until=? WHERE id=?',locked?0:failures,locked?now+15*60000:0,id);
      throw new TableError('Name or PIN is incorrect',401);
    }
    this.sql.exec('UPDATE players SET failed_attempts=0,locked_until=0 WHERE id=?',id);
    return player;
  }
  async issue(player,now=Date.now()) {
    const token=hex(crypto.getRandomValues(new Uint8Array(32)));
    this.sql.exec('DELETE FROM player_sessions WHERE expires_at<=?',now);
    this.sql.exec('INSERT INTO player_sessions(token_hash,player_id,auth_version,expires_at) VALUES(?,?,?,?)',await digest(token),player.id,player.auth_version,now+SESSION_MS);
    return { token, player:{id:player.id,name:player.name} };
  }
  async login(id,pin,now=Date.now()) { return this.issue(await this.verify(id,pin,now),now); }
  token(request) { return request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1)||''; }
  async session(request,now=Date.now()) {
    const token=this.token(request);if(!/^[a-f0-9]{64}$/.test(token))return null;
    return this.rows(`SELECT p.id,p.name FROM player_sessions s JOIN players p ON p.id=s.player_id
      WHERE s.token_hash=? AND s.expires_at>? AND p.enabled=1 AND s.auth_version=p.auth_version`,await digest(token),now)[0]||null;
  }
  async logout(request) { const token=this.token(request);if(token)this.sql.exec('DELETE FROM player_sessions WHERE token_hash=?',await digest(token)); }
  async changePin(id,currentPin,newPin,now=Date.now()) {
    const player=await this.verify(id,currentPin,now),{salt,hash}=await hashPin(newPin);
    const token=hex(crypto.getRandomValues(new Uint8Array(32))),tokenHash=await digest(token);
    this.transaction(()=>{
      this.sql.exec('UPDATE players SET pin_salt=?,pin_hash=?,auth_version=auth_version+1 WHERE id=?',salt,hash,id);
      this.sql.exec('DELETE FROM player_sessions WHERE player_id=?',id);
      this.sql.exec('INSERT INTO player_sessions(token_hash,player_id,auth_version,expires_at) VALUES(?,?,?,?)',tokenHash,id,player.auth_version+1,now+SESSION_MS);
    });
    return {token,player:{id:player.id,name:player.name}};
  }
}
