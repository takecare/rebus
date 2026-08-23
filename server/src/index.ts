import { generateCode, isValidCode, normalizeCode, PROTOCOL_VERSION } from '@rebus/shared';
import { RoomDO } from './room.js';

export { RoomDO };

export type Env = { ROOMS: DurableObjectNamespace };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // POST /api/rooms -> { code }
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const body = await readJson(request);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateCode(Math.random);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(`room:${code}`));
        const res = await stub.fetch(`https://room/create?code=${code}`, {
          method: 'POST',
          body: JSON.stringify({ rounds: body?.rounds, lang: body?.lang }),
        });
        // 409 means that code is already a live room: try another. SPEC 3.3.
        if (res.ok) return json({ code });
        if (res.status !== 409) return json({ error: 'create_failed' }, 500);
      }
      return json({ error: 'no_code_available' }, 503);
    }

    // GET /api/rooms/:code -> does the room exist (so Join can say so before connecting)
    const info = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)$/);
    if (info && request.method === 'GET') {
      const code = normalizeCode(info[1]);
      if (!isValidCode(code)) return json({ error: 'room_not_found' }, 404);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(`room:${code}`));
      const res = await stub.fetch('https://room/info');
      return new Response(res.body, { status: res.status, headers: { ...CORS, 'content-type': 'application/json' } });
    }

    // GET /api/rooms/:code/socket -> WebSocket upgrade, handed to the room
    const socket = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/socket$/);
    if (socket) {
      if (request.headers.get('upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const version = Number(url.searchParams.get('v'));
      if (version !== PROTOCOL_VERSION) {
        return new Response('protocol mismatch', { status: 426 });
      }
      const code = normalizeCode(socket[1]);
      if (!isValidCode(code)) return new Response('no such room', { status: 404 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(`room:${code}`));
      return stub.fetch(new Request('https://room/socket', request));
    }

    if (url.pathname === '/api/health') return json({ ok: true, protocol: PROTOCOL_VERSION });

    return new Response('not found', { status: 404, headers: CORS });
  },
};

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}
