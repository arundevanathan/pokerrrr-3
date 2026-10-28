'use client';
import {useEffect,useRef,useState} from 'react';
import {SCENARIOS,QUICK,presets,normalizeConfig,LAB_VERSION} from '../../lib/test-lab/scenarios.mjs';
type Review={status:'passed'|'flagged';note:string;at:string;report:any};
export function TestLab(){
  const [config,setConfig]=useState<any>(normalizeConfig({})),[active,setActive]=useState<any>(null),[mode,setMode]=useState('quick'),[custom,setCustom]=useState<string[]>(QUICK),
    [backend,setBackend]=useState('local'),[device,setDevice]=useState('portrait'),[src,setSrc]=useState(''),[state,setState]=useState<any>(null),[session,setSession]=useState(''),
    [busy,setBusy]=useState(false),[error,setError]=useState(''),[fault,setFault]=useState('none'),[note,setNote]=useState(''),[reviews,setReviews]=useState<Record<string,Review>>({}),
    [build,setBuild]=useState<any>(null),[running,setRunning]=useState(false),[full,setFull]=useState(false),[copied,setCopied]=useState('');
  const frame=useRef<HTMLIFrameElement>(null), activeRef=useRef<any>(null), runRef=useRef(0);
  const pack=mode==='quick'?QUICK:mode==='full'?SCENARIOS.filter(s=>s.id!=='simulation').map(s=>s.id):mode==='custom'?custom:SCENARIOS.map(s=>s.id);
  const scenario:any=SCENARIOS.find(s=>s.id===config.scenario)!;
  const key=(cfg:any)=>`${build?.revision||'unversioned'}:${LAB_VERSION}:${JSON.stringify(cfg)}:${backend}:${device}`;
  const send=(type:string,data:any={})=>frame.current?.contentWindow?.postMessage({type,...data},location.origin);
  const mutate=(values:any)=>setConfig((old:any)=>normalizeConfig({...old,...values}));
  useEffect(()=>{
    const q=new URLSearchParams(location.search);
    if(window.innerWidth<=800)setDevice('actual');
    try {if(q.get('config')){const cfg=normalizeConfig(JSON.parse(q.get('config')!));setConfig(cfg);if(cfg.scenario==='simulation')setMode('simulate');}
      const saved=JSON.parse(localStorage.getItem('dunzo-test-lab-reviews')||'{}');setReviews(saved);
    }catch{}
    fetch('/build-info.json',{cache:'no-store'}).then(r=>r.json()).then(setBuild).catch(()=>{});
    const message=(event:MessageEvent)=>{
      if(event.origin!==location.origin||event.source!==frame.current?.contentWindow)return;
      if(event.data?.type==='lab-state'){setState(event.data);if(typeof event.data.running==='boolean')setRunning(event.data.running);if(event.data.error)setError(event.data.error);}
      if(event.data?.type==='lab-controls')setFull(false);
      if(event.data?.type==='lab-exit'){setSrc('');setActive(null);setFull(false);}
      if(event.data?.type==='lab-fault-consumed')setCopied('Accepted HTTP reply dropped. The client must confirm via its normal recovery path.');
    };
    window.addEventListener('message',message);return()=>window.removeEventListener('message',message);
  },[]);
  useEffect(()=>{if(!running||backend!=='server'||!session)return;const timer=setInterval(()=>void serverStep(true),1200);return()=>clearInterval(timer);},[running,session,backend]);
  async function launch(input=config,kind=backend){
    const request=++runRef.current,cfg=normalizeConfig(input);setBusy(true);setError('');setRunning(false);setState(null);setNote('');setFault('none');
    try{
      let sessionId='';
      if(cfg.scenario==='recovery')kind='server';
      if(kind==='server'){
        const response=await fetch('/api/test-lab/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});
        const data:any=await response.json();if(!response.ok)throw new Error(data.error);sessionId=data.session;
        const bootstrap=await fetch(`/api/test-lab/session/${sessionId}/${cfg.viewer}/bootstrap`,{method:'POST'});if(!bootstrap.ok)throw new Error('Could not open the synthetic player identity');
      }
      if(request!==runRef.current)return;
      setSession(sessionId);setConfig(cfg);setActive(cfg);activeRef.current=cfg;setBackend(kind);
      const q=new URLSearchParams({config:JSON.stringify(cfg)});
      if(sessionId){q.set('session',sessionId);q.set('viewer',String(cfg.viewer));}
      q.set('reload',String(Date.now()));setSrc('/test-lab/table?'+q);
    }catch(e:any){if(request===runRef.current)setError(e.message);}finally{if(request===runRef.current)setBusy(false);}
  }
  async function serverStep(auto=false){
    if(!session||!activeRef.current)return;
    try{const r=await fetch(`/api/test-lab/session/${session}/${activeRef.current.viewer}/control`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'step',auto})});if(!r.ok)throw new Error(((await r.json()) as any).error);}
    catch(e:any){setError(e.message);setRunning(false);}
  }
  function changeFault(value:string){setFault(value);send('lab-fault',{fault:value});}
  function move(delta:number){const index=pack.indexOf((active||config).scenario),next=pack[Math.max(0,Math.min(pack.length-1,index+delta))];if(next)void launch({...config,scenario:next});}
  function report(){return {schemaVersion:LAB_VERSION,build,configuration:active,backend,device,viewport:{width:window.innerWidth,height:window.innerHeight},
    frameViewport:frame.current?{width:frame.current.clientWidth,height:frame.current.clientHeight}:null,fault,checkpoint:state,note,userAgent:navigator.userAgent,at:new Date().toISOString()};}
  function record(status:'passed'|'flagged'){
    if(!active||!state||busy)return;if(status==='flagged'&&!note.trim()){setError('Add a short description before flagging this checkpoint.');return;}
    const next={...reviews,[key(active)]:{status,note,at:new Date().toISOString(),report:report()}};setReviews(next);localStorage.setItem('dunzo-test-lab-reviews',JSON.stringify(next));setError('');setCopied(status==='passed'?'Marked passed. Choose Next when ready.':'Issue saved with its scenario and build.');
  }
  function download(){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({current:active?report():null,reviews},null,2)],{type:'application/json'}));a.href=url;a.download='dunzo-test-lab-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function copy(){try{await navigator.clipboard.writeText(JSON.stringify(report(),null,2));setCopied('Report copied. Attach a phone screenshot if needed.');}catch{download();setCopied('Clipboard unavailable; report downloaded.');}}
  function permalink(){const q=new URLSearchParams({config:JSON.stringify(active||config)});return location.origin+'/test-lab?'+q;}
  const preset=presets.find(d=>d.id===device)!, currentReview=active?reviews[key(active)]:null;
  const statuses=pack.map(id=>reviews[key(normalizeConfig({...config,scenario:id}))]?.status),passed=statuses.filter(s=>s==='passed').length,flagged=statuses.filter(s=>s==='flagged').length;
  return <main className={`test-lab ${full?'lab-fullscreen':''}`}>
    <header className="lab-header"><div><a href="/">← Staging home</a><h1>Test UI <span>STAGING LAB</span></h1><p>Repeatable scenarios · Real table UI · Isolated test data</p></div><small>Build {build?.revision||'loading…'}</small></header>
    <div className="lab-layout"><aside className="lab-sidebar">
      <section className="lab-card"><h2>Review setup</h2>
        <label>Mode<select aria-label="Mode" value={mode} onChange={e=>{setMode(e.target.value);if(e.target.value==='simulate')mutate({scenario:'simulation'});}}><option value="quick">Quick Review · 12 scenarios</option><option value="full">Full Review · {SCENARIOS.length-1} scenarios</option><option value="choose">Choose Scenario</option><option value="custom">Custom Review</option><option value="simulate">Simulate Game</option></select></label>
        <label>Scenario<select aria-label="Scenario" value={config.scenario} onChange={e=>mutate({scenario:e.target.value})}>{SCENARIOS.map(s=><option key={s.id} value={s.id}>{s.group} · {s.title}</option>)}</select></label>
        {mode==='custom'&&<details><summary>Select review scenarios ({custom.length})</summary><div className="lab-check-list">{SCENARIOS.filter(s=>s.id!=='simulation').map(s=><label key={s.id}><input type="checkbox" checked={custom.includes(s.id)} onChange={e=>setCustom(old=>e.target.checked?[...old,s.id]:old.filter(id=>id!==s.id))}/>{s.title}</label>)}</div></details>}
        <div className="lab-fields"><label>Total players<select aria-label="Total players" value={config.players} onChange={e=>mutate({players:Number(e.target.value)})}>{[2,3,4,5,6,7,8].map(n=><option key={n}>{n}</option>)}</select></label><label>Game<select aria-label="Game" value={config.game} onChange={e=>mutate({game:e.target.value,games:[e.target.value]})}>{['NLH','PLO4','PLO5'].map(g=><option key={g}>{g}</option>)}</select></label></div>
        {scenario.players||scenario.game||scenario.minPlayers?<small className="lab-hint">This scenario requires {scenario.players?`${scenario.players} players`:scenario.minPlayers?`at least ${scenario.minPlayers} players`:''}{scenario.game?` · ${scenario.game}`:''}. Applied automatically.</small>:null}
        {config.scenario==='run-twice'&&config.game==='PLO5'&&config.players===8&&<small className="lab-hint">Eight-player PLO5 shares the flop so enough undealt cards remain for two runs.</small>}
        <label>Your viewpoint<select aria-label="Your viewpoint" value={config.viewer} onChange={e=>mutate({viewer:Number(e.target.value)})}>{Array.from({length:config.players},(_,i)=><option key={i} value={i}>Player {i+1}{i===0?' · host':''}</option>)}</select></label>
        <label>Viewport<select aria-label="Viewport" value={device} onChange={e=>setDevice(e.target.value)}>{presets.map(d=><option key={d.id} value={d.id}>{d.title}{d.width?` · ${d.width}×${d.height}`:''}</option>)}</select></label>
        <label>Environment<select aria-label="Environment" value={backend} onChange={e=>{setBackend(e.target.value);setSrc('');setActive(null);setRunning(false);}}><option value="local">Local · paused visual scenarios</option><option value="server">Server · isolated multiplayer / recovery</option></select></label>
        <details><summary>Advanced settings</summary><label>Seed<input value={config.seed} maxLength={64} onChange={e=>mutate({seed:e.target.value})}/></label><div className="lab-fields"><label>Big blind<input type="number" min={2} max={100000} step={2} value={config.bb} onChange={e=>mutate({bb:Number(e.target.value)})}/></label><label>Buy-in<input type="number" min={config.bb*2} max={100000000} value={config.buyin} onChange={e=>mutate({buyin:Number(e.target.value)})}/></label></div><label>Turn timer<select aria-label="Turn timer" value={config.timer} onChange={e=>mutate({timer:Number(e.target.value)})}>{[10,15,20,30].map(n=><option key={n} value={n}>{n}s</option>)}</select></label><label>Animation / clock speed<select aria-label="Animation / clock speed" value={config.speed} onChange={e=>mutate({speed:Number(e.target.value)})}>{[.25,.5,1,2].map(n=><option key={n} value={n}>{n}×</option>)}</select></label><label>Rotate variants every<select aria-label="Rotate variants every" value={config.rotation} onChange={e=>mutate({rotation:Number(e.target.value)})}>{[2,3,4].map(n=><option key={n} value={n}>{n} hands</option>)}</select></label><fieldset><legend>Simulation variants</legend>{['NLH','PLO4','PLO5'].map(g=><label className="lab-check" key={g}><input type="checkbox" checked={config.games.includes(g)} onChange={e=>{const games=e.target.checked?[...config.games,g]:config.games.filter((v:string)=>v!==g);if(games.length)mutate({games});}}/>{g}</label>)}</fieldset></details>
        <button className="lab-primary" disabled={busy||mode==='custom'&&!custom.length} onClick={()=>void launch({...config,scenario:mode==='simulate'?'simulation':mode==='quick'||mode==='full'||mode==='custom'?pack[0]:config.scenario})}>{busy?'Opening…':mode==='simulate'?'Start Simulation':mode==='choose'?'Load Scenario':'Start Review'}</button>
        <button disabled={busy} onClick={()=>void launch(config)}>Apply / reset selected scenario</button>
      </section>
      <section className="lab-card"><h2>Review progress</h2><p>{passed} passed · {flagged} flagged · {pack.length-passed-flagged} unreviewed</p><progress max={Math.max(1,pack.length)} value={passed+flagged}/><div className="lab-scenario-list">{pack.map(id=>{const spec=SCENARIOS.find(s=>s.id===id)!;const status=reviews[key(normalizeConfig({...config,scenario:id}))]?.status;return <button key={id} className={active?.scenario===id?'active':''} onClick={()=>void launch({...config,scenario:id})}>{status==='passed'?'✓':status==='flagged'?'!':'○'} {spec.title}</button>;})}</div><button onClick={download}>Download review report</button><button onClick={()=>{setReviews({});localStorage.removeItem('dunzo-test-lab-reviews');}}>Clear this browser’s review marks</button></section>
    </aside>
    <section className="lab-workspace">
      <section className="lab-card lab-current"><div><h2>{active?SCENARIOS.find(s=>s.id===active.scenario)?.title:'Ready for inspection'}</h2><p>{active?SCENARIOS.find(s=>s.id===active.scenario)?.check:'Choose a review pack or scenario. Each case waits for your inspection.'}</p></div><span className={`lab-status ${currentReview?.status||''}`}>{currentReview?.status||'Unreviewed'}</span></section>
      {error&&<p className="lab-error" role="alert">{error}</p>}
      <div className="lab-controls"><button disabled={!src||busy} onClick={()=>move(-1)}>← Previous</button><button disabled={!src||busy} onClick={()=>{if(backend==='local')send('lab-play',{running:true,replay:true});else void launch(active);}}>Replay transition</button><button disabled={!src||busy} onClick={()=>{if(backend==='local')send('lab-step');else void serverStep();}}>Step</button><button disabled={!src} onClick={()=>{if(backend==='local')send('lab-play',{running:!running});setRunning(!running);}}>{running?'Pause':'Play / bots'}</button><button disabled={!src||busy} onClick={()=>move(1)}>Next →</button><button disabled={!src} onClick={()=>setFull(!full)}>{full?'Show test controls':'Full viewport'}</button></div>
      {state&&<div className="lab-checkpoint"><span>{state.backend==='server'?'Real server clock':`Checkpoint ${(state.index||0)+1} / ${state.total}`} · {state.label||state.expected?.phase} · {state.connection||state.expected?.variant}</span>{backend==='local'&&<><input aria-label="Checkpoint" type="range" min={0} max={Math.max(0,(state.total||1)-1)} value={state.index||0} onChange={e=>send('lab-point',{index:Number(e.target.value)})}/><button onClick={()=>send('lab-settle')}>Skip to settled time</button></>}</div>}
      {backend==='server'&&session&&<section className="lab-card"><h3>Connection faults</h3><p>The table below uses the real client, HTTP, WebSockets and durable storage. Its turn timer continues during a fault.</p><label>Fail this player’s connection<select aria-label="Fail this player’s connection" value={fault} onChange={e=>changeFault(e.target.value)}><option value="none">Healthy / restore connectivity</option><option value="http">HTTP unavailable · socket works</option><option value="socket">Socket unavailable · HTTP works</option><option value="both">Both unavailable</option><option value="lost-reply">Drop next accepted HTTP action reply</option></select></label><div className="lab-controls"><button onClick={()=>{const url=new URL(src,location.origin);url.searchParams.set('fault',fault);url.searchParams.set('reload',String(Date.now()));setSrc(url.pathname+url.search);}}>Reload player with current fault</button><button onClick={()=>window.open(`/test-lab/table?session=${session}&viewer=${(active.viewer+1)%active.players}`,'_blank','noopener')}>Open another player</button><button onClick={()=>{void navigator.clipboard.writeText(location.origin+`/test-lab/table?session=${session}&viewer=${(active.viewer+1)%active.players}`).then(()=>setCopied('Second-player link copied; open it on another phone.'));}}>Copy second-phone link</button></div></section>}
      <div className="lab-preview-scroll"><div className="lab-preview" style={{width:preset.width||'100%',height:preset.height||'min(844px, 90dvh)'}}>{src?<iframe key={src} ref={frame} title="Dunzo Club test table" src={src} allow="clipboard-write; fullscreen"/>:<div className="lab-placeholder"><strong>A complete table, ready to inspect.</strong><p>Start a review to load the actual game UI with a repeatable scenario.</p><p>Local cases are frozen. Server sessions run in isolated test storage.</p></div>}</div></div>
      {src&&<section className="lab-card"><h3>Inspection notes</h3><p>{backend==='local'?'Local simulation validates visuals and engine outcomes. Connection, server persistence and native keyboard behaviour need their corresponding tests.':'Server mode validates real persistence and transport recovery. Use another phone for presence and native network-switching checks.'}</p><textarea placeholder="What looks wrong? Include what you expected." value={note} onChange={e=>setNote(e.target.value)} rows={3}/><div className="lab-controls"><button className="lab-primary" disabled={!state||busy} onClick={()=>record('passed')}>Looks good</button><button disabled={!state||busy} onClick={()=>record('flagged')}>Flag issue</button><button onClick={()=>void copy()}>Copy report</button><button onClick={download}>Download JSON</button><button onClick={()=>void navigator.clipboard.writeText(permalink()).then(()=>setCopied('Reproduction link copied.'))}>Copy scenario link</button></div><p role="status">{copied}</p>{state?.expected&&<details><summary>Engine outcome and accounting</summary><pre>{JSON.stringify(state.expected,null,2)}</pre></details>}<details><summary>Snapshot capture</summary><p>Use your phone’s screenshot controls or browser screenshot tools. Reports capture the reproducible configuration and checkpoint; they do not claim to contain a screenshot.</p></details></section>}
    </section></div>
  </main>;
}
