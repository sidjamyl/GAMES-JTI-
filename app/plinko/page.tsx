'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';

/* ═══════════════════════════════════════════════
   PLINKO — Rigged peg bouncing
   Ball ALWAYS lands in the winning slot
   ═══════════════════════════════════════════════ */

const PEG_ROWS = 8;
const PEG_COLS = 7;
const PEG_RADIUS = 5;
const BALL_RADIUS = 10;
const GRAVITY = 0.22;
const BOUNCE_DAMPING = 0.6;
const HORIZONTAL_DAMPING = 0.95;
const SLOT_COUNT = PEG_COLS + 1; // 8 slots at the bottom

const ACCENT_COLORS = [
  '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
  '#10b981', '#f97316', '#ec4899', '#3b82f6',
];

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  trail: { x: number; y: number; age: number }[];
}

interface Peg {
  x: number;
  y: number;
  hitAge: number; // frames since hit (for glow animation)
}

export default function Plinko() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const phaseRef = useRef<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [canDrop, setCanDrop] = useState(true);
  const ballRef = useRef<Ball | null>(null);
  const pegsRef = useRef<Peg[]>([]);
  const animRef = useRef<number>(0);
  const dprRef = useRef(1);
  const targetSlotRef = useRef(3);

  // Computed geometry
  const geoRef = useRef({
    pegSpacingX: 0,
    pegSpacingY: 0,
    boardTop: 0,
    boardLeft: 0,
    slotWidth: 0,
    slotY: 0,
    w: 0,
    h: 0,
  });

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    fetchPrizes().then((p) => {
      setPrizes(p);
      setPhase('ready');
    });
  }, []);

  const computeGeometry = useCallback((w: number, h: number) => {
    const boardPadding = w * 0.1;
    const boardWidth = w - boardPadding * 2;
    const boardTop = h * 0.14;
    const boardBottom = h * 0.78;
    const boardHeight = boardBottom - boardTop;

    const pegSpacingX = boardWidth / (PEG_COLS - 1);
    const pegSpacingY = boardHeight / (PEG_ROWS - 1);
    const slotWidth = boardWidth / SLOT_COUNT;
    const slotY = boardBottom + 20;

    geoRef.current = { pegSpacingX, pegSpacingY, boardTop, boardLeft: boardPadding, slotWidth, slotY, w, h };

    // Generate pegs
    const pegs: Peg[] = [];
    for (let row = 0; row < PEG_ROWS; row++) {
      const cols = row % 2 === 0 ? PEG_COLS : PEG_COLS - 1;
      const offset = row % 2 === 0 ? 0 : pegSpacingX / 2;
      for (let col = 0; col < cols; col++) {
        pegs.push({
          x: boardPadding + offset + col * pegSpacingX,
          y: boardTop + row * pegSpacingY,
          hitAge: -1,
        });
      }
    }
    pegsRef.current = pegs;
  }, []);

  // Resize
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    computeGeometry(rect.width, rect.height);
  }, [computeGeometry]);

  const getSlotCenterX = (slotIndex: number): number => {
    const g = geoRef.current;
    return g.boardLeft + (slotIndex + 0.5) * (g.w - g.boardLeft * 2) / SLOT_COUNT;
  };

  const dropBall = useCallback(
    (tapX: number) => {
      if (!canDrop || phaseRef.current !== 'playing') return;
      setCanDrop(false);

      const prize = selectRandomPrize(prizes);
      setWonPrize(prize);
      targetSlotRef.current = Math.floor(Math.random() * SLOT_COUNT);

      const g = geoRef.current;
      // Clamp start X within board
      const minX = g.boardLeft + BALL_RADIUS;
      const maxX = g.w - g.boardLeft - BALL_RADIUS;
      const startX = Math.max(minX, Math.min(maxX, tapX));

      ballRef.current = {
        x: startX,
        y: 28,
        vx: 0,
        vy: 0,
        trail: [],
      };
    },
    [canDrop, prizes],
  );

  // Determine ideal bias at each peg to steer toward target
  const computeBias = (ballX: number, ballY: number): number => {
    const targetX = getSlotCenterX(targetSlotRef.current);
    const dx = targetX - ballX;
    const g = geoRef.current;
    const distToBottom = g.slotY - ballY;
    // Stronger bias near bottom
    const urgency = Math.max(0.1, 1 - distToBottom / (g.slotY - g.boardTop));
    const bias = Math.sign(dx) * (0.3 + urgency * 0.9);
    return bias;
  };

  // Main game loop
  useEffect(() => {
    if (phase !== 'playing' && phase !== 'ready') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    resize();
    window.addEventListener('resize', resize);

    const loop = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = dprRef.current;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const g = geoRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // ── Background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#0f0c29');
      bgGrad.addColorStop(0.5, '#1a1040');
      bgGrad.addColorStop(1, '#0f0c29');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Subtle grid
      ctx.strokeStyle = 'rgba(255,255,255,0.015)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < w; gx += 30) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = 0; gy < h; gy += 30) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      // ── Pegs
      for (const peg of pegsRef.current) {
        if (peg.hitAge >= 0) peg.hitAge++;

        const glowAlpha = peg.hitAge >= 0 ? Math.max(0, 1 - peg.hitAge / 20) : 0;

        if (glowAlpha > 0) {
          ctx.beginPath();
          ctx.arc(peg.x, peg.y, PEG_RADIUS * 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(245,158,11,${glowAlpha * 0.3})`;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(peg.x, peg.y, PEG_RADIUS, 0, Math.PI * 2);
        const pegGrad = ctx.createRadialGradient(
          peg.x - 1, peg.y - 1, 0,
          peg.x, peg.y, PEG_RADIUS,
        );
        pegGrad.addColorStop(0, glowAlpha > 0 ? `rgba(255,200,50,${0.8 + glowAlpha * 0.2})` : 'rgba(255,255,255,0.35)');
        pegGrad.addColorStop(1, glowAlpha > 0 ? 'rgba(245,158,11,0.6)' : 'rgba(255,255,255,0.1)');
        ctx.fillStyle = pegGrad;
        ctx.fill();
      }

      // ── Slots at bottom
      const slotW = (w - g.boardLeft * 2) / SLOT_COUNT;
      for (let s = 0; s < SLOT_COUNT; s++) {
        const sx = g.boardLeft + s * slotW;
        const isTarget = s === targetSlotRef.current && ballRef.current === null && !canDrop;
        const color = ACCENT_COLORS[s % ACCENT_COLORS.length];

        ctx.fillStyle = isTarget ? color + '40' : 'rgba(255,255,255,0.03)';
        ctx.beginPath();
        ctx.roundRect(sx + 2, g.slotY, slotW - 4, 36, 8);
        ctx.fill();

        ctx.strokeStyle = isTarget ? color : 'rgba(255,255,255,0.06)';
        ctx.lineWidth = isTarget ? 2 : 1;
        ctx.stroke();

        // Slot multiplier text
        const labels = ['5×', '3×', '2×', '1×', '1×', '2×', '3×', '5×'];
        ctx.fillStyle = isTarget ? color : 'rgba(255,255,255,0.2)';
        ctx.font = `bold ${isTarget ? 13 : 11}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillText(labels[s] || '', sx + slotW / 2, g.slotY + 22);
      }

      // ── Ball physics & render
      const ball = ballRef.current;
      if (ball) {
        // Physics
        ball.vy += GRAVITY;
        ball.vx *= HORIZONTAL_DAMPING;
        ball.x += ball.vx;
        ball.y += ball.vy;

        // Peg collision
        for (const peg of pegsRef.current) {
          const dx = ball.x - peg.x;
          const dy = ball.y - peg.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = PEG_RADIUS + BALL_RADIUS;

          if (dist < minDist && dist > 0) {
            // Bounce off
            const nx = dx / dist;
            const ny = dy / dist;
            const relVel = ball.vx * nx + ball.vy * ny;

            if (relVel < 0) {
              ball.vx -= 2 * relVel * nx * BOUNCE_DAMPING;
              ball.vy -= 2 * relVel * ny * BOUNCE_DAMPING;

              // Apply rigging bias
              const bias = computeBias(ball.x, ball.y);
              ball.vx += bias;

              // Push out of peg
              const overlap = minDist - dist;
              ball.x += nx * overlap;
              ball.y += ny * overlap;

              peg.hitAge = 0;

              // Sound
              try {
                const pitch = 0.8 + Math.random() * 0.4;
                getSoundEngine().peg(pitch);
              } catch { /* silent */ }
            }
          }
        }

        // Wall bounce
        if (ball.x < g.boardLeft + BALL_RADIUS) {
          ball.x = g.boardLeft + BALL_RADIUS;
          ball.vx = Math.abs(ball.vx) * 0.5;
        }
        if (ball.x > w - g.boardLeft - BALL_RADIUS) {
          ball.x = w - g.boardLeft - BALL_RADIUS;
          ball.vx = -Math.abs(ball.vx) * 0.5;
        }

        // Trail
        ball.trail.push({ x: ball.x, y: ball.y, age: 0 });
        if (ball.trail.length > 24) ball.trail.shift();
        for (const t of ball.trail) t.age++;

        // Draw trail
        for (const t of ball.trail) {
          const alpha = Math.max(0, 1 - t.age / 24) * 0.4;
          const r = BALL_RADIUS * (1 - t.age / 24) * 0.6;
          ctx.beginPath();
          ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(245,158,11,${alpha})`;
          ctx.fill();
        }

        // Draw ball
        const ballGrad = ctx.createRadialGradient(
          ball.x - 3, ball.y - 3, 0,
          ball.x, ball.y, BALL_RADIUS,
        );
        ballGrad.addColorStop(0, '#FFE066');
        ballGrad.addColorStop(0.5, '#F59E0B');
        ballGrad.addColorStop(1, '#D97706');
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = ballGrad;
        ctx.fill();

        // Ball highlight
        ctx.beginPath();
        ctx.arc(ball.x - 2.5, ball.y - 2.5, BALL_RADIUS * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fill();

        // Ball glow
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, BALL_RADIUS * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(245,158,11,0.08)';
        ctx.fill();

        // Check if ball reached slot zone
        if (ball.y > g.slotY + 10) {
          // Determine which slot (force target)
          getSoundEngine().swish();
          ballRef.current = null;

          setTimeout(() => {
            setPhase('victory');
          }, 600);
        }
      }

      // ── Drop zone indicator
      if (canDrop && phaseRef.current === 'playing') {
        ctx.fillStyle = 'rgba(245,158,11,0.06)';
        ctx.fillRect(g.boardLeft, 0, w - g.boardLeft * 2, 50);
        ctx.strokeStyle = 'rgba(245,158,11,0.15)';
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.boardLeft, 50);
        ctx.lineTo(w - g.boardLeft, 50);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('APPUYEZ POUR LÂCHER LA BILLE', w / 2, 32);
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [phase, canDrop, resize, computeBias]);

  const handleCanvasInteraction = (e: React.TouchEvent | React.MouseEvent) => {
    if (phaseRef.current !== 'playing' || !canDrop) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const x = clientX - rect.left;
    dropBall(x);
  };

  const start = () => {
    setCanDrop(true);
    setWonPrize(null);
    ballRef.current = null;
    pegsRef.current.forEach((p) => (p.hitAge = -1));
    setPhase('playing');
  };

  return (
    <div
      className="game-container noise-overlay flex flex-col items-center justify-center"
      style={{
        background: '#0f0c29',
      }}
    >
      {(phase === 'playing') && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ touchAction: 'none' }}
          onTouchStart={handleCanvasInteraction}
          onMouseDown={handleCanvasInteraction}
        />
      )}

      {/* Ready screen */}
      {phase === 'ready' && (
        <div className="flex flex-col items-center gap-6 z-20 px-8">
          {/* Decorative plinko preview */}
          <div className="relative w-[120px] h-[140px] mb-2">
            {[...Array(5)].map((_, row) =>
              [...Array(row % 2 === 0 ? 4 : 3)].map((__, col) => (
                <div
                  key={`${row}-${col}`}
                  className="absolute w-2.5 h-2.5 rounded-full"
                  style={{
                    background: 'rgba(245,158,11,0.3)',
                    left: `${(row % 2 === 0 ? col * 30 + 10 : col * 30 + 25)}px`,
                    top: `${row * 28 + 10}px`,
                    animation: `fadeIn 0.4s ease-out ${(row * 4 + col) * 0.04}s both`,
                  }}
                />
              )),
            )}
            {/* Ball */}
            <div
              className="absolute w-5 h-5 rounded-full"
              style={{
                background: 'radial-gradient(circle at 35% 35%, #FFE066, #F59E0B)',
                boxShadow: '0 0 20px rgba(245,158,11,0.4)',
                left: '50px',
                top: '0px',
                animation: 'victoryFloat 2s ease-in-out infinite',
              }}
            />
          </div>

          <h1
            className="text-[30px] font-extrabold text-white tracking-tight text-center leading-tight"
            style={{ animation: 'fadeInUp 0.6s ease-out 0.2s both' }}
          >
            Plinko
          </h1>
          <p
            className="text-white/40 text-[14px] text-center max-w-[260px] leading-relaxed"
            style={{ animation: 'fadeInUp 0.6s ease-out 0.3s both' }}
          >
            Lâchez la bille et regardez-la rebondir
            <br />jusqu&apos;à votre cadeau !
          </p>
          <button
            onClick={start}
            className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-lg tracking-wide transition-all duration-200 active:scale-[0.96]"
            style={{
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              boxShadow: '0 12px 40px -10px rgba(245,158,11,0.5)',
              animation: 'fadeInUp 0.6s ease-out 0.4s both',
            }}
          >
            Lâcher la bille
          </button>
        </div>
      )}

      {phase === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: '#0f0c29' }}>
          <div
            className="w-8 h-8 border-2 border-white/20 border-t-amber-400 rounded-full"
            style={{ animation: 'spin 0.8s linear infinite' }}
          />
        </div>
      )}

      {phase === 'victory' && wonPrize && (
        <VictoryScreen
          prize={wonPrize}
          onClose={() => setPhase('ready')}
          accentFrom="#f59e0b"
          accentTo="#ef4444"
        />
      )}
    </div>
  );
}
