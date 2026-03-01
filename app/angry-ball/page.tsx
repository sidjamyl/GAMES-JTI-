'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectPremiumPrize, getConsolationPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import PrizeLegend from '../components/PrizeLegend';
import Link from 'next/link';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';
import { getDisplaySlots, distributeProportionally, shuffle } from '../lib/gameConfig';

/* ═══════════════════════════════════════════
   ANGRY BALL — Themeable
   Horizontal slingshot game with cups.
   Proper physics, dynamic layout, visible walls.
   No rigging at all.
   ═══════════════════════════════════════════ */

// Physics constants — tuned for challenging feel
const GRAVITY = 0.42;
const BALL_RADIUS = 13;
const BOUNCE = 0.35;
const GROUND_FRICTION = 0.85;
const MAX_PULL = 120;
const LAUNCH_MULTIPLIER = 0.17;
const GAME_ASPECT = 1.9;
const MAX_ATTEMPTS = 3;
const RESTITUTION = 0.30;

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
  launchedFrames: number;
}

/* ── Layout generation — smaller boxes at random positions ── */
function generateLayout(allPrizes: Prize[], cupColors: string[]): {
  cups: Cup[];
  obstacles: Obstacle[];
  platforms: PlatformDef[];
} {
  const cups: Cup[] = [];
  const platforms: PlatformDef[] = [];
  const obstacles: Obstacle[] = [];

  // Proportional prize distribution
  const displaySlots = getDisplaySlots('angry-ball');
  const distributed = shuffle(distributeProportionally(allPrizes, displaySlots));
  const total = Math.max(1, distributed.length);

  // Cup size — slightly wider for better visibility
  const cupW = 0.058;
  const cupH = 0.060;

  // Random placement zone (right 2/3 of screen)
  const zoneMinX = 0.30;
  const zoneMaxX = 0.90;
  const zoneMinY = 0.18;
  const zoneMaxY = 0.72;
  const minDist = 0.12; // minimum distance between cup centers

  // Place cups at random non-overlapping positions
  for (let i = 0; i < total; i++) {
    let bestX = 0, bestY = 0;
    let placed = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      const cx = zoneMinX + Math.random() * (zoneMaxX - zoneMinX);
      const cy = zoneMinY + Math.random() * (zoneMaxY - zoneMinY);
      const tooClose = cups.some(c =>
        Math.hypot(c.x - cx, c.y - cy) < minDist
      );
      if (!tooClose) {
        bestX = cx;
        bestY = cy;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Fallback: slight offset from last cup
      bestX = zoneMinX + Math.random() * (zoneMaxX - zoneMinX);
      bestY = zoneMinY + Math.random() * (zoneMaxY - zoneMinY);
    }

    cups.push({
      x: bestX,
      y: bestY,
      w: cupW + (Math.random() - 0.5) * 0.006,
      h: cupH + (Math.random() - 0.5) * 0.006,
      color: cupColors[i % cupColors.length],
      prize: distributed[i] ?? null,
    });

    platforms.push({
      x: bestX,
      y: bestY + cupH + 0.008,
      w: cupW + 0.03,
    });
  }

  // ── OBSTACLE PLACEMENT ──
  // Rules:
  //   1. Never block a cup opening — large exclusion zone above & around each cup
  //   2. Obstacles only in the APPROACH zone (x < 0.32) and MID zone (between cups)
  //   3. No obstacle-on-obstacle overlap
  //   4. Every cup must remain reachable via an arc from the slingshot

  const cupMargin = 0.06; // clearance around every cup
  const obsMargin = 0.03; // clearance between obstacles

  function overlapsAnyCup(ox: number, oy: number, ow: number, oh: number): boolean {
    const oL = ox - ow / 2, oR = ox + ow / 2, oT = oy - oh / 2, oB = oy + oh / 2;
    for (const c of cups) {
      const cL = c.x - c.w / 2 - cupMargin;
      const cR = c.x + c.w / 2 + cupMargin;
      const cT = c.y - cupMargin * 1.2; // some space above for the ball to enter
      const cB = c.y + c.h + 0.03 + cupMargin;
      if (oL < cR && oR > cL && oT < cB && oB > cT) return true;
    }
    return false;
  }

  function overlapsAnyObs(ox: number, oy: number, ow: number, oh: number): boolean {
    const oL = ox - ow / 2, oR = ox + ow / 2, oT = oy - oh / 2, oB = oy + oh / 2;
    for (const ob of obstacles) {
      const bL = ob.x - ob.w / 2 - obsMargin, bR = ob.x + ob.w / 2 + obsMargin;
      const bT = ob.y - ob.h / 2 - obsMargin, bB = ob.y + ob.h / 2 + obsMargin;
      if (oL < bR && oR > bL && oT < bB && oB > bT) return true;
    }
    return false;
  }

  // Launch clear zone: keep ~60% of the distance from sling to first cup clear
  const slingX = 0.08; // approx slingshot x position
  const leftmostCupX = cups.reduce((min, c) => Math.min(min, c.x - c.w / 2), 1);
  const launchClearX = slingX + (leftmostCupX - slingX) * 0.55; // obstacles allowed in outer 45% of approach

  function tryPlace(ox: number, oy: number, ow: number, oh: number, jitter = 0.06): boolean {
    for (let t = 0; t < 40; t++) {
      const jx = t === 0 ? 0 : (Math.random() - 0.5) * jitter;
      const jy = t === 0 ? 0 : (Math.random() - 0.5) * jitter;
      const px = Math.max(0.05, Math.min(0.95, ox + jx));
      const py = Math.max(0.08, Math.min(0.85, oy + jy));
      // Reject if inside the launch clear zone (sling → first cup)
      if (px - ow / 2 < launchClearX) continue;
      if (!overlapsAnyCup(px, py, ow, oh) && !overlapsAnyObs(px, py, ow, oh)) {
        obstacles.push({ x: px, y: py, w: ow, h: oh });
        return true;
      }
    }
    return false;
  }

  // ── Obstacles only AFTER the launch clear zone ──
  // MID ZONE: between cup clusters
  const midMinX = Math.max(launchClearX + 0.02, 0.32);
  const midCount = 7 + Math.floor(Math.random() * 4); // 7-10
  for (let i = 0; i < midCount; i++) {
    const isVert = Math.random() > 0.5;
    const ox = midMinX + Math.random() * (0.60 - midMinX);
    const oy = 0.10 + Math.random() * 0.72;
    if (isVert) {
      tryPlace(ox, oy, 0.018 + Math.random() * 0.010, 0.08 + Math.random() * 0.06, 0.10);
    } else {
      tryPlace(ox, oy, 0.06 + Math.random() * 0.05, 0.016 + Math.random() * 0.006, 0.10);
    }
  }

  // FAR ZONE: bounce ramps beyond most cups
  const farCount = 3 + Math.floor(Math.random() * 3); // 3-5
  for (let i = 0; i < farCount; i++) {
    const ox = 0.65 + Math.random() * 0.23;
    const oy = 0.12 + Math.random() * 0.68;
    tryPlace(ox, oy, 0.05 + Math.random() * 0.04, 0.016 + Math.random() * 0.005, 0.10);
  }

  return { cups, obstacles, platforms };
}

