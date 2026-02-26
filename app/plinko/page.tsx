'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   PLINKO — Themeable
   Premium aesthetic, no rigging.
   Slots show prize emojis at the bottom.
   ═══════════════════════════════════════════════ */

const PEG_ROWS = 10;
const PEG_COLS = 9;
const PEG_RADIUS = 4;
const BALL_RADIUS = 9;
const GRAVITY = 0.25;
const BOUNCE_DAMPING = 0.55;
const HORIZONTAL_DAMPING = 0.96;
const SLOT_COUNT = PEG_COLS + 1;

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
  hitAge: number;
}

export default function Plinko({ theme }: { theme?: GameTheme }) {
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, TOBACCO, MAHOGANY, SIENNA, BG_DARK, BG_MID, BG_LIGHT } = { ...DEFAULT_THEME, ...theme };
  const goldRgb = hexToRgb(GOLD);
  const amberRgb = hexToRgb(AMBER);
  const siennaRgb = hexToRgb(SIENNA);
  const creamRgb = hexToRgb(CREAM);
  const mahoganyRgb = hexToRgb(MAHOGANY);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const phaseRef = useRef<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [canDrop, setCanDrop] = useState(true);
  const [slotPrizes, setSlotPrizes] = useState<Prize[]>([]);
  const ballRef = useRef<Ball | null>(null);
  const pegsRef = useRef<Peg[]>([]);
  const slotPrizesRef = useRef<Prize[]>([]);
  const animRef = useRef<number>(0);
  const dprRef = useRef(1);

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

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); });
  }, []);

  const computeGeometry = useCallback((w: number, h: number) => {
    const boardPadding = w * 0.08;
    const boardWidth = w - boardPadding * 2;
    const boardTop = h * 0.12;
    const boardBottom = h * 0.78;
    const boardHeight = boardBottom - boardTop;

    const pegSpacingX = boardWidth / (PEG_COLS - 1);
    const pegSpacingY = boardHeight / (PEG_ROWS - 1);
    const slotWidth = boardWidth / SLOT_COUNT;
    const slotY = boardBottom + 16;

    geoRef.current = { pegSpacingX, pegSpacingY, boardTop, boardLeft: boardPadding, slotWidth, slotY, w, h };

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

  const assignSlotPrizes = useCallback(() => {
    const assigned: Prize[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      assigned.push(selectRandomPrize(prizes));
    }
    setSlotPrizes(assigned);
    slotPrizesRef.current = assigned;
  }, [prizes]);

  const dropBall = useCallback(
    (tapX: number) => {
      if (!canDrop || phaseRef.current !== 'playing') return;
      setCanDrop(false);

      const g = geoRef.current;
      const minX = g.boardLeft + BALL_RADIUS;
      const maxX = g.w - g.boardLeft - BALL_RADIUS;
      const startX = Math.max(minX, Math.min(maxX, tapX));

      ballRef.current = {
        x: startX,
        y: 24,
        vx: (Math.random() - 0.5) * 0.5,
        vy: 0,
        trail: [],
      };
    },
    [canDrop],
  );

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

      // ── Background: deep tobacco gradient
      const bgGrad = ctx.createRadialGradient(w / 2, h * 0.3, 0, w / 2, h * 0.3, h);
      bgGrad.addColorStop(0, BG_LIGHT);
      bgGrad.addColorStop(0.5, BG_MID);
      bgGrad.addColorStop(1, BG_DARK);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // ── Subtle leather texture lines
      ctx.globalAlpha = 0.015;
      for (let i = 0; i < h; i += 3) {
        ctx.strokeStyle = CREAM;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, i + Math.sin(i * 0.1) * 0.5);
        ctx.lineTo(w, i + Math.sin(i * 0.1 + 2) * 0.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // ── Board frame with gold border
      const fx = g.boardLeft - 8;
      const fy = g.boardTop - 12;
      const fw = w - g.boardLeft * 2 + 16;
      const fh = g.slotY + 50 - g.boardTop + 12;
      ctx.strokeStyle = GOLD + '25';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(fx, fy, fw, fh, 16);
      ctx.stroke();
      ctx.fillStyle = `rgba(${goldRgb},0.02)`;
      ctx.fill();

      // ── Gold corner accents
      const cornerLen = 20;
      const corners = [
        [fx, fy], [fx + fw, fy], [fx, fy + fh], [fx + fw, fy + fh],
      ];
      ctx.strokeStyle = GOLD + '40';
      ctx.lineWidth = 2;
      for (const [cx, cy] of corners) {
        const dx = cx === fx ? 1 : -1;
        const dy = cy === fy ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(cx + dx * cornerLen, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy * cornerLen);
        ctx.stroke();
      }

      // ── Pegs (gold studs)
      for (const peg of pegsRef.current) {
        if (peg.hitAge >= 0) peg.hitAge++;
        const glowAlpha = peg.hitAge >= 0 ? Math.max(0, 1 - peg.hitAge / 18) : 0;

        // Hit glow
        if (glowAlpha > 0) {
          const glow = ctx.createRadialGradient(peg.x, peg.y, 0, peg.x, peg.y, PEG_RADIUS * 4);
          glow.addColorStop(0, `rgba(${goldRgb},${glowAlpha * 0.4})`);
          glow.addColorStop(1, 'transparent');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(peg.x, peg.y, PEG_RADIUS * 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // Peg body — gold metallic stud
        const pegGrad = ctx.createRadialGradient(
          peg.x - 1, peg.y - 1, 0,
          peg.x, peg.y, PEG_RADIUS,
        );
        if (glowAlpha > 0) {
          pegGrad.addColorStop(0, GOLD_BRIGHT);
          pegGrad.addColorStop(0.5, GOLD);
          pegGrad.addColorStop(1, AMBER);
        } else {
          pegGrad.addColorStop(0, `rgba(${goldRgb},0.7)`);
          pegGrad.addColorStop(0.5, `rgba(${amberRgb},0.5)`);
          pegGrad.addColorStop(1, `rgba(${siennaRgb},0.3)`);
        }
        ctx.beginPath();
        ctx.arc(peg.x, peg.y, PEG_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = pegGrad;
        ctx.fill();

        // Highlight dot
        ctx.beginPath();
        ctx.arc(peg.x - 1, peg.y - 1, PEG_RADIUS * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${creamRgb},${glowAlpha > 0 ? 0.8 : 0.3})`;
        ctx.fill();
      }

      // ── Prize slots at bottom
      const slotW = (w - g.boardLeft * 2) / SLOT_COUNT;
      const sp = slotPrizesRef.current;
      for (let s = 0; s < SLOT_COUNT; s++) {
        const sx = g.boardLeft + s * slotW;
        const prize = sp[s];

        // Slot background
        const slotGrad = ctx.createLinearGradient(sx, g.slotY, sx, g.slotY + 44);
        slotGrad.addColorStop(0, `rgba(${goldRgb},0.06)`);
        slotGrad.addColorStop(1, `rgba(${mahoganyRgb},0.4)`);
        ctx.fillStyle = slotGrad;
        ctx.beginPath();
        ctx.roundRect(sx + 2, g.slotY, slotW - 4, 44, 8);
        ctx.fill();
        ctx.strokeStyle = `rgba(${goldRgb},0.15)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Prize emoji
        if (prize) {
          ctx.font = `${Math.min(18, slotW * 0.45)}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(prize.emoji, sx + slotW / 2, g.slotY + 16);

          // Prize name (truncated)
          ctx.fillStyle = CREAM + '60';
          ctx.font = `bold ${Math.min(7, slotW * 0.18)}px system-ui`;
          const name = prize.name.length > 8 ? prize.name.substring(0, 7) + '…' : prize.name;
          ctx.fillText(name, sx + slotW / 2, g.slotY + 34);
        }
      }

      // ── Ball physics & render (NO rigging)
      const ball = ballRef.current;
      if (ball) {
        ball.vy += GRAVITY;
        ball.vx *= HORIZONTAL_DAMPING;
        ball.x += ball.vx;
        ball.y += ball.vy;

        // Peg collision — pure physics, no bias
        for (const peg of pegsRef.current) {
          const dx = ball.x - peg.x;
          const dy = ball.y - peg.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = PEG_RADIUS + BALL_RADIUS;

          if (dist < minDist && dist > 0) {
            const nx = dx / dist;
            const ny = dy / dist;
            const relVel = ball.vx * nx + ball.vy * ny;

            if (relVel < 0) {
              ball.vx -= 2 * relVel * nx * BOUNCE_DAMPING;
              ball.vy -= 2 * relVel * ny * BOUNCE_DAMPING;

              // Small random nudge for natural feel
              ball.vx += (Math.random() - 0.5) * 0.3;

              const overlap = minDist - dist;
              ball.x += nx * overlap;
              ball.y += ny * overlap;

              peg.hitAge = 0;

              try {
                getSoundEngine().peg(0.8 + Math.random() * 0.4);
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
        if (ball.trail.length > 20) ball.trail.shift();
        for (const t of ball.trail) t.age++;

        // Draw trail (gold particles)
        for (const t of ball.trail) {
          const alpha = Math.max(0, 1 - t.age / 20) * 0.35;
          const r = BALL_RADIUS * (1 - t.age / 20) * 0.5;
          ctx.beginPath();
          ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${goldRgb},${alpha})`;
          ctx.fill();
        }

        // Ball glow
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, BALL_RADIUS * 2.5, 0, Math.PI * 2);
        const ballGlow = ctx.createRadialGradient(ball.x, ball.y, BALL_RADIUS * 0.5, ball.x, ball.y, BALL_RADIUS * 2.5);
        ballGlow.addColorStop(0, `rgba(${goldRgb},0.12)`);
        ballGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = ballGlow;
        ctx.fill();

        // Ball body — gold metallic sphere
        const ballGrad = ctx.createRadialGradient(
          ball.x - 3, ball.y - 3, 0,
          ball.x, ball.y, BALL_RADIUS,
        );
        ballGrad.addColorStop(0, CREAM);
        ballGrad.addColorStop(0.3, GOLD_BRIGHT);
        ballGrad.addColorStop(0.6, GOLD);
        ballGrad.addColorStop(1, SIENNA);
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = ballGrad;
        ctx.fill();

        // Ball highlight
        ctx.beginPath();
        ctx.arc(ball.x - 2.5, ball.y - 2.5, BALL_RADIUS * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${creamRgb},0.7)`;
        ctx.fill();

        // Shadow
        ctx.beginPath();
        ctx.arc(ball.x + 1, ball.y + 1, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fill();

        // Check if ball reached slot zone
        if (ball.y > g.slotY + 8) {
          const relX = ball.x - g.boardLeft;
          const slotBoardW = w - g.boardLeft * 2;
          let slotIndex = Math.floor((relX / slotBoardW) * SLOT_COUNT);
          slotIndex = Math.max(0, Math.min(SLOT_COUNT - 1, slotIndex));

          const prize = slotPrizesRef.current[slotIndex];
          if (prize) {
            setWonPrize(prize);
          }

          getSoundEngine().swish();
          ballRef.current = null;

          setTimeout(() => {
            setPhase('victory');
          }, 600);
        }
      }

      // ── Drop zone indicator
      if (canDrop && phaseRef.current === 'playing') {
        ctx.fillStyle = `rgba(${goldRgb},0.04)`;
        ctx.fillRect(g.boardLeft, 0, w - g.boardLeft * 2, 46);
        ctx.strokeStyle = `rgba(${goldRgb},0.12)`;
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.boardLeft, 46);
        ctx.lineTo(w - g.boardLeft, 46);
        ctx.stroke();
        ctx.setLineDash([]);

        // Animated arrow
        const time = Date.now() * 0.003;
        const bob = Math.sin(time * 2) * 3;
        ctx.fillStyle = CREAM + '30';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('APPUYEZ POUR LÂCHER', w / 2, 28 + bob);

        // Small ball preview
        ctx.beginPath();
        ctx.arc(w / 2, 10 + bob, 4, 0, Math.PI * 2);
        ctx.fillStyle = GOLD + '50';
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [phase, canDrop, resize]);

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
    assignSlotPrizes();
    setPhase('playing');
  };

  return (
    <div
      className="game-container noise-overlay flex flex-col items-center justify-center"
      style={{ background: BG_DARK }}
    >
      {phase === 'playing' && (
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
          {/* Decorative gold dots */}
          <div className="relative w-[140px] h-[150px] mb-2">
            {[...Array(6)].map((_, row) =>
              [...Array(row % 2 === 0 ? 5 : 4)].map((__, col) => (
                <div
                  key={`${row}-${col}`}
                  className="absolute w-2 h-2 rounded-full"
                  style={{
                    background: `radial-gradient(circle, ${GOLD}80, ${AMBER}40)`,
                    left: `${(row % 2 === 0 ? col * 28 + 10 : col * 28 + 24)}px`,
                    top: `${row * 24 + 8}px`,
                    animation: `fadeIn 0.4s ease-out ${(row * 5 + col) * 0.03}s both`,
                  }}
                />
              )),
            )}
            {/* Ball preview */}
            <div
              className="absolute w-5 h-5 rounded-full"
              style={{
                background: `radial-gradient(circle at 35% 35%, ${CREAM}, ${GOLD})`,
                boxShadow: `0 0 20px ${GOLD}60`,
                left: '58px',
                top: '0px',
                animation: 'victoryFloat 2s ease-in-out infinite',
              }}
            />
          </div>

          <h1
            className="text-[32px] font-extrabold tracking-tight text-center leading-tight"
            style={{
              background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              animation: 'fadeInUp 0.6s ease-out 0.2s both',
            }}
          >
            Plinko
          </h1>
          <p
            className="text-[14px] text-center max-w-[260px] leading-relaxed"
            style={{ color: CREAM + '60', animation: 'fadeInUp 0.6s ease-out 0.3s both' }}
          >
            Lâchez la bille et regardez-la rebondir
            <br />jusqu&apos;à votre cadeau !
          </p>
          <button
            onClick={start}
            className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-lg tracking-wide transition-all duration-200 active:scale-[0.96]"
            style={{
              background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`,
              boxShadow: `0 12px 40px -10px ${GOLD}80`,
              animation: 'fadeInUp 0.6s ease-out 0.4s both',
            }}
          >
            Lâcher la bille
          </button>
        </div>
      )}

      {phase === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: BG_DARK }}>
          <div
            className="w-8 h-8 border-2 rounded-full"
            style={{ borderColor: `${GOLD}30`, borderTopColor: GOLD, animation: 'spin 0.8s linear infinite' }}
          />
        </div>
      )}

      {phase === 'victory' && wonPrize && (
        <VictoryScreen
          prize={wonPrize}
          onClose={() => setPhase('ready')}
          accentFrom={GOLD}
          accentTo={AMBER}
        />
      )}
    </div>
  );
}
