'use client';

import { useParams } from 'next/navigation';
import HomePage from '../../components/HomePage';
import { LD_THEME } from '../../lib/themes';

export default function LdFilteredHome() {
  const params = useParams();
  const letters = (params.s as string) || '';
  return <HomePage theme={LD_THEME} letters={letters} />;
}
