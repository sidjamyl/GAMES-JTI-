'use client';

import { useParams } from 'next/navigation';
import GameRouter from '../../../components/GameRouter';
import { CAMEL_THEME } from '../../../lib/themes';

export default function CamelGamePage() {
  const params = useParams();
  const letters = (params.s as string) || '';
  const game = (params.g as string) || '';

  /* Pass modified theme with routePrefix including letters for back navigation */
  const theme = { ...CAMEL_THEME, routePrefix: `${CAMEL_THEME.routePrefix}/${letters}` };

  return <GameRouter game={game} theme={theme} />;
}
