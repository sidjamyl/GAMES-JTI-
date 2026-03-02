'use client';

import { useParams } from 'next/navigation';
import HomePage from '../components/HomePage';

export default function DefaultFilteredHome() {
  const params = useParams();
  const letters = (params.s as string) || '';
  return <HomePage letters={letters} />;
}
