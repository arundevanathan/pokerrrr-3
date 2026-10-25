'use client';
import { useState, type FormEvent } from 'react';
type Player={id:string;name:string};
export function PlayerLobby({player,players,activeGame,loading,busy,error,onLogin,onOpen,onPractice,onRetry,hasPending}: {
 player:Player|null;players:Player[];activeGame:any;loading:boolean;busy:boolean;error:string;
 onLogin:(id:string,pin:string)=>Promise<void>;onOpen:(settings:any)=>Promise<void>;onPractice:()=>void;onRetry:()=>void;hasPending:boolean;
}) {
 const [selected,setSelected]=useState(''),[pin,setPin]=useState(''),[buyin,setBuyin]=useState(2500),[sb,setSb]=useState(25),[bb,setBb]=useState(50),[rotation,setRotation]=useState(3);
 async function login(event:FormEvent){event.preventDefault();const entered=pin;setPin('');await onLogin(selected,entered)}
 return <section className="setup">
  <div className="eyebrow">YOUR PRIVATE TABLE</div>
  {loading?<p role="status">Loading your table…</p>:!player?<>
   <h2>Welcome back.</h2><p>Choose your name and enter your PIN.</p>
   <form onSubmit={login}>
    <label>Your name<select required value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select your name</option>{players.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>4-digit PIN<input type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="current-password" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))} required/></label>
    <button className="primary full" disabled={busy||!players.length}>Sign in</button>
   </form>{!players.length&&<p>No players have been added yet. Ask the owner to add your player record.</p>}
  </>:<>
   <h2>{activeGame?'A game is running.':'Start the next game.'}</h2>
   {activeGame?<p>{activeGame.players.map((p:any)=>p.name).join(' · ')||'Waiting for players'}<br/>{activeGame.settings.sb} / {activeGame.settings.bb} blinds</p>:<p>Welcome, {player.name}. Anyone can start the game.</p>}
   <form onSubmit={async e=>{e.preventDefault();await onOpen({buyin,sb,bb,rotation})}}>
    {!activeGame&&<><div className="field-row"><label>Small blind<input type="number" min={1} max={100000} value={sb} onChange={e=>setSb(Number(e.target.value))} required/></label><label>Big blind<input type="number" min={sb} max={100000} value={bb} onChange={e=>setBb(Number(e.target.value))} required/></label></div>
    <label>Switch game every<select value={rotation} onChange={e=>setRotation(Number(e.target.value))}>{[2,3,4].map(n=><option key={n} value={n}>{n} completed hands</option>)}</select></label></>}
    {!activeGame?.joined&&<label>Your starting chips<input type="number" min={(activeGame?.settings.bb||bb)*2} max={100000000} value={buyin} onChange={e=>setBuyin(Number(e.target.value))} required/></label>}
    <button className="primary full" disabled={busy}>{busy?'Opening…':activeGame?(activeGame.joined?'Resume game':'Join game'):'Start game'}</button>
   </form>
  </>}
  {error&&<div className="error" role="alert">{error}{hasPending&&<button type="button" onClick={onRetry}>Retry last action</button>}</div>}
  <div className="practice-row"><span>Want a practice hand?</span><button onClick={onPractice}>Practice locally</button></div>
 </section>;
}
export function PinSettings({onChange,busy,error}:{onChange:(oldPin:string,newPin:string)=>Promise<void>;busy:boolean;error:string}) {
 const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState(''),[localError,setLocalError]=useState('');
 return <><h2>Change your PIN.</h2><p>Use four digits. Your other devices will need to sign in again.</p><form onSubmit={async e=>{e.preventDefault();if(next!==confirm){setLocalError('The new PINs do not match');return}setLocalError('');const old=current,fresh=next;setCurrent('');setNext('');setConfirm('');await onChange(old,fresh)}}>
  {[['Current PIN',current,setCurrent],['New PIN',next,setNext],['Confirm new PIN',confirm,setConfirm]].map(([label,value,setter]:any)=><label key={label}>{label}<input type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} minLength={4} autoComplete={label==='Current PIN'?'current-password':'new-password'} value={value} onChange={e=>setter(e.target.value.replace(/\D/g,''))} required/></label>)}
  {(localError||error)&&<p className="error" role="alert">{localError||error}</p>}<button className="primary full" disabled={busy}>Update PIN</button>
 </form></>;
}
