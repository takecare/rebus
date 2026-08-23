import { create } from 'zustand';
import type { GameStateView, GuessKind, ServerMsg } from '@rebus/shared';

export type Status = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export type Flash = { playerId: string; kind: 'correct' | 'wrong'; at: number };

type Store = {
  status: Status;
  code: string | null;
  playerId: string | null;
  error: string | null;
  view: GameStateView | null;
  /** serverNow = Date.now() + offset. SPEC 3.4. */
  offset: number;
  lastResult: { kind: GuessKind; points?: number; text: string; at: number } | null;
  flashes: Flash[];
  hintFlash: number | null;

  setStatus: (status: Status) => void;
  setCode: (code: string | null) => void;
  setError: (error: string | null) => void;
  setOffset: (offset: number) => void;
  handle: (msg: ServerMsg) => void;
  reset: () => void;
};

export const useStore = create<Store>((set, get) => ({
  status: 'idle',
  code: null,
  playerId: null,
  error: null,
  view: null,
  offset: 0,
  lastResult: null,
  flashes: [],
  hintFlash: null,

  setStatus: (status) => set({ status }),
  setCode: (code) => set({ code }),
  setError: (error) => set({ error }),
  setOffset: (offset) => set({ offset }),

  handle: (msg) => {
    switch (msg.t) {
      case 'hello':
        set({ playerId: msg.playerId, error: null });
        break;
      case 'state': {
        const previous = get().view;
        // A new round wipes the round-scoped chrome.
        const changedRound =
          previous?.roundNo !== msg.state.roundNo || previous?.phase !== msg.state.phase;
        set({
          view: msg.state,
          ...(changedRound ? { lastResult: null, flashes: [], hintFlash: null } : {}),
        });
        break;
      }
      case 'guessResult':
        set({ lastResult: { ...msg, at: Date.now() } });
        break;
      case 'event':
        if (msg.kind === 'playerCorrect' || msg.kind === 'playerWrong') {
          const kind = msg.kind === 'playerCorrect' ? 'correct' : 'wrong';
          set({ flashes: [...get().flashes.slice(-8), { playerId: msg.playerId, kind, at: Date.now() }] });
        }
        if (msg.kind === 'hint') set({ hintFlash: msg.level });
        break;
      case 'error':
        set({ error: msg.message });
        break;
      default:
        break;
    }
  },

  reset: () => set({ status: 'idle', code: null, playerId: null, view: null, error: null, lastResult: null, flashes: [] }),
}));

export function serverNow(): number {
  return Date.now() + useStore.getState().offset;
}
