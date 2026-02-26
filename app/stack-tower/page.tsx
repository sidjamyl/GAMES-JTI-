'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   STACK TOWER — Block stacking game
   Blocks slide L/R. Tap to place. Overhang cut.
   Height reached = prize tier.
   ═══════════════════════════════════════════════ */

interface Block {
  x: number;
  width: number;
  y: number;
  placed: boolean;
  color: string;
}

const BLOCK_HEIGHT = 28;
const BASE_SPEED = 2.5;

export default function StackTower({ theme }: { theme?: GameTheme }) {
  const T = { ...DEFAULT_THEME, ...theme };
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY } = T;
  const goldRgb = hexToRgb(GOLD);
  const creamRgb = hexToRgb(CREAM);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const phaseRef = useRef<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const animRef = useRef<number>(0);
  const dprRef = useRef(1);

  const blocksRef = useRef<Block[]>([]);
  const currentBlockRef = useRef<Block | null>(null);
  const directionRef = useRef(1);
  const speedRef = useRef(BASE_SPEED);
  const gameOverRef = useRef(false);
  const offsetRef = useRef(0); // camera Y offset
  const sizeRef = useRef({ w: 0, h: 0 });
  const fallingPiecesRef = useRef<{ x: number; y: number; w: number; vy: number; color: string }[]>([]);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); }); }, []);

  const getBlockColor = (index: number): string => {
    const colors = [GOLD, AMBER, GOLD_BRIGHT, SIENNA, GOLD, AMBER];
    return colors[index % colors.length];
  };

  const getPrizeForHeight = useCallback((height: number, prizes: Prize[]): Prize => {
    const sorted = [...prizes].filter(p => p.quantity > 0).sort((a, b) => a.quantity - b.quantity);
    if (sorted.length === 0) return prizes[0];
    if (height >= 15) return sorted[0];
    if (height >= 10) return sorted[Math.min(1, sorted.length - 1)];
    if (height >= 7) return sorted[Math.min(2, sorted.length - 1)];
    if (height >= 4) return sorted[Math.floor(sorted.length * 0.6)];
    return sorted[sorted.length - 1];
  }, []);

  useEffect(() => {
    if (phase !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const w = rect.width;
    const h = rect.height;
    sizeRef.current = { w, h };

    // Init base block
    const baseWidth = w * 0.4;
    const baseX = (w - baseWidth) / 2;
    const baseY = h - 60;
    blocksRef.current = [{ x: baseX, width: baseWidth, y: baseY, placed: true, color: getBlockColor(0) }];

    // First moving block
    const newBlock: Block = {
      x: 0,
      width: baseWidth,
      y: baseY - BLOCK_HEIGHT,
      placed: false,
      color: getBlockColor(1),
    };
    currentBlockRef.current = newBlock;
    directionRef.current = 1;
    speedRef.current = BASE_SPEED;
    gameOverRef.current = false;
    offsetRef.current = 0;
    fallingPiecesRef.current = [];

    const loop = () => {
      if (gameOverRef.current) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Background gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, BG_LIGHT);
      bgGrad.addColorStop(1, BG_DARK);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Camera offset (scroll up as tower grows)
      const blocks = blocksRef.current;
      const targetOffset = Math.max(0, (blocks.length - 8) * BLOCK_HEIGHT);
      offsetRef.current += (targetOffset - offsetRef.current) * 0.08;
      ctx.save();
      ctx.translate(0, offsetRef.current);

      // Draw placed blocks
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const grad = ctx.createLinearGradient(b.x, b.y, b.x + b.width, b.y + BLOCK_HEIGHT);
        grad.addColorStop(0, b.color + 'dd');
        grad.addColorStop(1, b.color + '99');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.width, BLOCK_HEIGHT - 2, 3);
        ctx.fill();

        // Border
        ctx.strokeStyle = CREAM + '15';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Highlight on top edge
        ctx.strokeStyle = CREAM + '20';
        ctx.beginPath();
        ctx.moveTo(b.x + 2, b.y + 1);
        ctx.lineTo(b.x + b.width - 2, b.y + 1);
        ctx.stroke();
      }

      // Current moving block
      const cur = currentBlockRef.current;
      if (cur && !cur.placed) {
        cur.x += speedRef.current * directionRef.current;
        if (cur.x + cur.width > w) directionRef.current = -1;
        if (cur.x < 0) directionRef.current = 1;

        const grad = ctx.createLinearGradient(cur.x, cur.y, cur.x + cur.width, cur.y + BLOCK_HEIGHT);
        grad.addColorStop(0, cur.color);
        grad.addColorStop(1, cur.color + 'bb');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(cur.x, cur.y, cur.width, BLOCK_HEIGHT - 2, 3);
        ctx.fill();

        // Glow
        ctx.shadowColor = cur.color;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Falling cut pieces
      for (let i = fallingPiecesRef.current.length - 1; i >= 0; i--) {
        const p = fallingPiecesRef.current[i];
        p.vy += 0.3;
        p.y += p.vy;
        if (p.y > h + offsetRef.current + 100) {
          fallingPiecesRef.current.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = p.color + '80';
        ctx.fillRect(p.x, p.y, p.w, BLOCK_HEIGHT - 2);
        ctx.globalAlpha = 1;
      }

      ctx.restore();

      // Height display
      const height = blocks.length - 1; // exclude base
      ctx.fillStyle = CREAM + '60';
      ctx.font = 'bold 14px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(`Étage: ${height}`, 16, 28);

      // Tier hints
      ctx.fillStyle = CREAM + '25';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'right';
      const hints = ['4→', '7→ Bien', '10→ Rare', '15→ Jackpot'];
      hints.forEach((hint, i) => {
        ctx.fillText(hint, w - 12, 20 + i * 14);
      });

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, prizes, GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, goldRgb, creamRgb]);

  const placeBlock = () => {
    if (phaseRef.current !== 'playing' || gameOverRef.current) return;
    const cur = currentBlockRef.current;
    if (!cur || cur.placed) return;
    const blocks = blocksRef.current;
    const prev = blocks[blocks.length - 1];

    // Calculate overlap
    const overlapLeft = Math.max(cur.x, prev.x);
    const overlapRight = Math.min(cur.x + cur.width, prev.x + prev.width);
    const overlapWidth = overlapRight - overlapLeft;

    if (overlapWidth <= 0) {
      // Missed completely — game over
      gameOverRef.current = true;
      try { getSoundEngine().miss(); } catch {}
      fallingPiecesRef.current.push({ x: cur.x, y: cur.y, w: cur.width, vy: 0, color: cur.color });

      const height = blocks.length - 1;
      const prize = height > 0 ? getPrizeForHeight(height, prizes) : selectRandomPrize(prizes);
      setWonPrize(prize);
      setTimeout(() => setPhase('victory'), 1000);
      return;
    }

    try { getSoundEngine().impact(); } catch {}

    // Cut the overhang
    if (cur.x < prev.x) {
      // Overhang on left
      const cutW = prev.x - cur.x;
      if (cutW > 1) {
        fallingPiecesRef.current.push({ x: cur.x, y: cur.y, w: cutW, vy: 0, color: cur.color });
      }
    }
    if (cur.x + cur.width > prev.x + prev.width) {
      // Overhang on right
      const cutW = (cur.x + cur.width) - (prev.x + prev.width);
      if (cutW > 1) {
        fallingPiecesRef.current.push({ x: prev.x + prev.width, y: cur.y, w: cutW, vy: 0, color: cur.color });
      }
    }

    // Place the overlapping part
    cur.x = overlapLeft;
    cur.width = overlapWidth;
    cur.placed = true;
    blocks.push(cur);

    // Perfect placement bonus
    if (Math.abs(overlapWidth - prev.width) < 3) {
      try { getSoundEngine().reveal(); } catch {}
      // Give back a bit of width
      cur.width = Math.min(cur.width + 4, prev.width);
    }

    // Check win condition (max height)
    const height = blocks.length - 1;
    if (height >= 20) {
      gameOverRef.current = true;
      const prize = getPrizeForHeight(height, prizes);
      setWonPrize(prize);
      try { getSoundEngine().swish(); } catch {}
      setTimeout(() => setPhase('victory'), 600);
      return;
    }

    // Spawn next block
    speedRef.current = BASE_SPEED + height * 0.15;
    const newBlock: Block = {
      x: directionRef.current > 0 ? 0 : sizeRef.current.w - overlapWidth,
      width: overlapWidth,
      y: cur.y - BLOCK_HEIGHT,
      placed: false,
      color: getBlockColor(height + 1),
    };
    currentBlockRef.current = newBlock;
  };

  const start = () => {
    setWonPrize(null);
    gameOverRef.current = false;
    setPhase('playing');
  };

  return (
    <div className="game-container noise-overlay flex flex-col items-center justify-center" style={{ background: BG_DARK }}>
      {phase === 'playing' && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ touchAction: 'none' }}
          onTouchStart={placeBlock}
          onMouseDown={placeBlock}
        />
      )}

      {phase === 'ready' && (
        <div className="flex flex-col items-center gap-6 z-20 px-8">
          <div className="flex flex-col items-center gap-1">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="rounded"
                style={{
                  width: `${80 - i * 8}px`,
                  height: '16px',
                  background: `linear-gradient(90deg, ${getBlockColor(3 - i)}, ${getBlockColor(3 - i)}bb)`,
                  animation: `fadeInUp 0.4s ease-out ${i * 0.1}s both`,
                }}
              />
            ))}
          </div>
          <h1 className="text-[32px] font-extrabold tracking-tight text-center" style={{
            background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Stack Tower</h1>
          <p className="text-[14px] text-center max-w-[260px] leading-relaxed" style={{ color: CREAM + '60' }}>
            Empilez les blocs le plus haut possible !<br/>Plus c&apos;est haut, meilleur le cadeau 🏆
          </p>
          <button onClick={start} className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-lg tracking-wide transition-all active:scale-[0.96]" style={{
            background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`,
            boxShadow: `0 12px 40px -10px ${GOLD}80`,
          }}>Commencer</button>
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
