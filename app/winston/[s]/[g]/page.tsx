'use client';

import { useParams } from 'next/navigation';
import GameRouter from '../../../components/GameRouter';
import { WINSTON_THEME } from '../../../lib/themes';

export default function WinstonGamePage() {
  const params = useParams();
  const letters = (params.s as string) || '';
  const game = (params.g as string) || '';

  const theme = { ...WINSTON_THEME, routePrefix: `${WINSTON_THEME.routePrefix}/${letters}` };

  return <GameRouter game={game} theme={theme} />;
}
