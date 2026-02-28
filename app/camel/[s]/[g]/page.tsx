'use client';

import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import HomePage from '../../../components/HomePage';
import { CAMEL_THEME } from '../../../lib/themes';

export default function CamelEntryPage() {
  const params = useParams();

  useEffect(() => {
    const s = params.s as string;
    const g = params.g as string;
    if (s) sessionStorage.setItem('uid', s);
    if (g) sessionStorage.setItem('gid', g);
  }, [params]);

  return <HomePage theme={CAMEL_THEME} />;
}
