'use client';

import { useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';

/* ═══════════════════════════════════════════════
   DÉMINEUR INVERSÉ — Inverted Minesweeper
   1 tap = you always win (rigged), ultra fast
   ═══════════════════════════════════════════════ */

type CellState = 'closed' | 'winner' | 'bomb' | 'empty';

interface Cell {
  id: number;
  state: CellState;
  revealDelay: number;
  emoji: string;
}

const BOMB_EMOJIS = ['💣', '💥', '❌', '🚫', '☠️', '🔴', '⛔', '🕳️'];
const EMPTY_EMOJIS = ['', '', ''];

function generateDecoyContent(): { emoji: string; state: CellState } {
  const r = Math.random();
  if (r < 0.55) return { emoji: BOMB_EMOJIS[Math.floor(Math.random() * BOMB_EMOJIS.length)], state: 'bomb' };
  return { emoji: EMPTY_EMOJIS[Math.floor(Math.random() * EMPTY_EMOJIS.length)], state: 'empty' };
}

export default function DemineurInverse() {
  const [phase, setPhase] = useState<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [pickedCell, setPickedCell] = useState<number | null>(null);
  const [revealStep, setRevealStep] = useState(0); // 0=none, 1=winner shown, 2=all revealed

  useEffect(() => {
    fetchPrizes().then((p) => {
      setPrizes(p);
      setPhase('ready');
    });
  }, []);

  const initGrid = useCallback(() => {
    const grid: Cell[] = Array.from({ length: 9 }, (_, i) => ({
      id: i,
      state: 'closed' as CellState,
      revealDelay: 0,
      emoji: '',
    }));
    setCells(grid);
    setPickedCell(null);
    setRevealStep(0);
    setWonPrize(null);
  }, []);

  const start = () => {
    initGrid();
    setPhase('playing');
  };

  const handleCellClick = useCallback(
    (cellId: number) => {
      if (phase !== 'playing' || pickedCell !== null) return;

      getSoundEngine().reveal();
      setPickedCell(cellId);

      // This cell is always the winner
      const prize = selectRandomPrize(prizes);
      setWonPrize(prize);

      // Build the rest of the grid with decoys
      setCells((prev) =>
        prev.map((cell) => {
          if (cell.id === cellId) {
            return { ...cell, state: 'winner', emoji: prize.emoji, revealDelay: 0 };
          }
          const decoy = generateDecoyContent();
          const dist = Math.abs((cell.id % 3) - (cellId % 3)) + Math.abs(Math.floor(cell.id / 3) - Math.floor(cellId / 3));
          return { ...cell, ...decoy, revealDelay: dist * 120 + 600 };
        }),
      );

      setRevealStep(1);

      // After pause — reveal all bombs
      setTimeout(() => {
        setRevealStep(2);
        // Then victory
        setTimeout(() => {
          setPhase('victory');
        }, 1200);
      }, 800);
    },
    [phase, pickedCell, prizes],
  );

  const getCellBg = (cell: Cell): string => {
    if (cell.state === 'closed') return 'rgba(255,255,255,0.06)';
    if (cell.state === 'winner') return 'rgba(0,224,150,0.15)';
    if (cell.state === 'bomb') return 'rgba(255,61,113,0.1)';
    return 'rgba(255,255,255,0.03)';
  };

  const getCellBorder = (cell: Cell): string => {
    if (cell.state === 'closed') return 'rgba(255,255,255,0.1)';
    if (cell.state === 'winner') return '#00E096';
    if (cell.state === 'bomb') return 'rgba(255,61,113,0.3)';
    return 'rgba(255,255,255,0.05)';
  };

  const isCellVisible = (cell: Cell): boolean => {
    if (cell.state === 'closed') return false;
    if (cell.state === 'winner') return revealStep >= 1;
    return revealStep >= 2;
  };

  return (
    <div
      className="game-container noise-overlay flex flex-col items-center justify-center"
      style={{
        background: 'radial-gradient(ellipse at 50% 30%, #1e1145 0%, #0c0a1a 60%, #050410 100%)',
      }}
    >
      {/* Atmospheric glow */}
      <div
        className="absolute top-[20%] left-1/2 -translate-x-1/2 w-[300px] h-[300px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)',
        }}
      />

      {/* Title area */}
      {phase === 'playing' && (
        <div
          className="mb-8 text-center"
          style={{ animation: 'fadeInUp 0.5s ease-out both' }}
        >
          <h2 className="text-white/40 text-xs font-semibold tracking-[0.25em] uppercase mb-2">
            Choisissez une case
          </h2>
          <p className="text-white/25 text-[11px]">
            {pickedCell === null ? 'Touchez pour révéler' : revealStep < 2 ? 'Bravo !' : 'Regardez ce que vous avez évité…'}
          </p>
        </div>
      )}

      {/* Grid */}
      {(phase === 'playing' || phase === 'ready') && phase === 'playing' && (
        <div
          className="grid grid-cols-3 gap-3 w-[min(80vw,320px)]"
          style={{ animation: 'scaleIn 0.4s ease-out both' }}
        >
          {cells.map((cell) => {
            const isVisible = isCellVisible(cell);
            const isWinner = cell.state === 'winner' && isVisible;
            const isBomb = cell.state === 'bomb' && isVisible;
            const isPicked = cell.id === pickedCell;

            return (
              <button
                key={cell.id}
                onClick={() => handleCellClick(cell.id)}
                disabled={pickedCell !== null}
                className="relative aspect-square rounded-2xl transition-all duration-500 ease-out overflow-hidden"
                style={{
                  background: isVisible ? getCellBg(cell) : 'rgba(255,255,255,0.06)',
                  border: `1.5px solid ${isVisible ? getCellBorder(cell) : 'rgba(255,255,255,0.08)'}`,
                  boxShadow: isWinner
                    ? '0 0 40px rgba(0,224,150,0.25), inset 0 0 30px rgba(0,224,150,0.1)'
                    : isBomb
                      ? '0 0 20px rgba(255,61,113,0.15)'
                      : pickedCell === null
                        ? '0 2px 8px rgba(0,0,0,0.2)'
                        : 'none',
                  transform: isWinner ? 'scale(1.05)' : isBomb && isVisible ? 'scale(0.95)' : 'scale(1)',
                  transitionDelay: isVisible && !isPicked ? `${cell.revealDelay}ms` : '0ms',
                  cursor: pickedCell === null ? 'pointer' : 'default',
                }}
              >
                {/* Closed state — shimmer effect */}
                {!isVisible && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div
                      className="w-10 h-10 rounded-xl"
                      style={{
                        background: 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      <div className="w-full h-full flex items-center justify-center text-lg text-white/20">
                        ?
                      </div>
                    </div>
                  </div>
                )}

                {/* Revealed content */}
                {isVisible && (
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center gap-1"
                    style={{ animation: 'scaleIn 0.35s ease-out both' }}
                  >
                    <span className={`${isWinner ? 'text-4xl' : 'text-3xl'}`}>
                      {cell.emoji || (cell.state === 'empty' ? '·' : '')}
                    </span>
                    {isWinner && wonPrize && (
                      <span className="text-[10px] font-bold text-emerald-400 tracking-wide">
                        {wonPrize.name}
                      </span>
                    )}
                  </div>
                )}

                {/* Winner ring pulse */}
                {isWinner && (
                  <div
                    className="absolute inset-[-2px] rounded-2xl border-2 border-emerald-400/40 pointer-events-none"
                    style={{ animation: 'victoryPulse 1.5s ease-in-out infinite' }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Ready screen */}
      {phase === 'ready' && (
        <div className="flex flex-col items-center gap-6 z-20 px-8">
          {/* Grid preview */}
          <div className="grid grid-cols-3 gap-2 w-[140px] mb-2">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square rounded-lg"
                style={{
                  background: i === 4
                    ? 'rgba(0,224,150,0.15)'
                    : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${i === 4 ? 'rgba(0,224,150,0.3)' : 'rgba(255,255,255,0.06)'}`,
                  animation: `fadeInUp 0.5s ease-out ${i * 0.04}s both`,
                }}
              >
                <div className="w-full h-full flex items-center justify-center text-sm">
                  {i === 4 ? '🎁' : <span className="text-white/15">?</span>}
                </div>
              </div>
            ))}
          </div>

          <h1
            className="text-[30px] font-extrabold text-white tracking-tight text-center leading-tight"
            style={{ animation: 'fadeInUp 0.6s ease-out 0.2s both' }}
          >
            La Matrice
          </h1>
          <p
            className="text-white/40 text-[14px] text-center max-w-[260px] leading-relaxed"
            style={{ animation: 'fadeInUp 0.6s ease-out 0.3s both' }}
          >
            9 cases. 1 seule contient votre cadeau.
            <br />Aurez-vous de la chance ?
          </p>
          <button
            onClick={start}
            className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-lg tracking-wide transition-all duration-200 active:scale-[0.96]"
            style={{
              background: 'linear-gradient(135deg, #8b5cf6, #a855f7)',
              boxShadow: '0 12px 40px -10px rgba(139,92,246,0.5)',
              animation: 'fadeInUp 0.6s ease-out 0.4s both',
            }}
          >
            Tenter ma chance
          </button>
        </div>
      )}

      {phase === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: '#0c0a1a' }}>
          <div
            className="w-8 h-8 border-2 border-white/20 border-t-purple-400 rounded-full"
            style={{ animation: 'spin 0.8s linear infinite' }}
          />
        </div>
      )}

      {phase === 'victory' && wonPrize && (
        <VictoryScreen
          prize={wonPrize}
          onClose={() => setPhase('ready')}
          accentFrom="#8b5cf6"
          accentTo="#06b6d4"
        />
      )}
    </div>
  );
}
