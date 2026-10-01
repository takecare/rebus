import { Shell } from './components/Shell.js';
import { GameOver } from './screens/GameOver.js';
import { Home } from './screens/Home.js';
import { Lobby } from './screens/Lobby.js';
import { Reveal } from './screens/Reveal.js';
import { Round } from './screens/Round.js';
import { Scoreboard } from './screens/Scoreboard.js';
import { SinglePractice } from './screens/SinglePractice.js';
import { useStore } from './state/store.js';

/**
 * Routing is state-driven: the server's phase decides the screen. The only
 * URLs that matter are #/r/CODE, which prefills the join code, and the real
 * path /single, which bootstraps a one-player practice room (SPEC §7.3b)
 * instead of showing Home. Once that bootstrap connects, phase takes over
 * exactly as it does for any other room.
 */
export default function App() {
  const view = useStore((s) => s.view);
  const status = useStore((s) => s.status);
  const isSingle = location.pathname === '/single';

  return (
    <Shell>
      {!view || status === 'idle' ? (
        isSingle ? <SinglePractice /> : <Home />
      ) : view.phase === 'lobby' ? (
        <Lobby view={view} />
      ) : view.phase === 'round' ? (
        <Round view={view} />
      ) : view.phase === 'reveal' ? (
        <Reveal view={view} />
      ) : view.phase === 'scoreboard' ? (
        <Scoreboard view={view} />
      ) : (
        <GameOver view={view} />
      )}
    </Shell>
  );
}
