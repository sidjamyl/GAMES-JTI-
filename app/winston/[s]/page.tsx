'use client';

import { useParams } from 'next/navigation';
import HomePage from '../../components/HomePage';
import { WINSTON_THEME } from '../../lib/themes';

export default function WinstonFilteredHome() {
  const params = useParams();
  const letters = (params.s as string) || '';
  return <HomePage theme={WINSTON_THEME} letters={letters} />;
}
