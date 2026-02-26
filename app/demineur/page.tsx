'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';

/* ═══════════════════════════════════════════════
   LA MATRICE — Infiltrate the Grid
   Multi-round hacking with scanning & decryption FX
   Always rigged: player wins every time
   ═══════════════════════════════════════════════ */

const GRID_COLS = 4;
const GRID_ROWS = 4;
const TOTAL_CELLS = GRID_COLS * GRID_ROWS;
const ROUNDS = 3;

const ACCENT_FROM = '#8b5cf6';
const ACCENT_TO = '#06b6d4';

const SYMBOLS = ['⟐', '⌬', '⏣', '⎔', '◈', '⟁', '⬡', '⏢', '◉', '⟟', '⬢', '△', '□', '◇', '⏥', '⎈'];
const GLITCH_CHARS = '01アイウエオカキクケコサシスセソ'.split('');

type CellStatus = 'hidden' | 'scanning' | 'locked' | 'safe' | 'danger' | 'winner' | 'eliminated';

interface Cell {
  id: number;
  status: CellStatus;
  symbol: string;
}

export default function Matrice() {
  const [phase, setPhase] = useState<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [round, setRound] = useState(0);
  const [scanProgress, setScanProgress] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [statusText, setStatusText] = useState('');
  const [glitchText, setGlitchText] = useState('');
  const [activeCells, setActiveCells] = useState<Set<number>>(new Set());
  const [scanLineY, setScanLineY] = useState(0);

  const phaseRef = useRef<GamePhase>('loading');
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const glitchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanAnimRef = useRef<number>(0);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    fetchPrizes().then((p) => {
      setPrizes(p);
      setPhase('ready');
    });
  }, []);

  // Glitch text effect
  useEffect(() => {
    if (phase === 'playing') {
      glitchIntervalRef.current = setInterval(() => {
        const len = 12 + Math.floor(Math.random() * 8);
        setGlitchText(
          Array.from({ length: len }, () => GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]).join('')
        );
      }, 80);
      return () => {
        if (glitchIntervalRef.current) clearInterval(glitchIntervalRef.current);
      };
    }
  }, [phase]);

  // Scan line animation
  useEffect(() => {
    if (isScanning) {
      const animate = () => {
        setScanLineY(prev => (prev + 1.5) % 110);
        scanAnimRef.current = requestAnimationFrame(animate);
      };
      scanAnimRef.current = requestAnimationFrame(animate);
      return () => cancelAnimationFrame(scanAnimRef.current);
    }
  }, [isScanning]);

  const generateCells = useCallback((): Cell[] => {
    return Array.from({ length: TOTAL_CELLS }, (_, i) => ({
      id: i,
      status: 'hidden' as CellStatus,
      symbol: SYMBOLS[i % SYMBOLS.length],
    }));
  }, []);

  const startGame = useCallback(() => {
    setCells(generateCells());
    setRound(1);
    setScanProgress(0);
    setIsScanning(false);
    setSelectedCell(null);
    setWonPrize(null);
    setStatusText('SÉLECTIONNEZ UN NŒUD');
    setActiveCells(new Set(Array.from({ length: TOTAL_CELLS }, (_, i) => i)));
    setPhase('playing');
  }, [generateCells]);

  const runScanAnimation = useCallback((cellId: number, currentRound: number, currentPrizes: Prize[]) => {
    setIsScanning(true);
    setScanProgress(0);
    setStatusText('ANALYSE EN COURS...');

    let progress = 0;
    scanIntervalRef.current = setInterval(() => {
      progress += 2 + Math.random() * 3;
      if (progress >= 100) {
        progress = 100;
        if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);

        setIsScanning(false);
        setScanProgress(100);

        setTimeout(() => {
          setActiveCells(prev => {
            const active = Array.from(prev);
            const keepCount = currentRound >= ROUNDS ? 1 : Math.max(Math.ceil(active.length * 0.45), 2);

            const toKeep = new Set<number>([cellId]);
            const others = active.filter(id => id !== cellId);
            while (toKeep.size < keepCount && others.length > 0) {
              const idx = Math.floor(Math.random() * others.length);
              toKeep.add(others.splice(idx, 1)[0]);
            }

            const eliminated = active.filter(id => !toKeep.has(id));

            setCells(prev =>
              prev.map(c => {
                if (eliminated.includes(c.id)) return { ...c, status: 'danger' };
                if (toKeep.has(c.id) && c.id !== cellId) return { ...c, status: 'safe' };
                if (c.id === cellId) return { ...c, status: 'locked' };
                return c;
              })
            );

            getSoundEngine().reveal();

            eliminated.forEach((id, i) => {
              setTimeout(() => {
                setCells(prev => prev.map(c => c.id === id ? { ...c, status: 'eliminated' } : c));
                getSoundEngine().peg(i);
              }, i * 80);
            });

            if (currentRound >= ROUNDS) {
              setStatusText('DÉCRYPTAGE RÉUSSI ✓');
              const prize = selectRandomPrize(currentPrizes);
              setWonPrize(prize);
              setTimeout(() => {
                setCells(prev => prev.map(c => c.id === cellId ? { ...c, status: 'winner' } : c));
                setTimeout(() => setPhase('victory'), 1200);
              }, 800);
            } else {
              setTimeout(() => {
                setStatusText('SÉLECTIONNEZ UN NŒUD');
                setSelectedCell(null);
                setRound(currentRound + 1);
                setCells(prev =>
                  prev.map(c => {
                    if (c.status === 'locked' || c.status === 'safe') return { ...c, status: 'hidden' };
                    return c;
                  })
                );
              }, 600);
            }

            return toKeep;
          });
        }, 300);
      }
      setScanProgress(Math.min(progress, 100));
    }, 30);
  }, []);

  const handleCellClick = useCallback((cellId: number) => {
    if (phase !== 'playing' || isScanning || selectedCell !== null) return;
    if (!activeCells.has(cellId)) return;

    getSoundEngine().impact();
    setSelectedCell(cellId);
    setCells(prev => prev.map(c => c.id === cellId ? { ...c, status: 'scanning' } : c));

    setTimeout(() => {
      runScanAnimation(cellId, round, prizes);
    }, 400);
  }, [phase, isScanning, selectedCell, activeCells, round, prizes, runScanAnimation]);

  useEffect(() => {
    return () => {
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
      if (glitchIntervalRef.current) clearInterval(glitchIntervalRef.current);
    };
  }, []);

  const getCellStyle = (cell: Cell): React.CSSProperties => {
    const isActive = activeCells.has(cell.id);
    const base: React.CSSProperties = { transition: 'all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)' };

    switch (cell.status) {
      case 'hidden':
        return {
          ...base,
          background: isActive ? 'rgba(139,92,246,0.08)' : 'rgba(255,255,255,0.02)',
          border: `1.5px solid ${isActive ? 'rgba(139,92,246,0.25)' : 'rgba(255,255,255,0.04)'}`,
          boxShadow: isActive ? '0 0 20px rgba(139,92,246,0.1)' : 'none',
          cursor: isActive && !isScanning ? 'pointer' : 'default',
          opacity: isActive ? 1 : 0.3,
        };
      case 'scanning':
        return {
          ...base,
          background: 'rgba(139,92,246,0.2)',
          border: '1.5px solid rgba(139,92,246,0.6)',
          boxShadow: '0 0 30px rgba(139,92,246,0.3), inset 0 0 20px rgba(139,92,246,0.15)',
          animation: 'subtlePulse 0.5s ease-in-out infinite',
        };
      case 'locked':
        return {
          ...base,
          background: 'rgba(6,182,212,0.15)',
          border: '1.5px solid rgba(6,182,212,0.5)',
          boxShadow: '0 0 25px rgba(6,182,212,0.2)',
        };
      case 'safe':
        return {
          ...base,
          background: 'rgba(139,92,246,0.08)',
          border: '1.5px solid rgba(139,92,246,0.2)',
        };
      case 'danger':
        return {
          ...base,
          background: 'rgba(239,68,68,0.1)',
          border: '1.5px solid rgba(239,68,68,0.3)',
        };
      case 'eliminated':
        return {
          ...base,
          background: 'rgba(239,68,68,0.05)',
          border: '1.5px solid rgba(255,255,255,0.03)',
          opacity: 0.15,
          transform: 'scale(0.9)',
        };
      case 'winner':
        return {
          ...base,
          background: 'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(6,182,212,0.25))',
          border: '2px solid rgba(6,182,212,0.7)',
          boxShadow: '0 0 50px rgba(6,182,212,0.4), 0 0 100px rgba(139,92,246,0.2)',
          transform: 'scale(1.08)',
        };
      default:
        return base;
    }
  };

  return (
    <div
      className="game-container noise-overlay flex flex-col items-center"
      style={{
        background: 'radial-gradient(ellipse at 50% 20%, #1a1145 0%, #0a0818 50%, #030208 100%)',
        overflow: 'hidden',
      }}
    >
      {/* Grid lines background */}
      <div className="absolute inset-0 pointer-events-none" style={{ opacity: 0.04 }}>
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={`h${i}`} className="absolute w-full" style={{
            top: `${i * 5}%`, height: '1px',
            background: 'linear-gradient(90deg, transparent, rgba(139,92,246,0.5), transparent)',
          }} />
        ))}
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={`v${i}`} className="absolute h-full" style={{
            left: `${i * 5}%`, width: '1px',
            background: 'linear-gradient(180deg, transparent, rgba(139,92,246,0.5), transparent)',
          }} />
        ))}
      </div>

      {/* Scan line overlay */}
      {isScanning && (
        <div
          className="absolute left-0 right-0 h-[2px] pointer-events-none z-30"
          style={{
            top: `${scanLineY}%`,
            background: 'linear-gradient(90deg, transparent, rgba(6,182,212,0.8), transparent)',
            boxShadow: '0 0 20px rgba(6,182,212,0.5), 0 0 60px rgba(6,182,212,0.2)',
          }}
        />
      )}

      {/* ── Header ── */}
      <div className="w-full max-w-[400px] flex flex-col items-center pt-12 pb-4 z-10" style={{ animation: 'fadeInUp 0.5s ease-out both' }}>
        <h1
          className="text-[24px] font-black tracking-[0.15em] uppercase text-center"
          style={{
            background: `linear-gradient(135deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          LA MATRICE
        </h1>
        {phase === 'playing' && (
          <div className="mt-1 h-4 overflow-hidden">
            <span className="text-[10px] font-mono tracking-[0.3em]" style={{ color: 'rgba(6,182,212,0.3)' }}>
              {glitchText}
            </span>
          </div>
        )}
      </div>

      {/* ── Status HUD ── */}
      {phase === 'playing' && (
        <div className="w-full max-w-[400px] px-6 z-10" style={{ animation: 'fadeIn 0.3s ease-out both' }}>
          {/* Round progress */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {Array.from({ length: ROUNDS }).map((_, i) => (
                <div
                  key={i}
                  className="w-8 h-1 rounded-full transition-all duration-500"
                  style={{
                    background: i < round ? `linear-gradient(90deg, ${ACCENT_FROM}, ${ACCENT_TO})` : 'rgba(255,255,255,0.08)',
                    boxShadow: i < round ? `0 0 8px ${ACCENT_FROM}40` : 'none',
                  }}
                />
              ))}
            </div>
            <span className="text-[11px] font-mono text-white/30 uppercase tracking-wider">
              Phase {round}/{ROUNDS}
            </span>
          </div>

          {/* Status */}
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{
                background: isScanning ? '#06b6d4' : ACCENT_FROM,
                boxShadow: `0 0 8px ${isScanning ? '#06b6d4' : ACCENT_FROM}`,
                animation: isScanning ? 'subtlePulse 0.5s ease-in-out infinite' : undefined,
              }}
            />
            <span className="text-[12px] font-mono text-white/50 tracking-wider uppercase">{statusText}</span>
          </div>

          {/* Scan progress bar */}
          {isScanning && (
            <div className="w-full mb-4">
              <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <div
                  className="h-full rounded-full transition-all duration-100"
                  style={{
                    width: `${scanProgress}%`,
                    background: `linear-gradient(90deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
                    boxShadow: `0 0 10px ${ACCENT_TO}60`,
                  }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[9px] font-mono text-white/20">{Math.floor(scanProgress)}%</span>
                <span className="text-[9px] font-mono text-white/20">SCAN</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Game Grid ── */}
      <div className="flex-1 flex items-center justify-center w-full max-w-[400px] px-4 z-10">
        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-3" style={{ animation: 'fadeIn 0.3s ease-out both' }}>
            <div
              className="w-8 h-8 rounded-full border-2 border-t-transparent"
              style={{ borderColor: `${ACCENT_FROM} transparent ${ACCENT_FROM} ${ACCENT_FROM}`, animation: 'spin 0.8s linear infinite' }}
            />
            <p className="text-white/30 text-sm font-mono">INITIALISATION…</p>
          </div>
        )}

        {phase === 'ready' && (
          <div className="flex flex-col items-center gap-6" style={{ animation: 'fadeInUp 0.6s ease-out both' }}>
            <div className="grid grid-cols-4 gap-1.5 w-[160px] mb-4">
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-lg flex items-center justify-center"
                  style={{
                    background: 'rgba(139,92,246,0.06)',
                    border: '1px solid rgba(139,92,246,0.15)',
                    animation: `fadeIn 0.4s ease-out ${i * 0.03}s both`,
                  }}
                >
                  <span className="text-[10px] font-mono" style={{ color: 'rgba(139,92,246,0.25)' }}>{SYMBOLS[i]}</span>
                </div>
              ))}
            </div>
            <p className="text-white/25 text-[10px] font-mono tracking-[0.2em] uppercase">SYSTÈME DE DÉCRYPTAGE v3.1</p>
            <h2 className="text-[26px] font-black text-white tracking-tight text-center">Infiltrez la Matrice</h2>
            <p className="text-white/35 text-[13px] text-center max-w-[260px] leading-relaxed">
              Sélectionnez des nœuds pour scanner le réseau.<br />
              <span className="text-white/20 text-[11px]">3 phases d&apos;analyse · 1 cadeau caché</span>
            </p>
            <button
              onClick={startGame}
              className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-[15px] tracking-wide transition-all duration-200 active:scale-[0.96]"
              style={{
                background: `linear-gradient(135deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
                boxShadow: `0 12px 40px -10px ${ACCENT_FROM}80`,
              }}
            >
              Lancer le scan ⟐
            </button>
          </div>
        )}

        {phase === 'playing' && (
          <div className="w-full max-w-[340px]">
            <div className="grid grid-cols-4 gap-2.5" style={{ animation: 'scaleIn 0.4s ease-out both' }}>
              {cells.map((cell) => {
                const isActive = activeCells.has(cell.id);
                return (
                  <button
                    key={cell.id}
                    onClick={() => handleCellClick(cell.id)}
                    disabled={!isActive || isScanning || selectedCell !== null || cell.status === 'eliminated'}
                    className="relative aspect-square rounded-xl overflow-hidden"
                    style={getCellStyle(cell)}
                  >
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                      {cell.status === 'eliminated' ? (
                        <span className="text-sm" style={{ color: 'rgba(239,68,68,0.3)' }}>✕</span>
                      ) : cell.status === 'winner' && wonPrize ? (
                        <>
                          <span className="text-2xl">{wonPrize.emoji}</span>
                          <span className="text-[8px] font-bold" style={{ color: ACCENT_TO }}>{wonPrize.name}</span>
                        </>
                      ) : cell.status === 'danger' ? (
                        <span className="text-lg">⚠️</span>
                      ) : (
                        <>
                          <span
                            className="text-lg font-mono"
                            style={{
                              color: cell.status === 'scanning' ? ACCENT_FROM
                                : cell.status === 'locked' ? ACCENT_TO
                                  : isActive ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.1)',
                            }}
                          >
                            {cell.symbol}
                          </span>
                          {cell.status === 'locked' && (
                            <span className="text-[8px] font-mono" style={{ color: `${ACCENT_TO}80` }}>LOCK</span>
                          )}
                        </>
                      )}
                    </div>

                    {cell.status === 'scanning' && (
                      <div
                        className="absolute inset-[-2px] rounded-xl pointer-events-none"
                        style={{ border: `2px solid ${ACCENT_FROM}60`, animation: 'victoryPulse 1s ease-in-out infinite' }}
                      />
                    )}
                    {cell.status === 'winner' && (
                      <div
                        className="absolute inset-[-3px] rounded-xl pointer-events-none"
                        style={{ border: `2px solid ${ACCENT_TO}80`, animation: 'victoryPulse 1.5s ease-in-out infinite' }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-center mt-4">
              <span className="text-[10px] font-mono text-white/20 tracking-wider">
                {activeCells.size} NŒUD{activeCells.size > 1 ? 'S' : ''} ACTIF{activeCells.size > 1 ? 'S' : ''}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="h-8 flex-shrink-0" />

      {phase === 'victory' && wonPrize && (
        <VictoryScreen
          prize={wonPrize}
          onClose={() => setPhase('ready')}
          accentFrom={ACCENT_FROM}
          accentTo={ACCENT_TO}
        />
      )}
    </div>
  );
}
