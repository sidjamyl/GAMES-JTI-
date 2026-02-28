'use client';

import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import HomePage from '../../../components/HomePage';
import { WINSTON_THEME } from '../../../lib/themes';

export default function WinstonEntryPage() {
  const params = useParams();

  useEffect(() => {
    const s = params.s as string;
    const g = params.g as string;
    if (s) sessionStorage.setItem('uid', s);
    if (g) sessionStorage.setItem('gid', g);
  }, [params]);

  return <HomePage theme={WINSTON_THEME} />;
}
