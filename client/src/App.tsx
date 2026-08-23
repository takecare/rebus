import { Shell } from './components/Shell.js';
import { GameOver } from './screens/GameOver.js';
import { Home } from './screens/Home.js';
import { Lobby } from './screens/Lobby.js';
import { Reveal } from './screens/Reveal.js';
import { Round } from './screens/Round.js';
import { Scoreboard } from './screens/Scoreboard.js';
import { useStore } from './state/store.js';

/**
 * Routing is state-driven: the server's phase decides the screen. The only URL
 * that matters is #/r/CODE, which prefills the join code. SPEC 6.1.
 */
export default function App() {
  const view = useStore((s) => s.view);
  const status = useStore((s) => s.status);

  return (
    <Shell>
      {!view || status === 'idle' ? (
        <Home />
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
