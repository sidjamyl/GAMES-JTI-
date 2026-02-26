'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   NERVE — Risk/Reward counter
   Counter 0→100. Stop for a prize. But it can
   explode between 60-95. Greed vs safety.
   ═══════════════════════════════════════════════ */

export default function Nerve({ theme }: { theme?: GameTheme }) {
  const T = { ...DEFAULT_THEME, ...theme };
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY } = T;
  const goldRgb = hexToRgb(GOLD);

  const [phase, setPhase] = useState<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [counter, setCounter] = useState(0);
  const [exploded, setExploded] = useState(false);
  const [running, setRunning] = useState(false);
  const counterRef = useRef(0);
  const explosionPointRef = useRef(75);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const tickSoundRef = useRef(0);

  useEffect(() => { fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); }); }, []);

  const getPrizeForScore = useCallback((score: number, prizes: Prize[]): Prize => {
    // Sort prizes by quantity (rarer = fewer quantity = better prize)
    const sorted = [...prizes].filter(p => p.quantity > 0).sort((a, b) => a.quantity - b.quantity);
    if (sorted.length === 0) return prizes[0];

    // Map score to prize tier: higher score = rarer prize
    if (score >= 90) return sorted[0]; // rarest
    if (score >= 75) return sorted[Math.min(1, sorted.length - 1)];
    if (score >= 60) return sorted[Math.min(2, sorted.length - 1)];
    if (score >= 40) return sorted[Math.floor(sorted.length * 0.6)];
    if (score >= 20) return sorted[Math.floor(sorted.length * 0.8)];
    return sorted[sorted.length - 1]; // most common
  }, []);

  const startGame = () => {
    setWonPrize(null);
    setExploded(false);
    setCounter(0);
    counterRef.current = 0;
    explosionPointRef.current = 60 + Math.floor(Math.random() * 36); // 60-95
    setRunning(true);
    setPhase('playing');

    const speed = 50; // ms per tick
    intervalRef.current = setInterval(() => {
      counterRef.current += 1;
      setCounter(counterRef.current);

      // Tick sound every 5
      if (counterRef.current % 5 === 0) {
        try { getSoundEngine().peg(counterRef.current / 20); } catch {}
      }

      if (counterRef.current >= explosionPointRef.current) {
        // BOOM
        clearInterval(intervalRef.current);
        setExploded(true);
        setRunning(false);
        try { getSoundEngine().miss(); } catch {}

        // Give worst prize
        const sorted = [...prizes].filter(p => p.quantity > 0).sort((a, b) => b.quantity - a.quantity);
        setWonPrize(sorted[0] || prizes[0]);
        setTimeout(() => setPhase('victory'), 1500);
      }

      if (counterRef.current >= 100) {
        clearInterval(intervalRef.current);
        setRunning(false);
      }
    }, speed);
  };

  const stopCounter = () => {
    if (!running) return;
    clearInterval(intervalRef.current);
    setRunning(false);
    try { getSoundEngine().swish(); } catch {}
    const prize = getPrizeForScore(counterRef.current, prizes);
    setWonPrize(prize);
    setTimeout(() => setPhase('victory'), 800);
  };

  useEffect(() => {
    return () => clearInterval(intervalRef.current);
  }, []);

  const dangerZone = counter >= 50;
  const criticalZone = counter >= 70;
  const pulseSpeed = criticalZone ? '0.15s' : dangerZone ? '0.4s' : '1s';

  return (
    <div className="game-container noise-overlay flex flex-col items-center justify-center" style={{ background: BG_DARK }}>
      {phase === 'playing' && (
        <div className="flex flex-col items-center gap-8 z-20 px-8 w-full max-w-[400px]">
          {/* Counter display */}
          <div className="relative flex items-center justify-center">
            {/* Glow ring */}
            <div
              className="absolute rounded-full"
              style={{
                width: 200, height: 200,
                background: exploded
                  ? 'radial-gradient(circle, rgba(255,60,60,0.3), transparent 70%)'
                  : `radial-gradient(circle, rgba(${goldRgb},${0.05 + counter * 0.003}), transparent 70%)`,
                animation: running ? `victoryPulse ${pulseSpeed} ease-in-out infinite` : 'none',
              }}
            />

            {/* Main circle */}
            <div
              className="relative w-[160px] h-[160px] rounded-full flex items-center justify-center border-4 transition-all duration-200"
              style={{
                borderColor: exploded ? '#ef4444' : counter >= 80 ? '#ef4444' : counter >= 50 ? AMBER : GOLD,
                background: exploded
                  ? 'rgba(255,0,0,0.1)'
                  : `rgba(${goldRgb},0.05)`,
                boxShadow: exploded
                  ? '0 0 60px rgba(255,0,0,0.4)'
                  : `0 0 ${counter}px rgba(${goldRgb},${counter * 0.004})`,
              }}
            >
              {exploded ? (
                <span className="text-5xl">💥</span>
              ) : (
                <span
                  className="text-[56px] font-black tabular-nums"
                  style={{
                    background: counter >= 80
                      ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                      : counter >= 50
                      ? `linear-gradient(135deg, ${AMBER}, #ef4444)`
                      : `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD})`,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {counter}
                </span>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: `rgba(${goldRgb},0.1)` }}>
            <div
              className="h-full rounded-full transition-all duration-75"
              style={{
                width: `${counter}%`,
                background: exploded
                  ? '#ef4444'
                  : counter >= 80
                  ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                  : counter >= 50
                  ? `linear-gradient(90deg, ${GOLD}, ${AMBER}, #ef4444)`
                  : `linear-gradient(90deg, ${GOLD}, ${AMBER})`,
              }}
            />
          </div>

          {/* Prize tiers display */}
          <div className="flex justify-between w-full text-[10px] font-semibold" style={{ color: CREAM + '40' }}>
            <span>0 — Basique</span>
            <span>40 — Bien</span>
            <span>75 — Rare</span>
            <span>90+ — Jackpot</span>
          </div>

          {/* Instruction / warning */}
          {!exploded && running && (
            <p
              className="text-center text-sm font-medium"
              style={{
                color: criticalZone ? '#ef4444' : dangerZone ? AMBER : CREAM + '60',
                animation: criticalZone ? `victoryPulse 0.3s ease-in-out infinite` : 'none',
              }}
            >
              {criticalZone ? '⚠️ DANGER ! Ça peut exploser !' : dangerZone ? '🔥 Zone à risque...' : 'Plus vous attendez, meilleur sera le cadeau...'}
            </p>
          )}

          {exploded && (
            <p className="text-center text-lg font-bold text-red-500" style={{ animation: 'fadeInUp 0.3s ease-out' }}>
              💥 BOOM ! Trop gourmand !
            </p>
          )}

          {/* STOP button */}
          {running && !exploded && (
            <button
              onClick={stopCounter}
              className="w-full py-5 rounded-2xl text-white font-black text-2xl tracking-wide transition-all active:scale-[0.96]"
              style={{
                background: criticalZone
                  ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                  : `linear-gradient(135deg, ${GOLD}, ${AMBER})`,
                boxShadow: criticalZone
                  ? '0 12px 40px -10px rgba(239,68,68,0.6)'
                  : `0 12px 40px -10px ${GOLD}80`,
                animation: criticalZone ? `victoryPulse 0.2s ease-in-out infinite` : 'none',
              }}
            >
              STOP !
            </button>
          )}
        </div>
      )}

      {phase === 'ready' && (
        <div className="flex flex-col items-center gap-6 z-20 px-8">
          <div className="text-6xl" style={{ animation: 'victoryFloat 2s ease-in-out infinite' }}>🧨</div>
          <h1 className="text-[32px] font-extrabold tracking-tight text-center" style={{
            background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Nerve</h1>
          <p className="text-[14px] text-center max-w-[280px] leading-relaxed" style={{ color: CREAM + '60' }}>
            Le compteur monte de 0 à 100.<br/>
            Plus vous attendez, meilleur le cadeau.<br/>
            Mais attention... ça peut exploser ! 💥
          </p>
          <button onClick={startGame} className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-lg tracking-wide transition-all active:scale-[0.96]" style={{
            background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`,
            boxShadow: `0 12px 40px -10px ${GOLD}80`,
          }}>Tenter sa chance</button>
        </div>
      )}

      {phase === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: BG_DARK }}>
          <div className="w-8 h-8 border-2 rounded-full" style={{ borderColor: `${GOLD}30`, borderTopColor: GOLD, animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {phase === 'victory' && wonPrize && (
        <VictoryScreen prize={wonPrize} onClose={() => setPhase('ready')} accentFrom={GOLD} accentTo={AMBER} />
      )}
    </div>
  );
}
