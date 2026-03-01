'use client';

import { Prize } from '../lib/types';

interface Props {
  prizes: Prize[];
  isLight?: boolean;
}

export default function PrizeLegend({ prizes, isLight = false }: Props) {
  if (prizes.length === 0) return null;

  // Deduplicate by id
  const unique = prizes.filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i);

  return (
    <div
      className="absolute top-3 right-3 z-50 rounded-2xl overflow-hidden backdrop-blur-xl"
      style={{
        background: isLight ? 'rgba(255,255,255,0.82)' : 'rgba(20,18,28,0.82)',
        border: `1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'}`,
        boxShadow: isLight
          ? '0 4px 20px -6px rgba(0,0,0,0.10)'
          : '0 4px 20px -6px rgba(0,0,0,0.4)',
        maxHeight: '55vh',
        overflowY: 'auto',
      }}
    >
      <div className="px-2 py-1.5 flex flex-col gap-0.5">
        {unique.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-1.5 px-1.5 py-1 rounded-lg"
            style={{
              background: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)',
            }}
          >
            <span className="text-sm leading-none flex-shrink-0">{p.emoji}</span>
            <span
              className="text-[10px] font-medium leading-tight truncate max-w-[100px]"
              style={{ color: isLight ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)' }}
            >
              {p.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
