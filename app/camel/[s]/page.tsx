'use client';

import { useParams } from 'next/navigation';
import HomePage from '../../components/HomePage';
import { CAMEL_THEME } from '../../lib/themes';

export default function CamelFilteredHome() {
  const params = useParams();
  const letters = (params.s as string) || '';
  return <HomePage theme={CAMEL_THEME} letters={letters} />;
}
