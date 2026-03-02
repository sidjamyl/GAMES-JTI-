'use client';

import { useParams } from 'next/navigation';
import GameRouter from '../../components/GameRouter';
import { DEFAULT_THEME } from '../../lib/themes';

export default function DefaultGamePage() {
  const params = useParams();
  const letters = (params.s as string) || '';
  const game = (params.g as string) || '';

  const theme = { ...DEFAULT_THEME, routePrefix: `/${letters}` };

  return <GameRouter game={game} theme={theme} />;
}
