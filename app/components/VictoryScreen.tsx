'use client';

import { useEffect, useState } from 'react';
import Confetti from './Confetti';
import { Prize } from '../lib/types';
import { getSoundEngine } from '../lib/sounds';
import { claimPrize } from '../lib/prizes';

interface Props {
  prize: Prize;
  onClose?: () => void;
  accentFrom?: string;
  accentTo?: string;
}

export default function VictoryScreen({
  prize,
  onClose,
  accentFrom = '#d4a843',
  accentTo = '#c9842b',
}: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    getSoundEngine().victory();
    claimPrize(prize.id);

    /* ── Notify WebDev parent: WL.Exécute("GAIN", idGift, LibelleGift) ── */
    try {
      const idGift = String(prize.id);
      const libelleGift = prize.name;
      console.log('[GAME] Calling WebDev GAIN:', idGift, libelleGift);

      // Try direct call (works if HTML field is inline, not sandboxed iframe)
      const parentWin = window.parent as unknown as { WL?: { Exécute?: (...args: string[]) => void } };
      if (parentWin?.WL?.Exécute) {
        parentWin.WL.Exécute();
        console.log('[GAME] WL.Exécute called directly');
      } else {
        // Fallback: postMessage so WebDev can listen and call WL.Exécute
        window.parent.postMessage(
          { type: 'PRIZE_WON', action: 'GAIN', idGift, libelleGift },
          '*',
        );
        console.log('[GAME] postMessage sent to parent');
      }
    } catch (e) {
      // Cross-origin: direct access blocked, use postMessage
      window.parent.postMessage(
        { type: 'PRIZE_WON', action: 'GAIN', idGift: String(prize.id), libelleGift: prize.name },
        '*',
      );
      console.log('[GAME] postMessage fallback (cross-origin):', e);
    }

    requestAnimationFrame(() => setVisible(true));
  }, [prize.id, prize.name]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      {/* Blurred backdrop */}
      <div
        className="absolute inset-0 transition-all duration-700"
        style={{
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          opacity: visible ? 1 : 0,
        }}
      />

      <Confetti count={220} />

      {/* Card */}
      <div
        className="relative z-[110] flex flex-col items-center gap-4 mx-5 w-full max-w-[340px] rounded-[28px] overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"
        style={{
          background: 'rgba(255,255,255,0.97)',
          boxShadow: `0 30px 90px -20px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1), inset 0 1px 0 rgba(255,255,255,0.6)`,
          transform: visible ? 'scale(1) translateY(0)' : 'scale(0.3) translateY(60px)',
          opacity: visible ? 1 : 0,
        }}
      >
        {/* Top gradient band */}
        <div
          className="w-full h-2"
          style={{ background: `linear-gradient(90deg, ${accentFrom}, ${accentTo})` }}
        />

        <div className="flex flex-col items-center gap-3 px-8 pt-6 pb-8">
          {/* Emoji badge */}
          <div
            className="relative"
            style={{
              animation: 'victoryFloat 2.5s ease-in-out infinite',
            }}
          >
            {/* Glow ring */}
            <div
              className="absolute inset-[-12px] rounded-full"
              style={{
                background: `radial-gradient(circle, ${accentFrom}30, transparent 70%)`,
                animation: 'victoryPulse 2s ease-in-out infinite',
              }}
            />
            <div
              className="relative w-24 h-24 rounded-3xl flex items-center justify-center text-6xl"
              style={{
                background: `linear-gradient(135deg, ${accentFrom}15, ${accentTo}15)`,
                border: `2px solid ${accentFrom}25`,
              }}
            >
              {prize.emoji}
            </div>
          </div>

          <p className="text-sm font-semibold tracking-widest uppercase" style={{ color: accentFrom }}>
            Félicitations
          </p>

          <h1 className="text-[26px] font-extrabold text-gray-900 text-center leading-tight tracking-tight">
            Vous avez gagné !
          </h1>

          <div
            className="text-xl font-black text-center tracking-tight py-1 px-4 rounded-full"
            style={{
              background: `linear-gradient(135deg, ${accentFrom}, ${accentTo})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {prize.name}
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="mt-3 w-full py-3.5 rounded-2xl text-white font-bold text-[15px] tracking-wide transition-all duration-200 active:scale-[0.97]"
              style={{
                background: `linear-gradient(135deg, ${accentFrom}, ${accentTo})`,
                boxShadow: `0 8px 30px -8px ${accentFrom}80`,
              }}
            >
              Revenir demain 👋
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