export default function AngryBall({ theme }: { theme?: GameTheme }) {
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, routePrefix, mode } = { ...DEFAULT_THEME, ...theme };
  const isLight = mode === 'light';
  const goldRgb = hexToRgb(GOLD);
  const CUP_COLORS = [GOLD, AMBER, SIENNA, GOLD_BRIGHT, '#b45309'];

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [isPortrait, setIsPortrait] = useState(false);
  const isPortraitRef = useRef(false);
  const [gameOver, setGameOver] = useState(false);

  const ballRef = useRef<BallState>({
    x: 0, y: 0, vx: 0, vy: 0,
    launched: false, landed: false, rotation: 0, trail: [], stillFrames: 0, launchedFrames: 0,
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
  const prizesRef = useRef<Prize[]>([]);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { prizesRef.current = prizes; }, [prizes]);
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
      rotation: 0, trail: [], stillFrames: 0, launchedFrames: 0,
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

        // Prize emoji inside the cup — large and bright
        if (cup.prize) {
          const emojiSize = Math.min(24, cupW * 0.8);
          ctx.font = `${emojiSize * dpr}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 1;
          ctx.fillText(cup.prize.emoji, cp.x, cp.y + cupH * 0.4);
        }
      }

      /* ── Obstacles — BRIGHT and VISIBLE walls (oscillating) ── */
      for (let oi = 0; oi < obstaclesRef.current.length; oi++) {
        const obs = obstaclesRef.current[oi];
        const op = toGame(obs.x, obs.y);
        // Oscillate obstacles vertically like cannon
        const oscAmp = (12 + (oi % 3) * 6) * dpr;
        const oscSpeed = 0.5 + (oi % 4) * 0.2;
        const oscOffset = Math.sin(time * oscSpeed + oi * 2.1) * oscAmp;
        op.y += oscOffset;
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

        // Obstacle collisions — oscillating positions (must match rendering)
        for (let oi = 0; oi < obstaclesRef.current.length; oi++) {
          const obs = obstaclesRef.current[oi];
          const op = toGame(obs.x, obs.y);
          const oscAmp = (12 + (oi % 3) * 6) * dpr;
          const oscSpeed = 0.5 + (oi % 4) * 0.2;
          const oscOffset = Math.sin(time * oscSpeed + oi * 2.1) * oscAmp;
          op.y += oscOffset;
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

        // Cup collision — 3 walls (left, right, bottom) + open top entry
        for (const cup of cupsRef.current) {
          const cp = toGame(cup.x, cup.y);
          const cupPxW = cup.w * g.w;
          const cupPxH = cup.h * g.h;
          const cLeft = cp.x - cupPxW / 2;
          const cRight = cp.x + cupPxW / 2;
          const cTop = cp.y;
          const cBottom = cp.y + cupPxH;
          const wt = 4 * dpr;

          // 3 wall AABBs: left, right, bottom
          const cupWalls = [
            { l: cLeft - wt, r: cLeft, t: cTop, b: cBottom },
            { l: cRight, r: cRight + wt, t: cTop, b: cBottom },
            { l: cLeft - wt, r: cRight + wt, t: cBottom, b: cBottom + wt },
          ];

          let hitCupWall = false;
          for (const wall of cupWalls) {
            const nearX = Math.max(wall.l, Math.min(wall.r, ball.x));
            const nearY = Math.max(wall.t, Math.min(wall.b, ball.y));
            const ddx = ball.x - nearX, ddy = ball.y - nearY;
            const dist = Math.sqrt(ddx * ddx + ddy * ddy);
            if (dist < br && dist > 0) {
              const nx = ddx / dist, ny = ddy / dist;
              ball.x += nx * (br - dist);
              ball.y += ny * (br - dist);
              const dot = ball.vx * nx + ball.vy * ny;
              if (dot < 0) {
                ball.vx -= (1 + RESTITUTION) * dot * nx;
                ball.vy -= (1 + RESTITUTION) * dot * ny;
              }
              getSoundEngine().peg(0);
              hitCupWall = true;
            }
          }

          // Ball settling inside cup — open top entry
          if (!hitCupWall && !ball.landed &&
              ball.x > cLeft + br * 0.2 && ball.x < cRight - br * 0.2 &&
              ball.y > cTop && ball.y + br < cBottom + wt) {
            ball.vx *= 0.82;
            ball.vy *= 0.82;
            if (Math.abs(ball.vy) < 2 * dpr && Math.abs(ball.vx) < 2 * dpr) {
              ball.landed = true;
              ball.x = cp.x;
              ball.y = cTop + cupPxH * 0.45;
              ball.vx = 0; ball.vy = 0;
              getSoundEngine().swish();

              if (cup.prize) {
                setWonPrize(cup.prize);
                setTimeout(() => { if (phaseRef.current === 'playing') setPhase('victory'); }, 1200);
              }
            }
          }
        }

        // Stuck / miss detection
        ball.launchedFrames++;
        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        if (speed < 1.0 * dpr) {
          ball.stillFrames++;
        } else {
          ball.stillFrames = 0;
        }

        // Ball nearly stopped for 60 frames = missed shot (no more anti-stuck kicks)
        const isMiss = ball.stillFrames > 60 && !ball.landed;
        // Safety: if ball has been flying for 600+ frames (~10s), force miss
        const isTooLong = ball.launchedFrames > 600 && !ball.landed;

        if (isMiss || isTooLong) {
          attemptsRef.current++;
          setAttempts(attemptsRef.current);
          if (attemptsRef.current >= MAX_ATTEMPTS) {
            setGameOver(true);
            const consolation = getConsolationPrize(prizesRef.current);
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
            const consolation = getConsolationPrize(prizesRef.current);
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
        {/* Back to menu */}
        <Link href={routePrefix || '/'} className="absolute top-3 left-3 z-50 w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md transition-all duration-200 active:scale-90" style={{ background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)', border: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'}` }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)' }}><path d="M15 18l-6-6 6-6" /></svg>
        </Link>
        <PrizeLegend prizes={prizes} isLight={isLight} />
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

        {/* Ready screen */}
        {phase === 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
            <div className="absolute inset-0" style={{ background: isLight ? `linear-gradient(180deg, ${BG_LIGHT} 0%, ${BG_MID} 50%, ${BG_DARK} 100%)` : `radial-gradient(ellipse at 30% 50%, ${BG_LIGHT} 0%, ${BG_MID} 50%, ${BG_DARK} 100%)` }} />
            <div className="relative z-10 flex flex-col items-center gap-4 px-8">
              {/* Icon */}
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: GOLD + '15', animation: 'victoryFloat 3s ease-in-out infinite' }}>
                <svg viewBox="0 0 32 32" fill="none" className="w-7 h-7" style={{ color: GOLD }}>
                  <circle cx="8" cy="20" r="5" fill="currentColor" opacity="0.9"/>
                  <path d="M13 20 L26 10" stroke="currentColor" strokeWidth="2" strokeDasharray="2 2" opacity="0.4"/>
                  <rect x="23" y="6" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
                </svg>
              </div>
              <h1 className="text-[24px] font-bold tracking-[-0.02em] text-center"
                style={{ color: CREAM, animation: 'fadeInUp 0.5s ease-out both' }}>
                Angry Ball
              </h1>
              <p style={{ color: CREAM + '60' }} className="text-[13px] leading-relaxed text-center max-w-[240px]">
                Tirez la boule et visez le cadeau que vous voulez gagner
              </p>
              {gameOver && (
                <p className="text-sm font-semibold" style={{ color: '#ef4444', animation: 'fadeIn 0.3s ease-out both' }}>
                  Pas de chance, réessayez
                </p>
              )}
              <button
                onClick={start}
                className="mt-1 px-8 py-3.5 rounded-xl font-semibold text-[14px] tracking-wide transition-all duration-200 active:scale-[0.97]"
                style={{ background: GOLD, color: '#ffffff', boxShadow: `0 4px 20px -4px ${GOLD}50`, animation: 'fadeInUp 0.5s ease-out 0.2s both' }}
              >
                {gameOver ? 'Réessayer' : 'Commencer'}
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
            isConsolation={gameOver}
          />
        )}
      </div>
    </div>
  );
}
