'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectPremiumPrize, getConsolationPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════
   ANGRY BALL — Themeable
   Horizontal slingshot game with cups.
   Proper physics, dynamic layout, visible walls.
   No rigging at all.
   ═══════════════════════════════════════════ */

// Physics constants — tuned for natural feel
const GRAVITY = 0.35;
const BALL_RADIUS = 13;
const BOUNCE = 0.45;
const GROUND_FRICTION = 0.88;
const MAX_PULL = 120;
const LAUNCH_MULTIPLIER = 0.18;
const GAME_ASPECT = 1.9;
const MAX_ATTEMPTS = 3;
const RESTITUTION = 0.35;

const SLING_ANCHOR = { x: 0.10, y: 0.58 };

interface Cup {
  x: number; y: number;
  w: number; h: number;
  color: string;
  prize: Prize | null;
}

interface Obstacle {
  x: number; y: number;
  w: number; h: number;
}

interface PlatformDef {
  x: number; y: number;
  w: number;
}

interface BallState {
  x: number; y: number;
  vx: number; vy: number;
  launched: boolean;
  landed: boolean;
  rotation: number;
  trail: { x: number; y: number; alpha: number }[];
  stillFrames: number;
}

/* ── Dense grid layout generation ── */
function generateLayout(allPrizes: Prize[], cupColors: string[]): {
  cups: Cup[];
  obstacles: Obstacle[];
  platforms: PlatformDef[];
} {
  const cups: Cup[] = [];
  const platforms: PlatformDef[] = [];
  const obstacles: Obstacle[] = [];

  // Dense grid layout — adapt to number of available prizes
  const available = allPrizes.filter(p => p.quantity > 0);
  const total = Math.max(1, available.length);
  const cols = Math.min(total, Math.max(2, Math.ceil(Math.sqrt(total))));
  const rows = Math.ceil(total / cols);
  const cupW = Math.min(0.085, 0.7 / cols);
  const cupH = Math.min(0.095, 0.4 / rows);
  const startX = 0.35;
  const endX = 0.88;
  const startY = total <= 3 ? 0.45 : 0.30;
  const endY = total <= 3 ? 0.45 : 0.70;
  const spacingX = cols > 1 ? (endX - startX) / (cols - 1) : 0;
  const spacingY = rows > 1 ? (endY - startY) / (rows - 1) : 0;

  // Assign each available prize to a cup
  const usedPrizes: Prize[] = [];
  for (let i = 0; i < total; i++) {
    usedPrizes.push(available[i % available.length]);
  }

  let idx = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (idx >= total) break;
      // Slight random offset for organic feel
      const jitterX = (Math.random() - 0.5) * 0.025;
      const jitterY = (Math.random() - 0.5) * 0.02;
      const x = startX + col * spacingX + jitterX;
      const y = startY + row * spacingY + jitterY;

      cups.push({
        x, y,
        w: cupW + (Math.random() - 0.5) * 0.008,
        h: cupH + (Math.random() - 0.5) * 0.008,
        color: cupColors[idx % cupColors.length],
        prize: usedPrizes[idx],
      });

      platforms.push({
        x,
        y: y + cupH + 0.008,
        w: cupW + 0.04,
      });
      idx++;
    }
  }

  // Light obstacles for a fair challenge
  const numObs = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < numObs; i++) {
    const isVertical = Math.random() > 0.5;
    let ox: number, oy: number;
    let tries = 0;

    do {
      ox = 0.20 + Math.random() * 0.65; // obstacles spread across the play field
      oy = 0.15 + Math.random() * 0.65;
      tries++;
    } while (
      tries < 40 &&
      cups.some(c => Math.abs(c.x - ox) < 0.10 && Math.abs(c.y - oy) < 0.12)
    );

    obstacles.push({
      x: ox,
      y: oy,
      w: isVertical ? 0.025 + Math.random() * 0.010 : 0.070 + Math.random() * 0.035,
      h: isVertical ? 0.14 + Math.random() * 0.08 : 0.022 + Math.random() * 0.010,
    });
  }

  return { cups, obstacles, platforms };
}

