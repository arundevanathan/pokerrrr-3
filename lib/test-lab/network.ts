// Loaded only inside the staging lab iframe. The production client is unmodified.
export function installLabNetwork(session: string, viewer: number, initialFault='none') {
  const nativeFetch=window.fetch.bind(window), NativeSocket=window.WebSocket, sockets=new Set<WebSocket>();
  const base=`/api/test-lab/session/${session}/${viewer}`, origin=location.origin;
  let fault=initialFault, dropped=false;
  const scoped=(url:URL)=>{if(url.origin===origin&&url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/api/test-lab/'))url.pathname=base+url.pathname;return url;};
  window.fetch=async(input,init)=>{
    const original=new Request(input instanceof Request?input:new URL(String(input),location.href),init), url=scoped(new URL(original.url));
    const labRequest=url.pathname.startsWith(base+'/api/');
    if(labRequest&&['http','both'].includes(fault))throw new TypeError('Test Lab: HTTP unavailable');
    const response=await nativeFetch(url,{method:original.method,headers:original.headers,body:['GET','HEAD'].includes(original.method)?undefined:await original.arrayBuffer(),credentials:original.credentials,signal:original.signal,cache:original.cache});
    if(labRequest&&fault==='lost-reply'&&!dropped&&url.pathname.endsWith('/api/poker')&&original.method==='POST'){
      dropped=true;await response.arrayBuffer();window.parent.postMessage({type:'lab-fault-consumed'},origin);throw new TypeError('Test Lab: accepted action reply lost');
    }
    return response;
  };
  window.WebSocket=class LabSocket extends NativeSocket {
    constructor(url:string|URL, protocols?:string|string[]){
      const next=scoped(new URL(String(url),location.href));
      // Browser WebSocket URLs use ws(s), so match the host explicitly.
      if(next.host===location.host&&next.pathname==='/api/poker/socket')next.pathname=base+'/api/poker/socket';
      if(['socket','both'].includes(fault))next.pathname='/api/test-lab/blocked';
      super(next,protocols);sockets.add(this);this.addEventListener('close',()=>sockets.delete(this));
    }
  };
  const listener=(event:MessageEvent)=>{if(event.origin!==origin||event.source!==window.parent||event.data?.type!=='lab-fault')return;
    fault=event.data.fault;dropped=false;
    if(['socket','both'].includes(fault))for(const socket of sockets)socket.close(1000,'Test Lab disconnect');
    window.dispatchEvent(new Event('online'));
  };
  window.addEventListener('message',listener);
  return {base,fetch:nativeFetch,cleanup:()=>{window.fetch=nativeFetch;window.WebSocket=NativeSocket;for(const socket of sockets)socket.close();window.removeEventListener('message',listener);}};
}
