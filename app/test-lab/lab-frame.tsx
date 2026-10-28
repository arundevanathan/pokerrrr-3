'use client';
import {useEffect,useState} from 'react';
import Home from '../page';
import {installLabNetwork} from '../../lib/test-lab/network';
export function LabFrame(){
  const [ready,setReady]=useState(false),[server,setServer]=useState(false),[error,setError]=useState(''),[tools,setTools]=useState(false);
  const post=(type:string,data:any={})=>window.postMessage({type,...data},location.origin);
  useEffect(()=>{const listener=(e:MessageEvent)=>{if(e.origin===location.origin&&e.source===window&&['lab-controls','lab-exit'].includes(e.data?.type))setTools(true);};window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);},[]);
  useEffect(()=>{
    const query=new URLSearchParams(location.search), session=query.get('session');
    if(!session){
      const native=window.fetch.bind(window);
      window.fetch=async (input,init)=>{const url=new URL(input instanceof Request?input.url:String(input),location.href);if(url.origin===location.origin&&url.pathname.startsWith('/api/'))return Response.json({error:'Local simulation: use Server mode for this operation'},{status:409});return native(input,init);};
      setReady(true);return()=>{window.fetch=native;};
    }
    const adapter=installLabNetwork(session,Number(query.get('viewer')||0),query.get('fault')||'none');
    let active=true;setServer(true);
    adapter.fetch(adapter.base+'/bootstrap',{method:'POST'}).then(async response=>{if(!response.ok)throw new Error(((await response.json()) as any).error);if(active)setReady(true);}).catch(e=>setError(e.message));
    return ()=>{active=false;adapter.cleanup();};
  },[]);
  return <>{tools&&<div className="lab-standalone-tools"><strong>Test Lab · isolated session</strong><div><button onClick={()=>setTools(false)}>Back to table</button>{!server&&<><button onClick={()=>post('lab-step')}>Step</button><button onClick={()=>post('lab-play',{running:true})}>Play</button><button onClick={()=>post('lab-play',{running:false})}>Pause</button></>}<button onClick={()=>location.href='/test-lab'}>Open Test UI</button></div></div>}{error?<main className="lab-error">{error}</main>:ready?<Home lab={!server}/>:<main className="lab-error">Opening isolated test session…</main>}</>;
}
