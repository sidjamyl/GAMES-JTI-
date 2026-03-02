'use client';

import dynamic from 'next/dynamic';
import { GameTheme } from '../lib/themes';

/* ═══════════════════════════════════════════════════════════
   GameRouter — Dynamically renders a game component by slug.
   Used by the [letters]/[game] dynamic routes.
   ═══════════════════════════════════════════════════════════ */

const COMPONENTS: Record<string, React.ComponentType<{ theme?: GameTheme }>> = {
  'spin':         dynamic(() => import('../spin/page')),
  'plinko':       dynamic(() => import('../plinko/page')),
  'cannon':       dynamic(() => import('../cannon/page')),
  'angry-ball':   dynamic(() => import('../angry-ball/page')),
  'pendulum':     dynamic(() => import('../pendulum/page')),
  'gift-slice':   dynamic(() => import('../gift-slice/page')),
  'stack-tower':  dynamic(() => import('../stack-tower/page')),
  'whac-a-mole':  dynamic(() => import('../whac-a-mole/page')),
};

interface Props {
  game: string;
  theme: GameTheme;
}

export default function GameRouter({ game, theme }: Props) {
  const Component = COMPONENTS[game];
  if (!Component) {
    return (
      <div className="flex items-center justify-center w-full" style={{ height: '100dvh', background: '#111' }}>
        <p className="text-white/40 text-sm">Jeu introuvable</p>
      </div>
    );
  }
  return <Component theme={theme} />;
}
