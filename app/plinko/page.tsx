'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectPremiumPrize, getConsolationPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   PLINKO — Themeable
   Premium aesthetic, no rigging.
   Adaptive peg density + gyroscope tilt.
   ═══════════════════════════════════════════════ */

// Base peg grid for ~375px width (phone). Scales up for larger screens.
const BASE_PEG_ROWS = 10;
const BASE_PEG_COLS = 9;
const PEG_RADIUS = 4;
const BALL_RADIUS = 9;
const GRAVITY = 0.25;
const BOUNCE_DAMPING = 0.55;
const HORIZONTAL_DAMPING = 0.96;
const GYRO_STRENGTH = 0.08; // how much tilt affects the ball
const MAX_ATTEMPTS = 3;
const MIN_PRIZE_SLOTS = 3; // minimum prize slots regardless of screen size
const PRIZE_SLOT_RATIO = 0.25; // 25% of slots will have prizes

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
  const [slotPrizes, setSlotPrizes] = useState<(Prize | null)[]>([]);
  const attemptsRef = useRef(0);
  const [attempts, setAttempts] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const ballRef = useRef<Ball | null>(null);
  const pegsRef = useRef<Peg[]>([]);
  const slotPrizesRef = useRef<(Prize | null)[]>([]);
  const animRef = useRef<number>(0);
  const dprRef = useRef(1);
  const tiltRef = useRef(0); // -1..1 horizontal tilt
  const calibrationRef = useRef({ gamma: 0, calibrated: false });
  const gridRef = useRef({ pegRows: BASE_PEG_ROWS, pegCols: BASE_PEG_COLS, slotCount: BASE_PEG_COLS + 1 });

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
    // Adapt peg density to screen size:
    // Phone (~375px) = base 9 cols / 10 rows
    // Tablet (~768px) = ~14 cols / 14 rows
    // Desktop (~1200px+) = ~18 cols / 16 rows
    // Target: peg horizontal spacing ~38-42px so ball always bounces
    const TARGET_SPACING = 40;
    const boardPadding = PEG_RADIUS + 4; // minimal edge margin so pegs fill full width
    const boardWidth = w - boardPadding * 2;
    const boardTop = h * 0.12;
    const boardBottom = h * 0.78;
    const boardHeight = boardBottom - boardTop;

    const pegCols = Math.max(BASE_PEG_COLS, Math.round(boardWidth / TARGET_SPACING));
    const pegRows = Math.max(BASE_PEG_ROWS, Math.round(boardHeight / TARGET_SPACING));
    const slotCount = pegCols + 1;
    gridRef.current = { pegRows, pegCols, slotCount };

    const pegSpacingX = boardWidth / (pegCols - 1);
    const pegSpacingY = boardHeight / (pegRows - 1);
    const slotWidth = boardWidth / slotCount;
    const slotY = boardBottom + 16;

    geoRef.current = { pegSpacingX, pegSpacingY, boardTop, boardLeft: boardPadding, slotWidth, slotY, w, h };

    const pegs: Peg[] = [];
    for (let row = 0; row < pegRows; row++) {
      const cols = row % 2 === 0 ? pegCols : pegCols - 1;
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

  // ── Gyroscope tilt (phone only — subtle horizontal nudge)
  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      const gamma = e.gamma ?? 0; // left/right tilt in degrees
      if (!calibrationRef.current.calibrated) {
        calibrationRef.current = { gamma, calibrated: true };
      }
      const adjusted = gamma - calibrationRef.current.gamma;
      // Map ±30° to ±1
      tiltRef.current = Math.max(-1, Math.min(1, adjusted / 30));
    };

    // iOS 13+ requires explicit permission
    const requestAndListen = async () => {
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function'
      ) {
        try {
          const perm = await (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission();
          if (perm !== 'granted') return;
        } catch {
          return;
        }
      }
      window.addEventListener('deviceorientation', handleOrientation);
    };

    requestAndListen();

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, []);

  // Place PRIZE_SLOTS premium prizes in random positions; the rest are null (miss)
  const assignSlotPrizes = useCallback(() => {
    const { slotCount } = gridRef.current;
    const prizeCount = Math.max(MIN_PRIZE_SLOTS, Math.ceil(slotCount * PRIZE_SLOT_RATIO));
    const slots: (Prize | null)[] = new Array(slotCount).fill(null);
    const positions = new Set<number>();
    while (positions.size < Math.min(prizeCount, slotCount)) {
      positions.add(Math.floor(Math.random() * slotCount));
    }
    for (const pos of positions) {
      slots[pos] = selectPremiumPrize(prizes);
    }
    setSlotPrizes(slots);
    slotPrizesRef.current = slots;
  }, [prizes]);

  const dropBall = useCallback(
    (tapX: number) => {
      if (!canDrop || phaseRef.current !== 'playing') return;
      setCanDrop(false);

      const g = geoRef.current;
      const minX = BALL_RADIUS;
      const maxX = g.w - BALL_RADIUS;
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

    // Reassign slot prizes now that geometry is computed (canvas may have different slotCount)
    if (slotPrizesRef.current.length !== gridRef.current.slotCount) {
      assignSlotPrizes();
    }

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
      const fx = 4;
      const fy = g.boardTop - 12;
      const fw = w - 8;
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

      // ── Prize slots at bottom (full width, edge to edge)
      const { slotCount } = gridRef.current;
      const slotW = w / slotCount; // full canvas width, no padding
      const sp = slotPrizesRef.current;
      for (let s = 0; s < slotCount; s++) {
        const sx = s * slotW;
        const prize = sp[s];

        // Slot background — brighter for prize slots
        const slotGrad = ctx.createLinearGradient(sx, g.slotY, sx, g.slotY + 44);
        if (prize) {
          slotGrad.addColorStop(0, `rgba(${goldRgb},0.18)`);
          slotGrad.addColorStop(1, `rgba(${goldRgb},0.08)`);
        } else {
          slotGrad.addColorStop(0, `rgba(${mahoganyRgb},0.15)`);
          slotGrad.addColorStop(1, `rgba(${mahoganyRgb},0.4)`);
        }
        ctx.fillStyle = slotGrad;
        ctx.beginPath();
        ctx.roundRect(sx + 1, g.slotY, slotW - 2, 44, 6);
        ctx.fill();
        ctx.strokeStyle = prize ? `rgba(${goldRgb},0.35)` : `rgba(${goldRgb},0.08)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        if (prize) {
          // Prize emoji (scales with slot width)
          const emojiSize = Math.max(10, Math.min(18, slotW * 0.45));
          ctx.font = `${emojiSize}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(prize.emoji, sx + slotW / 2, g.slotY + 16);

          // Prize name (truncated, only if slot wide enough)
          if (slotW > 28) {
            ctx.fillStyle = CREAM + '60';
            const nameSize = Math.max(5, Math.min(7, slotW * 0.16));
            ctx.font = `bold ${nameSize}px system-ui`;
            const maxChars = Math.max(3, Math.floor(slotW / 6));
            const name = prize.name.length > maxChars ? prize.name.substring(0, maxChars - 1) + '…' : prize.name;
            ctx.fillText(name, sx + slotW / 2, g.slotY + 34);
          }
        } else {
          // Empty slot — subtle X
          ctx.fillStyle = `rgba(${creamRgb},0.12)`;
          const xSize = Math.max(8, Math.min(14, slotW * 0.3));
          ctx.font = `bold ${xSize}px system-ui`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('✕', sx + slotW / 2, g.slotY + 22);
        }
      }

      // ── Ball physics & render (NO rigging)
      const ball = ballRef.current;
      if (ball) {
        // Apply gyroscope tilt as gentle horizontal nudge
        ball.vx += tiltRef.current * GYRO_STRENGTH;
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

        // Wall bounce (edge of canvas)
        if (ball.x < BALL_RADIUS) {
          ball.x = BALL_RADIUS;
          ball.vx = Math.abs(ball.vx) * 0.5;
        }
        if (ball.x > w - BALL_RADIUS) {
          ball.x = w - BALL_RADIUS;
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
          let slotIndex = Math.floor((ball.x / w) * slotCount);
          slotIndex = Math.max(0, Math.min(slotCount - 1, slotIndex));

          const prize = slotPrizesRef.current[slotIndex];
          getSoundEngine().swish();
          ballRef.current = null;

          if (prize) {
            // Landed on a premium prize!
            setWonPrize(prize);
            setTimeout(() => setPhase('victory'), 600);
          } else {
            // Miss — use an attempt
            attemptsRef.current++;
            setAttempts(attemptsRef.current);

            if (attemptsRef.current >= MAX_ATTEMPTS) {
              // All attempts exhausted → consolation prize
              const consolation = getConsolationPrize(prizes);
              setWonPrize(consolation);
              setGameOver(true);
              setTimeout(() => setPhase('victory'), 800);
            } else {
              // Allow another drop after a short delay
              pegsRef.current.forEach((p) => (p.hitAge = -1));
              setTimeout(() => setCanDrop(true), 800);
            }
          }
        }
      }

      // ── Drop zone indicator
      if (canDrop && phaseRef.current === 'playing') {
        ctx.fillStyle = `rgba(${goldRgb},0.04)`;
        ctx.fillRect(0, 0, w, 46);
        ctx.strokeStyle = `rgba(${goldRgb},0.12)`;
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 46);
        ctx.lineTo(w, 46);
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

      // ── Tilt indicator (bottom center, only when ball is active)
      if (ballRef.current && Math.abs(tiltRef.current) > 0.02) {
        const indX = w / 2;
        const indY = h - 18;
        const indR = 16;
        ctx.strokeStyle = `rgba(${goldRgb},0.08)`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(indX, indY, indR, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = GOLD;
        ctx.beginPath();
        ctx.arc(indX + tiltRef.current * indR * 0.8, indY, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [phase, canDrop, resize, assignSlotPrizes]);

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
    tiltRef.current = 0;
    calibrationRef.current = { gamma: 0, calibrated: false };
    pegsRef.current.forEach((p) => (p.hitAge = -1));
    attemptsRef.current = 0;
    setAttempts(0);
    setGameOver(false);
    assignSlotPrizes();
    setPhase('playing');
  };

  return (
    <div
      className="game-container noise-overlay flex flex-col items-center justify-center"
      style={{ background: BG_DARK }}
    >
      {phase === 'playing' && (
        <>
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ touchAction: 'none' }}
            onTouchStart={handleCanvasInteraction}
            onMouseDown={handleCanvasInteraction}
          />
          {/* HUD: remaining attempts */}
          <div className="absolute top-3 right-3 z-30 flex gap-1">
            {Array.from({ length: MAX_ATTEMPTS }).map((_, i) => (
              <span key={i} className="text-lg">
                {i < MAX_ATTEMPTS - attempts ? '🟡' : '✕'}
              </span>
            ))}
          </div>
        </>
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
            {gameOver
              ? 'Pas de chance cette fois…'
              : `Lâchez la bille et visez un cadeau !\n${MAX_ATTEMPTS} tentative${MAX_ATTEMPTS > 1 ? 's' : ''}`}
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
