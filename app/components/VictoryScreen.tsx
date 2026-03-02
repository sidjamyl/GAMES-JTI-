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
  /** When true, shows a "you lost but here's a consolation" message instead of "you won" */
  isConsolation?: boolean;
}

export default function VictoryScreen({
  prize,
  onClose,
  accentFrom = '#C19A6B',
  accentTo = '#8E7045',
  isConsolation = false,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [wlStatus, setWlStatus] = useState<string>('');
  const [gained, setGained] = useState(false);

  useEffect(() => {
    getSoundEngine().victory();
    claimPrize(prize.id);
    requestAnimationFrame(() => setVisible(true));
  }, [prize.id]);

  /* ── Called when user clicks "Continuer" ── */
  const handleContinue = () => {
    if (gained) return;

    const idGift = isConsolation ? '-1' : String(prize.id);
    const win = window as unknown as { WL?: { Execute?: (...args: string[]) => void } };
    if (win?.WL?.Execute) {
      win.WL.Execute('GAIN', idGift);
      setWlStatus(`✅ WL.Execute("GAIN", ${idGift}) appelé !`);
    } else {
      setWlStatus(`⚠️ WL.Execute non dispo (hors contexte WebDev)`);
    }
    setGained(true);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 transition-all duration-500"
        style={{
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          opacity: visible ? 1 : 0,
        }}
      />

      {!isConsolation && <Confetti count={180} />}

      {/* Card */}
      <div
        className="relative z-[110] flex flex-col items-center mx-5 w-full max-w-[340px] rounded-3xl overflow-hidden transition-all duration-600 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"
        style={{
          background: 'rgba(255,255,255,0.97)',
          boxShadow: `0 24px 80px -16px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.04)`,
          transform: visible ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(24px)',
          opacity: visible ? 1 : 0,
        }}
      >
        {/* Top accent line */}
        <div
          className="w-full h-1"
          style={{ background: `linear-gradient(90deg, ${accentFrom}, ${accentTo})` }}
        />

        <div className="flex flex-col items-center gap-3 px-8 pt-8 pb-8">
          {/* Prize icon container */}
          <div
            className="relative"
            style={{ animation: 'victoryFloat 3s ease-in-out infinite' }}
          >
            <div
              className="relative w-20 h-20 rounded-2xl flex items-center justify-center text-5xl"
              style={{
                background: `linear-gradient(135deg, ${accentFrom}10, ${accentTo}10)`,
                border: `1px solid ${accentFrom}18`,
              }}
            >
              {prize.emoji}
            </div>
          </div>

          {/* Status label */}
          <span
            className="text-[11px] font-semibold tracking-[0.15em] uppercase"
            style={{ color: isConsolation ? '#94a3b8' : accentFrom }}
          >
            {isConsolation ? 'Pas de chance' : 'Félicitations'}
          </span>

          {/* Heading */}
          <h1
            className="text-[22px] font-bold text-center leading-tight tracking-[-0.02em]"
            style={{ color: '#1a1a2e' }}
          >
            {isConsolation ? 'Partie terminée' : 'Vous avez gagné !'}
          </h1>

          {/* Prize name */}
          <div
            className="text-[16px] font-bold text-center tracking-tight px-4 py-1.5 rounded-xl"
            style={{
              color: accentFrom,
              background: `${accentFrom}0c`,
            }}
          >
            {prize.name}
          </div>

          {/* CTA button */}
          <button
            onClick={handleContinue}
            disabled={gained}
            className="mt-3 w-full py-3.5 rounded-xl font-semibold text-[14px] tracking-wide transition-all duration-200 active:scale-[0.97]"
            style={{
              background: gained ? `${accentFrom}60` : accentFrom,
              color: '#ffffff',
              boxShadow: gained ? 'none' : `0 4px 20px -4px ${accentFrom}50`,
              cursor: gained ? 'default' : 'pointer',
            }}
          >
            {gained ? 'Terminé' : 'Continuer'}
          </button>

          {/* Debug: WL.Execute status */}
          {wlStatus && (
            <div
              className="mt-2 w-full text-center text-[10px] font-mono px-3 py-2 rounded-lg"
              style={{
                background: wlStatus.startsWith('✅') ? '#ecfdf5' : '#fffbeb',
                color: wlStatus.startsWith('✅') ? '#065f46' : '#92400e',
                border: `1px solid ${wlStatus.startsWith('✅') ? '#d1fae5' : '#fef3c7'}`,
              }}
            >
              {wlStatus}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
