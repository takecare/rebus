import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '@rebus/shared';
import { useStore } from '../state/store.js';

const API = import.meta.env.VITE_API_URL ?? '';
const WS_BASE =
  import.meta.env.VITE_WS_URL ??
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

type Session = { playerId: string; resumeToken: string };

const BACKOFF = [500, 1_000, 2_000, 4_000, 8_000];

/**
 * One socket, forever: it reconnects with backoff and resumes the seat it had.
 * SPEC 3.4 / 3.5.
 */
class RoomSocket {
  private ws: WebSocket | null = null;
  private code: string | null = null;
  private nick = '';
  private attempt = 0;
  private closedByUs = false;
  private pingTimer: number | null = null;
  private offsets: number[] = [];

  async createRoom(rounds?: number): Promise<string> {
    const res = await fetch(`${API}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rounds }),
    });
    if (!res.ok) throw new Error('Could not open a room.');
    const body = (await res.json()) as { code: string };
    return body.code;
  }

  connect(code: string, nick: string): void {
    this.code = code;
    this.nick = nick;
    this.closedByUs = false;
    this.attempt = 0;
    useStore.getState().setCode(code);
    this.open();
  }

  private open(): void {
    if (!this.code) return;
    const store = useStore.getState();
    store.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    const ws = new WebSocket(`${WS_BASE}/api/rooms/${this.code}/socket?v=${PROTOCOL_VERSION}`);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      useStore.getState().setStatus('open');
      const session = loadSession(this.code!);
      if (session) this.send({ t: 'resume', ...session });
      else this.send({ t: 'join', nick: this.nick });
      this.startPings();
    };

    ws.onmessage = (event) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(event.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === 'pong') return this.onPong(msg.t0, msg.serverTime);
      if (msg.t === 'hello') saveSession(this.code!, { playerId: msg.playerId, resumeToken: msg.resumeToken });
      // A seat that no longer exists: forget it and join as someone new.
      if (msg.t === 'error' && msg.code === 'unknown_session') {
        clearSession(this.code!);
        this.send({ t: 'join', nick: this.nick });
        return;
      }
      useStore.getState().handle(msg);
    };

    ws.onclose = () => {
      this.stopPings();
      if (this.closedByUs) return useStore.getState().setStatus('closed');
      const delay = BACKOFF[Math.min(this.attempt++, BACKOFF.length - 1)] + Math.random() * 250;
      useStore.getState().setStatus('reconnecting');
      window.setTimeout(() => this.open(), delay);
    };

    ws.onerror = () => ws.close();
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  leave(): void {
    this.closedByUs = true;
    this.stopPings();
    this.ws?.close();
    this.ws = null;
    if (this.code) clearSession(this.code);
    useStore.getState().reset();
  }

  /**
   * Ask the room to re-check its own deadline, for when its alarm was missed.
   * This is a plain ping on purpose: the server already wakes on one, and reusing
   * it means a stalled room recovers without a new message type. SPEC §7.6.
   */
  nudge(): void {
    this.send({ t: 'ping', t0: Date.now() });
  }

  private startPings(): void {
    this.stopPings();
    this.nudge();
    this.pingTimer = window.setInterval(() => this.nudge(), 20_000);
  }

  private stopPings(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /** Median of the last five samples, so one slow round trip cannot skew the clock. */
  private onPong(t0: number, serverTime: number): void {
    const rtt = Date.now() - t0;
    this.offsets = [...this.offsets, serverTime - (t0 + rtt / 2)].slice(-5);
    const sorted = [...this.offsets].sort((a, b) => a - b);
    useStore.getState().setOffset(sorted[Math.floor(sorted.length / 2)]);
  }
}

function key(code: string): string {
  return `rebus:session:${code}`;
}

function loadSession(code: string): Session | null {
  try {
    const raw = sessionStorage.getItem(key(code));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(code: string, session: Session): void {
  try {
    sessionStorage.setItem(key(code), JSON.stringify(session));
  } catch {
    /* private mode: the player simply cannot resume */
  }
}

function clearSession(code: string): void {
  try {
    sessionStorage.removeItem(key(code));
  } catch {
    /* nothing to do */
  }
}

export const socket = new RoomSocket();
