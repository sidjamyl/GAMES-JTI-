'use client';

import { useParams } from 'next/navigation';
import GameRouter from '../../../components/GameRouter';
import { LD_THEME } from '../../../lib/themes';

export default function LdGamePage() {
  const params = useParams();
  const letters = (params.s as string) || '';
  const game = (params.g as string) || '';

  const theme = { ...LD_THEME, routePrefix: `${LD_THEME.routePrefix}/${letters}` };

  return <GameRouter game={game} theme={theme} />;
}
