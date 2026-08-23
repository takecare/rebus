import {
  applyEvent,
  createGame,
  CONFIG,
  PROTOCOL_VERSION,
  redact,
  sanitizeNick,
  type ClientMsg,
  type Effect,
  type ErrorCode,
  type GameEvent,
  type GameState,
  type ServerMsg,
} from '@rebus/shared';

type Attachment = { playerId: string };

/**
 * The room. It owns the state, the sockets and the clock, and it contains no
 * game rules at all: every decision is applyEvent's. SPEC 3.2 / 3.3.
 */
export class RoomDO implements DurableObject {
  private game: GameState | null = null;

  constructor(
    private ctx: DurableObjectState,
    private env: unknown,
  ) {
    void this.env;
    // In-memory state is a cache of storage, never the truth. SPEC 3.3.
    this.ctx.blockConcurrencyWhile(async () => {
      this.game = (await this.ctx.storage.get<GameState>('state')) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/create') {
      if (this.game) return new Response('exists', { status: 409 });
      const body = await request
        .json<{ rounds?: number; lang?: 'en' }>()
        .catch(() => ({}) as { rounds?: number; lang?: 'en' });
      this.game = createGame({
        code: url.searchParams.get('code') ?? 'ROOM',
        now: Date.now(),
        rng: Math.random,
        roundsTotal: body?.rounds,
        lang: body?.lang,
      });
      await this.persist();
      await this.ctx.storage.setAlarm(Date.now() + CONFIG.ROOM_IDLE_MS);
      return Response.json({ code: this.game.code });
    }

    if (url.pathname === '/info') {
      if (!this.game) return Response.json({ error: 'room_not_found' }, { status: 404 });
      return Response.json({
        code: this.game.code,
        phase: this.game.phase,
        players: this.game.players.length,
        full: this.game.players.length >= CONFIG.MAX_PLAYERS,
      });
    }

    if (url.pathname === '/socket') {
      if (!this.game) return new Response('no such room', { status: 404 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      // Hibernation: the socket outlives this object being evicted. SPEC 3.3.
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (!this.game) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) as ClientMsg;
    } catch {
      return this.sendTo(ws, { t: 'error', code: 'bad_message', message: 'Unreadable message.' });
    }
    if (!msg || typeof msg.t !== 'string') {
      return this.sendTo(ws, { t: 'error', code: 'bad_message', message: 'Unreadable message.' });
    }

    if (msg.t === 'ping') {
      return this.sendTo(ws, { t: 'pong', t0: msg.t0, serverTime: Date.now() });
    }

    // join/resume are the only messages that can create the socket's identity.
    if (msg.t === 'join') {
      const playerId = crypto.randomUUID();
      const resumeToken = crypto.randomUUID();
      ws.serializeAttachment({ playerId } satisfies Attachment);
      await this.dispatch({ type: 'join', playerId, resumeToken, nick: sanitizeNick(msg.nick) });
      if (this.game.players.some((p) => p.id === playerId)) {
        this.sendTo(ws, { t: 'hello', playerId, resumeToken, protocol: PROTOCOL_VERSION, serverTime: Date.now() });
        this.sendTo(ws, { t: 'state', state: redact(this.game, playerId, Date.now()) });
      }
      return;
    }

    if (msg.t === 'resume') {
      ws.serializeAttachment({ playerId: msg.playerId } satisfies Attachment);
      // A second tab for the same player replaces the first. SPEC 3.6.
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws && this.playerIdOf(other) === msg.playerId) {
          try {
            other.close(4002, 'superseded');
          } catch {
            /* already gone */
          }
        }
      }
      await this.dispatch({ type: 'resume', playerId: msg.playerId, resumeToken: msg.resumeToken });
      if (this.game.players.some((p) => p.id === msg.playerId)) {
        this.sendTo(ws, {
          t: 'hello',
          playerId: msg.playerId,
          resumeToken: msg.resumeToken,
          protocol: PROTOCOL_VERSION,
          serverTime: Date.now(),
        });
        this.sendTo(ws, { t: 'state', state: redact(this.game, msg.playerId, Date.now()) });
      }
      return;
    }

    const playerId = this.playerIdOf(ws);
    if (!playerId) {
      return this.sendTo(ws, { t: 'error', code: 'unknown_session', message: 'Join the room first.' });
    }

    const event = toEvent(msg, playerId);
    if (!event) {
      return this.sendTo(ws, { t: 'error', code: 'bad_message', message: 'Unreadable message.' });
    }
    await this.dispatch(event);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const playerId = this.playerIdOf(ws);
    if (playerId && this.game) await this.dispatch({ type: 'disconnect', playerId });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  async alarm(): Promise<void> {
    if (!this.game) return;
    await this.dispatch({ type: 'tick' });
  }

  /* ------------------------------------------------------------- plumbing */

  private async dispatch(event: GameEvent): Promise<void> {
    if (!this.game) return;
    const { state, effects } = applyEvent(this.game, event, { now: Date.now(), rng: Math.random });
    this.game = state;
    await this.persist();
    await this.run(effects);
  }

  private async run(effects: Effect[]): Promise<void> {
    let broadcastState = false;
    for (const fx of effects) {
      switch (fx.kind) {
        case 'state':
          broadcastState = true;
          break;
        case 'send':
          this.route(fx.to, fx.msg);
          break;
        case 'setAlarm':
          if (fx.at === null) await this.ctx.storage.deleteAlarm();
          else await this.ctx.storage.setAlarm(fx.at);
          break;
        case 'destroy':
          await this.destroy();
          return;
      }
    }
    // Many effects can ask for a snapshot; one goes out. SPEC 4.3.
    if (broadcastState) this.broadcastState();
  }

  private broadcastState(): void {
    if (!this.game) return;
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const playerId = this.playerIdOf(ws);
      if (!playerId) continue;
      this.sendTo(ws, { t: 'state', state: redact(this.game, playerId, now) });
    }
  }

  private route(to: string, msg: ServerMsg): void {
    for (const ws of this.ctx.getWebSockets()) {
      const playerId = this.playerIdOf(ws);
      if (!playerId) continue;
      if (to === '*' || to === playerId) this.sendTo(ws, msg);
    }
  }

  private sendTo(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* the socket is on its way out; webSocketClose will follow */
    }
  }

  private playerIdOf(ws: WebSocket): string | null {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    return attachment?.playerId ?? null;
  }

  private async persist(): Promise<void> {
    if (this.game) await this.ctx.storage.put('state', this.game);
  }

  private async destroy(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(4003, 'room closed');
      } catch {
        /* already gone */
      }
    }
    this.game = null;
    await this.ctx.storage.deleteAll();
  }
}

/** Wire message -> game event. Anything unrecognised is refused, never thrown. */
function toEvent(msg: ClientMsg, playerId: string): GameEvent | null {
  switch (msg.t) {
    case 'start':
      return { type: 'start', playerId };
    case 'guess':
      return typeof msg.text === 'string' ? { type: 'guess', playerId, text: msg.text } : null;
    case 'pickTitle':
      return Number.isInteger(msg.index) ? { type: 'pickTitle', playerId, index: msg.index } : null;
    case 'compose':
      return Array.isArray(msg.emoji) ? { type: 'compose', playerId, emoji: msg.emoji.slice(0, 32) } : null;
    case 'skipReveal':
      return { type: 'skipReveal', playerId };
    case 'rematch':
      return { type: 'rematch', playerId };
    default:
      return null;
  }
}

export type { ErrorCode };