export default function AngryBall({ theme }: { theme?: GameTheme }) {
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT } = { ...DEFAULT_THEME, ...theme };
  const goldRgb = hexToRgb(GOLD);
  const CUP_COLORS = [GOLD, AMBER, SIENNA, GOLD_BRIGHT, '#ef4444'];

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [isPortrait, setIsPortrait] = useState(false);
  const isPortraitRef = useRef(false);
  const [showLanded, setShowLanded] = useState(false);
  const [gameOver, setGameOver] = useState(false);

  const ballRef = useRef<BallState>({
    x: 0, y: 0, vx: 0, vy: 0,
    launched: false, landed: false, rotation: 0, trail: [], stillFrames: 0,
  });
  const cupsRef = useRef<Cup[]>([]);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const platformsRef = useRef<PlatformDef[]>([]);
  const draggingRef = useRef(false);
  const animRef = useRef(0);
  const phaseRef = useRef<GamePhase>('loading');
  const dprRef = useRef(1);
  const gameAreaRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const attemptsRef = useRef(0);
  const lastTimeRef = useRef(0);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { fetchPrizes().then(p => { setPrizes(p); setPhase('ready'); }); }, []);
  useEffect(() => {
    const check = () => {
      const p = window.innerWidth < window.innerHeight;
      setIsPortrait(p);
      isPortraitRef.current = p;
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const setupCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const container = c.parentElement;
    if (!container) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const cw = container.offsetWidth * dpr;
    const ch = container.offsetHeight * dpr;
    c.width = cw; c.height = ch;
    let gw: number, gh: number;
    if (cw / ch > GAME_ASPECT) {
      gh = ch * 0.92;
      gw = gh * GAME_ASPECT;
    } else {
      gw = cw * 0.96;
      gh = gw / GAME_ASPECT;
    }
    const gx = (cw - gw) / 2;
    const gy = (ch - gh) / 2;
    gameAreaRef.current = { x: gx, y: gy, w: gw, h: gh };
  }, []);

  const toGame = useCallback((nx: number, ny: number) => {
    const g = gameAreaRef.current;
    return { x: g.x + nx * g.w, y: g.y + ny * g.h };
  }, []);

  const resetBall = useCallback(() => {
    const anchor = toGame(SLING_ANCHOR.x, SLING_ANCHOR.y);
    ballRef.current = {
      x: anchor.x, y: anchor.y,
      vx: 0, vy: 0,
      launched: false, landed: false,
      rotation: 0, trail: [], stillFrames: 0,
    };
    draggingRef.current = false;
  }, [toGame]);

  /* ── Render loop with proper physics ── */
  const startLoop = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    lastTimeRef.current = performance.now();

    const loop = (now: number) => {
      if (phaseRef.current !== 'playing') return;

      // Delta time for frame-independent physics (capped at ~30fps min)
      const rawDt = (now - lastTimeRef.current) / 1000;
      const dt = Math.min(rawDt, 0.033);
      lastTimeRef.current = now;
      const dtScale = dt * 60; // normalize to 60fps baseline

      const cw = c.width, ch = c.height;
      const dpr = dprRef.current;
      const g = gameAreaRef.current;
      const ball = ballRef.current;
      const br = BALL_RADIUS * dpr;
      const time = now * 0.003;

      ctx.clearRect(0, 0, cw, ch);

      /* ── Background ── */
      const bg = ctx.createLinearGradient(0, 0, cw, 0);
      bg.addColorStop(0, BG_MID);
      bg.addColorStop(0.5, BG_MID);
      bg.addColorStop(1, BG_DARK);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cw, ch);

      /* ── Game area ── */
      ctx.fillStyle = `rgba(${goldRgb},0.015)`;
      ctx.beginPath();
      ctx.roundRect(g.x, g.y, g.w, g.h, 12 * dpr);
      ctx.fill();
      ctx.strokeStyle = GOLD + '12';
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();

      /* ── Ground ── */
      const ground = toGame(0, 0.95);
      ctx.fillStyle = `rgba(${goldRgb},0.04)`;
      ctx.fillRect(g.x, ground.y, g.w, g.y + g.h - ground.y);
      ctx.strokeStyle = GOLD + '25';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(g.x, ground.y); ctx.lineTo(g.x + g.w, ground.y); ctx.stroke();

      /* ── Platforms & Cups ── */
      for (let i = 0; i < cupsRef.current.length; i++) {
        const cup = cupsRef.current[i];
        const plat = platformsRef.current[i];
        if (!plat) continue;
        const pp = toGame(plat.x, plat.y);
        const pw = plat.w * g.w;

        // Platform — bright and visible
        ctx.save();
        ctx.shadowBlur = 6 * dpr;
        ctx.shadowColor = GOLD + '30';
        const platGrad = ctx.createLinearGradient(pp.x - pw / 2, pp.y, pp.x + pw / 2, pp.y + 5 * dpr);
        platGrad.addColorStop(0, GOLD + '30');
        platGrad.addColorStop(1, AMBER + '20');
        ctx.fillStyle = platGrad;
        ctx.fillRect(pp.x - pw / 2, pp.y, pw, 5 * dpr);
        ctx.strokeStyle = GOLD + '50';
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeRect(pp.x - pw / 2, pp.y, pw, 5 * dpr);
        ctx.restore();

        // Support column
        ctx.fillStyle = GOLD + '0a';
        ctx.fillRect(pp.x - 2 * dpr, pp.y + 5 * dpr, 4 * dpr, ground.y - pp.y - 5 * dpr);
        ctx.strokeStyle = GOLD + '12';
        ctx.lineWidth = 1 * dpr;
        ctx.strokeRect(pp.x - 2 * dpr, pp.y + 5 * dpr, 4 * dpr, ground.y - pp.y - 5 * dpr);

        // Cup (U-shape) — bright and visible
        const cp = toGame(cup.x, cup.y);
        const cupW = cup.w * g.w;
        const cupH = cup.h * g.h;

        ctx.save();
        ctx.shadowBlur = 14 * dpr;
        ctx.shadowColor = cup.color + '40';

        // Cup fill
        const cupGrad = ctx.createLinearGradient(cp.x - cupW / 2, cp.y, cp.x + cupW / 2, cp.y + cupH);
        cupGrad.addColorStop(0, cup.color + '25');
        cupGrad.addColorStop(1, cup.color + '10');
        ctx.fillStyle = cupGrad;
        ctx.beginPath();
        ctx.moveTo(cp.x - cupW / 2, cp.y);
        ctx.lineTo(cp.x - cupW / 2, cp.y + cupH);
        ctx.arcTo(cp.x - cupW / 2, cp.y + cupH + 6 * dpr, cp.x, cp.y + cupH + 6 * dpr, 6 * dpr);
        ctx.lineTo(cp.x + cupW / 2 - 6 * dpr, cp.y + cupH + 6 * dpr);
        ctx.arcTo(cp.x + cupW / 2, cp.y + cupH + 6 * dpr, cp.x + cupW / 2, cp.y + cupH, 6 * dpr);
        ctx.lineTo(cp.x + cupW / 2, cp.y);
        ctx.fill();

        // Cup walls — thick and bright
        ctx.strokeStyle = cup.color + '80';
        ctx.lineWidth = 3 * dpr;
        ctx.stroke();
        ctx.restore();

        // Cup opening glow
        const pulse = 0.5 + Math.sin(time + i * 1.2) * 0.3;
        ctx.save();
        ctx.shadowBlur = 12 * dpr * pulse;
        ctx.shadowColor = cup.color;
        ctx.strokeStyle = cup.color + '55';
        ctx.lineWidth = 2.5 * dpr;
        ctx.beginPath(); ctx.moveTo(cp.x - cupW / 2, cp.y); ctx.lineTo(cp.x + cupW / 2, cp.y); ctx.stroke();
        ctx.restore();

        // Side wall indicators — small ticks to emphasize walls
        ctx.strokeStyle = cup.color + '35';
        ctx.lineWidth = 1 * dpr;
        for (let tick = 0; tick < 3; tick++) {
          const ty = cp.y + cupH * (0.2 + tick * 0.3);
          ctx.beginPath();
          ctx.moveTo(cp.x - cupW / 2, ty);
          ctx.lineTo(cp.x - cupW / 2 + 4 * dpr, ty);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cp.x + cupW / 2, ty);
          ctx.lineTo(cp.x + cupW / 2 - 4 * dpr, ty);
          ctx.stroke();
        }

        // Prize emoji
        if (cup.prize) {
          ctx.font = `${Math.min(14, cupW * 0.5) * dpr}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.globalAlpha = 0.7;
          ctx.fillText(cup.prize.emoji, cp.x, cp.y + cupH * 0.45);
          ctx.globalAlpha = 1;
        }
      }

      /* ── Obstacles — BRIGHT and VISIBLE walls ── */
      for (const obs of obstaclesRef.current) {
        const op = toGame(obs.x, obs.y);
        const ow = obs.w * g.w;
        const oh = obs.h * g.h;

        ctx.save();
        // Outer glow
        ctx.shadowBlur = 10 * dpr;
        ctx.shadowColor = GOLD + '35';

        // Fill with gradient
        const obsGrad = ctx.createLinearGradient(op.x - ow / 2, op.y - oh / 2, op.x + ow / 2, op.y + oh / 2);
        obsGrad.addColorStop(0, GOLD + '22');
        obsGrad.addColorStop(0.5, AMBER + '18');
        obsGrad.addColorStop(1, GOLD + '22');
        ctx.fillStyle = obsGrad;
        ctx.beginPath();
        ctx.roundRect(op.x - ow / 2, op.y - oh / 2, ow, oh, 3 * dpr);
        ctx.fill();

        // Bright border
        ctx.strokeStyle = GOLD + '60';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();

        // Inner detail lines (wall texture)
        ctx.strokeStyle = GOLD + '18';
        ctx.lineWidth = 1 * dpr;
        if (ow > oh) {
          // Horizontal wall — vertical dividers
          const segs = Math.max(2, Math.floor(ow / (12 * dpr)));
          for (let s = 1; s < segs; s++) {
            const sx = op.x - ow / 2 + (ow / segs) * s;
            ctx.beginPath();
            ctx.moveTo(sx, op.y - oh / 2 + 2 * dpr);
            ctx.lineTo(sx, op.y + oh / 2 - 2 * dpr);
            ctx.stroke();
          }
        } else {
          // Vertical wall — horizontal dividers
          const segs = Math.max(2, Math.floor(oh / (12 * dpr)));
          for (let s = 1; s < segs; s++) {
            const sy = op.y - oh / 2 + (oh / segs) * s;
            ctx.beginPath();
            ctx.moveTo(op.x - ow / 2 + 2 * dpr, sy);
            ctx.lineTo(op.x + ow / 2 - 2 * dpr, sy);
            ctx.stroke();
          }
        }

        ctx.restore();
      }

      /* ── Slingshot ── */
      const anchor = toGame(SLING_ANCHOR.x, SLING_ANCHOR.y);
      const postW = 5 * dpr;
      const postH = 40 * dpr;
      const postSpread = 18 * dpr;
      const leftPostX = anchor.x - postSpread;
      const rightPostX = anchor.x + postSpread;
      const postTop = anchor.y - postH;

      // Posts
      ctx.fillStyle = SIENNA + '80';
      ctx.fillRect(leftPostX - postW / 2, postTop, postW, postH + 20 * dpr);
      ctx.fillRect(rightPostX - postW / 2, postTop, postW, postH + 20 * dpr);
      ctx.fillStyle = GOLD + '50';
      ctx.beginPath(); ctx.arc(leftPostX, postTop, postW * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(rightPostX, postTop, postW * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = SIENNA + '50';
      ctx.fillRect(leftPostX - 8 * dpr, anchor.y + 20 * dpr - 4 * dpr, postSpread * 2 + 16 * dpr, 8 * dpr);

      // Elastic bands
      if (!ball.launched) {
        const bandColor = draggingRef.current ? '#ef4444' : AMBER;
        ctx.strokeStyle = bandColor;
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath(); ctx.moveTo(leftPostX, postTop + 3 * dpr); ctx.lineTo(ball.x, ball.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rightPostX, postTop + 3 * dpr); ctx.lineTo(ball.x, ball.y); ctx.stroke();

        if (draggingRef.current) {
          ctx.save();
          ctx.shadowBlur = 8 * dpr;
          ctx.shadowColor = '#ef4444';
          ctx.strokeStyle = '#ef444440';
          ctx.lineWidth = 6 * dpr;
          ctx.beginPath(); ctx.moveTo(leftPostX, postTop + 3 * dpr); ctx.lineTo(ball.x, ball.y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(rightPostX, postTop + 3 * dpr); ctx.lineTo(ball.x, ball.y); ctx.stroke();
          ctx.restore();
        }
      }

      /* ══════════════════════════════════════
         PHYSICS — proper collision response
         ══════════════════════════════════════ */
      if (ball.launched && !ball.landed) {
        // Semi-implicit Euler: update velocity, then position
        ball.vy += GRAVITY * dpr * dtScale;
        ball.x += ball.vx * dtScale;
        ball.y += ball.vy * dtScale;
        ball.rotation += ball.vx * 0.012 * dtScale;

        // Trail
        ball.trail.push({ x: ball.x, y: ball.y, alpha: 1 });
        if (ball.trail.length > 16) ball.trail.shift();
        ball.trail.forEach(t => { t.alpha *= 0.88; });

        // Boundary walls
        if (ball.x - br < g.x) { ball.x = g.x + br; ball.vx = Math.abs(ball.vx) * BOUNCE; }
        if (ball.x + br > g.x + g.w) { ball.x = g.x + g.w - br; ball.vx = -Math.abs(ball.vx) * BOUNCE; }
        if (ball.y - br < g.y) { ball.y = g.y + br; ball.vy = Math.abs(ball.vy) * BOUNCE; }

        // Ground collision
        if (ball.y + br > ground.y) {
          ball.y = ground.y - br;
          if (Math.abs(ball.vy) > 1.5 * dpr) getSoundEngine().impact();
          ball.vy = -Math.abs(ball.vy) * BOUNCE;
          ball.vx *= GROUND_FRICTION;
          if (Math.abs(ball.vy) < 1 * dpr) ball.vy = 0;
        }

        // Obstacle collisions — proper restitution
        for (const obs of obstaclesRef.current) {
          const op = toGame(obs.x, obs.y);
          const ow = obs.w * g.w;
          const oh = obs.h * g.h;
          const left = op.x - ow / 2, right = op.x + ow / 2;
          const top = op.y - oh / 2, bottom = op.y + oh / 2;

          // Find closest point on AABB to ball center
          const nearX = Math.max(left, Math.min(right, ball.x));
          const nearY = Math.max(top, Math.min(bottom, ball.y));
          const dx = ball.x - nearX, dy = ball.y - nearY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < br && dist > 0) {
            const pen = br - dist;
            const nx = dx / dist;
            const ny = dy / dist;
            // Push out
            ball.x += nx * pen;
            ball.y += ny * pen;
            // Proper reflection with restitution
            const dot = ball.vx * nx + ball.vy * ny;
            if (dot < 0) {
              ball.vx -= (1 + RESTITUTION) * dot * nx;
              ball.vy -= (1 + RESTITUTION) * dot * ny;
            }
            getSoundEngine().peg(Math.floor(Math.random() * 3));
          } else if (dist === 0) {
            // Ball center is inside obstacle — push out along shortest axis
            const dxL = ball.x - left, dxR = right - ball.x;
            const dyT = ball.y - top, dyB = bottom - ball.y;
            const minD = Math.min(dxL, dxR, dyT, dyB);
            if (minD === dxL) { ball.x = left - br; ball.vx = -Math.abs(ball.vx) * BOUNCE; }
            else if (minD === dxR) { ball.x = right + br; ball.vx = Math.abs(ball.vx) * BOUNCE; }
            else if (minD === dyT) { ball.y = top - br; ball.vy = -Math.abs(ball.vy) * BOUNCE; }
            else { ball.y = bottom + br; ball.vy = Math.abs(ball.vy) * BOUNCE; }
            getSoundEngine().peg(Math.floor(Math.random() * 3));
          }
        }

        // Platform collisions — proper direction-aware
        for (const plat of platformsRef.current) {
          const pp = toGame(plat.x, plat.y);
          const pw = plat.w * g.w;
          const platLeft = pp.x - pw / 2;
          const platRight = pp.x + pw / 2;
          const platTop = pp.y;
          const platH = 5 * dpr;
          const platBottom = platTop + platH;

          // Check overlap
          if (ball.x + br > platLeft && ball.x - br < platRight &&
              ball.y + br > platTop && ball.y - br < platBottom) {
            // Determine from which side the ball is colliding
            const overlapTop = (ball.y + br) - platTop;
            const overlapBottom = platBottom - (ball.y - br);
            const overlapLeft = (ball.x + br) - platLeft;
            const overlapRight = platRight - (ball.x - br);
            const minOverlap = Math.min(overlapTop, overlapBottom, overlapLeft, overlapRight);

            if (minOverlap === overlapTop && ball.vy > 0) {
              ball.y = platTop - br;
              ball.vy = -Math.abs(ball.vy) * BOUNCE;
              ball.vx *= GROUND_FRICTION;
              if (Math.abs(ball.vy) > 1 * dpr) getSoundEngine().impact();
            } else if (minOverlap === overlapBottom && ball.vy < 0) {
              ball.y = platBottom + br;
              ball.vy = Math.abs(ball.vy) * BOUNCE;
            } else if (minOverlap === overlapLeft && ball.vx > 0) {
              ball.x = platLeft - br;
              ball.vx = -Math.abs(ball.vx) * BOUNCE;
            } else if (minOverlap === overlapRight && ball.vx < 0) {
              ball.x = platRight + br;
              ball.vx = Math.abs(ball.vx) * BOUNCE;
            }
          }
        }

        // Cup detection — proper collision
        for (const cup of cupsRef.current) {
          const cp = toGame(cup.x, cup.y);
          const cupW = cup.w * g.w;
          const cupH = cup.h * g.h;
          const cupLeft = cp.x - cupW / 2;
          const cupRight = cp.x + cupW / 2;
          const cupTop = cp.y;
          const cupBottom = cp.y + cupH;
          const wallThick = 5 * dpr;

          // Enter cup from the top — must be falling and within the opening
          if (ball.x > cupLeft + br * 0.15 && ball.x < cupRight - br * 0.15 &&
              ball.y + br > cupTop && ball.y < cupBottom && ball.vy > 0) {
            // Slow the ball inside the cup
            ball.vx *= 0.85;
            ball.vy *= 0.85;
            if (Math.abs(ball.vy) < 2 * dpr && Math.abs(ball.vx) < 2 * dpr) {
              ball.landed = true;
              ball.x = cp.x;
              ball.y = cupTop + cupH * 0.45;
              ball.vx = 0; ball.vy = 0;
              getSoundEngine().swish();

              // Any cup = WIN that cup's prize
              setShowLanded(true);
              setTimeout(() => setShowLanded(false), 1000);
              if (cup.prize) {
                setWonPrize(cup.prize);
                setTimeout(() => { if (phaseRef.current === 'playing') setPhase('victory'); }, 1200);
              }
            }
          }

          // Left wall collision
          if (ball.y > cupTop + br * 0.5 && ball.y < cupBottom) {
            if (ball.x + br > cupLeft && ball.x + br < cupLeft + wallThick + br && ball.vx > 0) {
              ball.x = cupLeft - br;
              const dot = ball.vx;
              ball.vx = -Math.abs(dot) * BOUNCE;
              getSoundEngine().peg(0);
            }
            // Right wall collision
            if (ball.x - br < cupRight && ball.x - br > cupRight - wallThick - br && ball.vx < 0) {
              ball.x = cupRight + br;
              const dot = ball.vx;
              ball.vx = Math.abs(dot) * BOUNCE;
              getSoundEngine().peg(0);
            }
          }

          // Bottom wall collision (inside cup)
          if (ball.x > cupLeft && ball.x < cupRight &&
              ball.y + br > cupBottom && ball.y - br < cupBottom + wallThick && ball.vy > 0) {
            ball.y = cupBottom - br;
            ball.vy = -Math.abs(ball.vy) * BOUNCE * 0.5;
          }
        }

        // Stillness detection — ball stopped = missed shot
        if (Math.abs(ball.vx) < 0.25 * dpr && Math.abs(ball.vy) < 0.25 * dpr) {
          ball.stillFrames++;
        } else {
          ball.stillFrames = 0;
        }

        if (ball.stillFrames > 90 && !ball.landed) {
          attemptsRef.current++;
          setAttempts(attemptsRef.current);
          if (attemptsRef.current >= MAX_ATTEMPTS) {
            setGameOver(true);
            const consolation = getConsolationPrize(prizes);
            setWonPrize(consolation);
            setTimeout(() => setPhase('victory'), 800);
            return;
          }
          resetBall();
        }

        // Off screen
        if (ball.y > g.y + g.h + 50 * dpr || ball.x > g.x + g.w + 100 * dpr) {
          attemptsRef.current++;
          setAttempts(attemptsRef.current);
          if (attemptsRef.current >= MAX_ATTEMPTS) {
            setGameOver(true);
            const consolation = getConsolationPrize(prizes);
            setWonPrize(consolation);
            setTimeout(() => setPhase('victory'), 800);
            return;
          }
          resetBall();
        }
      }

      /* ── Draw trail ── */
      for (const t of ball.trail) {
        if (t.alpha < 0.05) continue;
        ctx.beginPath();
        ctx.arc(t.x, t.y, Math.max(2, br * t.alpha * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${goldRgb},${t.alpha * 0.2})`;
        ctx.fill();
      }

      /* ── Draw ball ── */
      ctx.save();
      ctx.translate(ball.x, ball.y);
      ctx.rotate(ball.rotation);

      // Shadow
      ctx.save();
      ctx.translate(2 * dpr, 3 * dpr);
      ctx.beginPath(); ctx.arc(0, 0, br, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill();
      ctx.restore();

      // Body — angry red ball
      const ballGrad = ctx.createRadialGradient(-br * 0.3, -br * 0.3, br * 0.1, 0, 0, br);
      ballGrad.addColorStop(0, '#fee2e2');
      ballGrad.addColorStop(0.3, '#ef4444');
      ballGrad.addColorStop(0.7, '#dc2626');
      ballGrad.addColorStop(1, '#991b1b');
      ctx.beginPath(); ctx.arc(0, 0, br, 0, Math.PI * 2);
      ctx.fillStyle = ballGrad; ctx.fill();
      ctx.strokeStyle = 'rgba(153,27,27,0.4)';
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();

      // Eyes
      ctx.fillStyle = 'white';
      ctx.beginPath(); ctx.arc(-br * 0.25, -br * 0.15, br * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(br * 0.25, -br * 0.15, br * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath(); ctx.arc(-br * 0.22, -br * 0.12, br * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(br * 0.28, -br * 0.12, br * 0.07, 0, Math.PI * 2); ctx.fill();

      // Eyebrows
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(-br * 0.4, -br * 0.35); ctx.lineTo(-br * 0.1, -br * 0.25); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(br * 0.4, -br * 0.35); ctx.lineTo(br * 0.1, -br * 0.25); ctx.stroke();

      // Mouth
      ctx.beginPath();
      ctx.arc(0, br * 0.2, br * 0.2, 0.2, Math.PI - 0.2);
      ctx.stroke();

      // Highlight
      ctx.beginPath(); ctx.arc(-br * 0.3, -br * 0.3, br * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fill();

      ctx.restore();

      /* ── Pull indicator ── */
      if (draggingRef.current && !ball.launched) {
        const pdx = anchor.x - ball.x;
        const pdy = anchor.y - ball.y;
        const pullDist = Math.sqrt(pdx * pdx + pdy * pdy);
        const maxPull = MAX_PULL * dpr;
        const strength = Math.min(pullDist / maxPull, 1);

        // Trajectory preview
        const launchVx = pdx * LAUNCH_MULTIPLIER;
        const launchVy = pdy * LAUNCH_MULTIPLIER;
        ctx.save();
        ctx.globalAlpha = 0.15;
        let px = anchor.x, py = anchor.y;
        let pvx = launchVx, pvy = launchVy;
        for (let i = 0; i < 15; i++) {
          pvy += GRAVITY * dpr;
          px += pvx;
          py += pvy;
          const dotAlpha = 1 - i / 15;
          ctx.beginPath();
          ctx.arc(px, py, (3 - i * 0.15) * dpr, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${goldRgb},${dotAlpha})`;
          ctx.fill();
        }
        ctx.restore();

        // Power bar
        const barX = g.x + 12 * dpr;
        const barY = g.y + g.h * 0.2;
        const barH = g.h * 0.5;
        const barW = 6 * dpr;
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(barX, barY, barW, barH);
        const fillH = barH * strength;
        const barGrad = ctx.createLinearGradient(0, barY + barH, 0, barY + barH - fillH);
        barGrad.addColorStop(0, GOLD);
        barGrad.addColorStop(0.5, AMBER);
        barGrad.addColorStop(1, '#ef4444');
        ctx.fillStyle = barGrad;
        ctx.fillRect(barX, barY + barH - fillH, barW, fillH);
        ctx.strokeStyle = GOLD + '15';
        ctx.lineWidth = 1 * dpr;
        ctx.strokeRect(barX, barY, barW, barH);
      }

      /* ── Launch instruction ── */
      if (!ball.launched && !draggingRef.current && phaseRef.current === 'playing') {
        const bob = Math.sin(time) * 3 * dpr;
        ctx.save();
        ctx.globalAlpha = 0.3 + Math.sin(time * 2) * 0.1;
        ctx.font = `600 ${11 * dpr}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillStyle = CREAM + '80';
        ctx.fillText('← Tirez la boule en arrière', anchor.x + 80 * dpr, anchor.y + 40 * dpr + bob);
        ctx.restore();
      }

      /* ── Attempt counter ── */
      ctx.fillStyle = CREAM + '40';
      ctx.font = `bold ${10 * dpr}px system-ui`;
      ctx.textAlign = 'right';
      ctx.fillText(
        `${MAX_ATTEMPTS - attemptsRef.current} tir${MAX_ATTEMPTS - attemptsRef.current > 1 ? 's' : ''} restant${MAX_ATTEMPTS - attemptsRef.current > 1 ? 's' : ''}`,
        g.x + g.w - 10 * dpr, g.y + 16 * dpr
      );

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [toGame, resetBall]);

  const start = useCallback(() => {
    setupCanvas();
    // Generate a fresh random layout for each game
    const layout = generateLayout(prizes, CUP_COLORS);
    cupsRef.current = layout.cups;
    obstaclesRef.current = layout.obstacles;
    platformsRef.current = layout.platforms;
    resetBall();
    setWonPrize(null);
    setAttempts(0);
    attemptsRef.current = 0;
    setShowLanded(false);
    setGameOver(false);
    setPhase('playing');
    setTimeout(() => startLoop(), 50);
    return () => cancelAnimationFrame(animRef.current);
  }, [prizes, setupCanvas, resetBall, startLoop]);

  // Input handling
  const getCanvasPos = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const dpr = dprRef.current;
    const cx = 'touches' in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const cy = 'touches' in e ? e.touches[0]?.clientY ?? 0 : e.clientY;

    // When in portrait mode, the wrapper is CSS-rotated 90deg.
    // The bounding rect reflects the rotated (visual) position,
    // but the canvas internal coords are in the pre-rotation space.
    // We need to map screen touch → rotated container → canvas coords.
    if (isPortraitRef.current) {
      // rect center in screen space
      const rcx = rect.left + rect.width / 2;
      const rcy = rect.top + rect.height / 2;
      // offset from center in screen space
      const dx = cx - rcx;
      const dy = cy - rcy;
      // un-rotate by -90deg (the CSS does +90deg: rotate(90deg))
      // rotate(-90): x' = dy, y' = -dx
      const ux = dy;
      const uy = -dx;
      // The actual canvas element size (pre-rotation) is height x width of the visual rect
      const canvasW = rect.height; // visual width becomes canvas height after rotation
      const canvasH = rect.width;  // visual height becomes canvas width after rotation
      return {
        x: (ux + canvasW / 2) * dpr,
        y: (uy + canvasH / 2) * dpr,
      };
    }

    return { x: (cx - rect.left) * dpr, y: (cy - rect.top) * dpr };
  }, []);

  const onPointerDown = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (phase !== 'playing') return;
    const ball = ballRef.current;
    if (ball.launched || ball.landed) return;
    const pos = getCanvasPos(e);
    const dx = pos.x - ball.x, dy = pos.y - ball.y;
    if (Math.sqrt(dx * dx + dy * dy) < 80 * dprRef.current) {
      draggingRef.current = true;
    }
  }, [phase, getCanvasPos]);

  const onPointerMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!draggingRef.current || phase !== 'playing') return;
    const pos = getCanvasPos(e);
    const anchor = toGame(SLING_ANCHOR.x, SLING_ANCHOR.y);
    const dx = pos.x - anchor.x, dy = pos.y - anchor.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxPull = MAX_PULL * dprRef.current;
    if (dist > maxPull) {
      ballRef.current.x = anchor.x + (dx / dist) * maxPull;
      ballRef.current.y = anchor.y + (dy / dist) * maxPull;
    } else {
      ballRef.current.x = pos.x;
      ballRef.current.y = pos.y;
    }
  }, [phase, toGame, getCanvasPos]);

  const onPointerUp = useCallback(() => {
    if (!draggingRef.current || phase !== 'playing') return;
    draggingRef.current = false;
    const ball = ballRef.current;
    const anchor = toGame(SLING_ANCHOR.x, SLING_ANCHOR.y);
    const dx = anchor.x - ball.x, dy = anchor.y - ball.y;
    const pullDist = Math.sqrt(dx * dx + dy * dy);
    if (pullDist > 15 * dprRef.current) {
      ball.vx = dx * LAUNCH_MULTIPLIER;
      ball.vy = dy * LAUNCH_MULTIPLIER;
      ball.launched = true;
      ball.trail = [];
      ball.rotation = 0;
      ball.stillFrames = 0;
      getSoundEngine().swoosh();
    } else {
      ball.x = anchor.x; ball.y = anchor.y;
    }
  }, [phase, toGame]);

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  const wrapperStyle: React.CSSProperties = isPortrait ? {
    position: 'fixed',
    width: '100vh',
    height: '100vw',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%) rotate(90deg)',
    overflow: 'hidden',
  } : {
    width: '100%',
    height: '100dvh',
    position: 'relative' as const,
    overflow: 'hidden',
  };

  return (
    <div style={wrapperStyle}>
        <div className="relative w-full h-full" style={{ background: BG_DARK }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          onTouchStart={onPointerDown}
          onTouchMove={onPointerMove}
          onTouchEnd={onPointerUp}
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onMouseLeave={onPointerUp}
          style={{ touchAction: 'none' }}
        />

        {showLanded && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none" style={{ animation: 'fadeInUp 0.3s ease-out both' }}>
            <span className="text-3xl font-black tracking-tight" style={{ background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              DANS LE TROU! 🎯
            </span>
          </div>
        )}

        {/* Ready screen */}
        {phase === 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
            <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 30% 50%, ${BG_LIGHT} 0%, ${BG_MID} 50%, ${BG_DARK} 100%)` }} />
            <div className="relative z-10 flex flex-col items-center gap-4 px-8">
              <div className="text-6xl" style={{ animation: 'victoryFloat 3s ease-in-out infinite' }}>😡</div>
              <h1 className="text-[28px] font-extrabold tracking-tight text-center"
                style={{ background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${AMBER})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'fadeInUp 0.6s ease-out both' }}>
                Angry Ball
              </h1>
              <p style={{ color: CREAM + '60' }} className="text-[13px] leading-relaxed text-center max-w-[260px]">
                Tirez la boule et visez le cadeau
                <br />que vous voulez gagner !
                <br /><span style={{ color: CREAM + '35' }} className="text-[11px]">Chaque trou = un cadeau différent • {MAX_ATTEMPTS} tirs</span>
              </p>
              {gameOver && (
                <p className="text-sm font-bold" style={{ color: '#ef4444', animation: 'fadeIn 0.3s ease-out both' }}>
                  Perdu ! Réessayez 💪
                </p>
              )}
              <button
                onClick={start}
                className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-[15px] tracking-wide transition-all duration-200 active:scale-[0.96]"
                style={{ background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`, boxShadow: `0 12px 40px -10px ${GOLD}80`, animation: 'fadeInUp 0.6s ease-out 0.2s both' }}
              >
                {gameOver ? 'Réessayer 😡' : 'Lancer 😡'}
              </button>
            </div>
          </div>
        )}

        {phase === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: BG_DARK }}>
            <div className="w-8 h-8 border-2 rounded-full" style={{ borderColor: `${GOLD}30`, borderTopColor: GOLD, animation: 'spin 0.8s linear infinite' }} />
          </div>
        )}

        {phase === 'victory' && wonPrize && (
          <VictoryScreen
            prize={wonPrize}
            onClose={() => { cancelAnimationFrame(animRef.current); setPhase('ready'); }}
            accentFrom={GOLD}
            accentTo={AMBER}
          />
        )}
      </div>
    </div>
  );
}
