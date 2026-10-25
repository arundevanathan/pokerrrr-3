import { stagingResponse } from '../lib/staging-handler.mjs';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store, private' } });

export async function routeClubRequest(request: Request, env: Cloudflare.Env, commit = 'local'): Promise<Response | null> {
  const url = new URL(request.url);
  const health = stagingResponse(request, env.APP_ENV || 'local', commit, Boolean(env.CLUB_TABLE));
  if (health) return health;
  if (!['/api/poker', '/api/poker/socket', '/api/players', '/api/session', '/api/login', '/api/logout', '/api/pin', '/api/lobby'].includes(url.pathname)) {
    if (url.pathname.startsWith('/api/poker/')) return json({ error: 'Unknown endpoint' }, 404);
    return null;
  }
  const origin = request.headers.get('Origin');
  if ((origin && origin !== url.origin) || (request.headers.get('Upgrade')?.toLowerCase() === 'websocket' && origin !== url.origin)) return json({ error: 'Origin not allowed' }, 403);
  if (!env.CLUB_TABLE) return json({ error: 'Game server is not configured.', code: 'MULTIPLAYER_NOT_CONFIGURED' }, 503);
  return env.CLUB_TABLE.get(env.CLUB_TABLE.idFromName('dunzo-club')).fetch(request);
}
