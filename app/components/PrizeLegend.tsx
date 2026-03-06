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
        background: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(20,18,28,0.85)',
        border: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.10)'}`,
        boxShadow: isLight
          ? '0 6px 28px -6px rgba(0,0,0,0.12)'
          : '0 6px 28px -6px rgba(0,0,0,0.5)',
        maxHeight: '60vh',
        overflowY: 'auto',
      }}
    >
      <div className="px-3 py-2.5 flex flex-col gap-1">
        {unique.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl"
            style={{
              background: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)',
            }}
          >
            <span className="text-2xl leading-none flex-shrink-0">{p.emoji}</span>
            <span
              className="text-[15px] font-semibold leading-tight truncate max-w-[160px]"
              style={{ color: isLight ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)' }}
            >
              {p.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
