import { stagingResponse } from '../lib/staging-handler.mjs';
// Finish small rejected uploads before returning through the Worker proxy.
async function discardBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return;
  let bytes = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Request timed out')), 5000);
  });
  try {
    for (; ;) {
      const {
        done,
        value
      } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) break;
    }
  } catch { } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => { });
  }
}
const json = (data: unknown, status = 200) => Response.json(data, {
  status,
  headers: {
    'Cache-Control': 'no-store, private'
  }
});
export async function routeClubRequest(request: Request, env: Cloudflare.Env, commit = 'local'): Promise<Response | null> {
  const url = new URL(request.url);
  const health = stagingResponse(request, env.APP_ENV || 'local', commit, Boolean(env.CLUB_TABLE));
  if (health) return health;
  if (url.pathname.startsWith('/api/test-lab')) {
    if (env.APP_ENV !== 'staging') return json({error:'Not found'},404);
    const origin=request.headers.get('Origin');
    if(origin && origin !== url.origin || request.headers.get('Upgrade')?.toLowerCase()==='websocket' && origin!==url.origin)return json({error:'Origin not allowed'},403);
    if(!env.CLUB_TABLE)return json({error:'Test server unavailable'},503);
    const create=url.pathname==='/api/test-lab/create' && request.method==='POST';
    const match=url.pathname.match(/^\/api\/test-lab\/session\/([a-f0-9-]{36})\/([0-7])(\/.*)$/);
    if(!create&&!match)return json({error:'Unknown test endpoint'},404);
    const id=create?crypto.randomUUID():match![1], viewer=create?'0':match![2];
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))return json({error:'Invalid test session'},400);
    const suffix=create?'/__test-lab/setup':match![3]==='/bootstrap'?'/__test-lab/bootstrap':match![3]==='/control'?'/__test-lab/control':match![3];
    const allowed=['/api/poker','/api/poker/socket','/api/players','/api/session','/api/login','/api/logout','/api/pin','/api/lobby','/api/history','/api/settlement','/api/hand-history','/api/reactions','/api/chat','/__test-lab/setup','/__test-lab/bootstrap','/__test-lab/control'];
    if(!allowed.includes(suffix)||!create&&suffix==='/__test-lab/setup')return json({error:'Unknown test endpoint'},404);
    const target=new URL(request.url);target.pathname=suffix;
    const headers=new Headers(request.headers);headers.set('X-Test-Lab-Route',id);headers.set('X-Test-Lab-Viewer',viewer);
    // Normal club cookies never authenticate a test session, or vice versa.
    const labCookie=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('dunzo-test-lab='));
    headers.delete('Cookie');if(labCookie)headers.set('Cookie',labCookie.replace('dunzo-test-lab=','dunzo-player-session='));
    const forwarded=new Request(target,{method:request.method,headers,body:request.body,redirect:'manual'});
    const response=await env.CLUB_TABLE.get(env.CLUB_TABLE.idFromName('test-lab:'+id)).fetch(forwarded);
    if(create&&response.ok){const data:any=await response.json();return json({...data,session:id});}
    const cookie=response.headers.get('Set-Cookie');
    if(cookie){const result=new Response(response.body,response);result.headers.set('Set-Cookie',cookie.replace('dunzo-player-session=','dunzo-test-lab=').replace('Path=/;',`Path=/api/test-lab/session/${id}/${viewer}/;`));return result;}
    return response;
  }
  if (!['/api/poker', '/api/poker/socket', '/api/players', '/api/session', '/api/login', '/api/logout', '/api/pin', '/api/lobby', '/api/history', '/api/settlement', '/api/hand-history', '/api/reactions', '/api/chat'].includes(url.pathname)) {
    if (url.pathname.startsWith('/api/poker/')) return json({
      error: 'Unknown endpoint'
    }, 404);
    return null;
  }
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin || request.headers.get('Upgrade')?.toLowerCase() === 'websocket' && origin !== url.origin) {
    await discardBody(request);
    return json({
      error: 'Origin not allowed'
    }, 403);
  }
  if (!env.CLUB_TABLE) return json({
    error: 'Game server is not configured.',
    code: 'MULTIPLAYER_NOT_CONFIGURED'
  }, 503);
  const clean=new Request(request);clean.headers.delete('X-Test-Lab-Route');clean.headers.delete('X-Test-Lab-Viewer');
  return env.CLUB_TABLE.get(env.CLUB_TABLE.idFromName('dunzo-club')).fetch(clean);
}
