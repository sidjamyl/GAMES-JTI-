'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';

/* ═══════════════════════════════════════════════
   ANGRY BALL — Horizontal slingshot game
   Pull back and launch the ball into cups.
   Layout is always horizontal (landscape).
   Always rigged: ball always lands in a cup.
   ═══════════════════════════════════════════════ */

const ACCENT_FROM = '#f97316';
const ACCENT_TO = '#ef4444';

const GRAVITY = 0.28;
const BALL_RADIUS = 14;
const BOUNCE = 0.55;
const GROUND_FRICTION = 0.92;
const MAX_PULL = 120;
const LAUNCH_MULTIPLIER = 0.18;

// Game area aspect ratio (landscape)
const GAME_ASPECT = 1.9;

interface Cup {
  x: number; y: number;  // normalized 0-1 (relative to game area)
  w: number;             // width in normalized units
  h: number;             // height in normalized units
  color: string;
}

const CUPS: Cup[] = [
  { x: 0.52, y: 0.82, w: 0.07, h: 0.08, color: '#ef4444' },
  { x: 0.65, y: 0.60, w: 0.065, h: 0.08, color: '#fbbf24' },
  { x: 0.78, y: 0.78, w: 0.065, h: 0.08, color: '#3b82f6' },
  { x: 0.88, y: 0.52, w: 0.06, h: 0.08, color: '#10b981' },
  { x: 0.72, y: 0.40, w: 0.06, h: 0.08, color: '#8b5cf6' },
];

interface Obstacle {
  x: number; y: number;
  w: number; h: number;
}

const OBSTACLES: Obstacle[] = [
  { x: 0.38, y: 0.55, w: 0.035, h: 0.18 },
  { x: 0.55, y: 0.42, w: 0.10, h: 0.03 },
  { x: 0.45, y: 0.72, w: 0.08, h: 0.03 },
];

// Platforms under cups
const PLATFORMS: { x: number; y: number; w: number }[] = [
  { x: 0.52, y: 0.90, w: 0.10 },
  { x: 0.65, y: 0.68, w: 0.10 },
  { x: 0.78, y: 0.86, w: 0.10 },
  { x: 0.88, y: 0.60, w: 0.09 },
  { x: 0.72, y: 0.48, w: 0.09 },
];

const SLING_ANCHOR = { x: 0.10, y: 0.58 };

interface BallState {
  x: number; y: number;
  vx: number; vy: number;
  launched: boolean;
  landed: boolean;
  rotation: number;
  trail: { x: number; y: number; alpha: number }[];
}

export default function AngryBall() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [isPortrait, setIsPortrait] = useState(false);
  const [showLanded, setShowLanded] = useState(false);

  const ballRef = useRef<BallState>({
    x: 0, y: 0, vx: 0, vy: 0,
    launched: false, landed: false, rotation: 0, trail: [],
  });
  const draggingRef = useRef(false);
  const dragPosRef = useRef({ x: 0, y: 0 });
  const animRef = useRef(0);
  const phaseRef = useRef<GamePhase>('loading');
  const dprRef = useRef(1);
  const gameAreaRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const targetPrizeRef = useRef<Prize | null>(null);
  const assistAppliedRef = useRef(false);
  const frameCountRef = useRef(0);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    fetchPrizes().then(p => { setPrizes(p); setPhase('ready'); });
  }, []);

  useEffect(() => {
    const check = () => setIsPortrait(window.innerWidth < window.innerHeight);
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

    // Fit landscape game area inside canvas
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

  const fromGame = useCallback((px: number, py: number) => {
    const g = gameAreaRef.current;
    return { x: (px - g.x) / g.w, y: (py - g.y) / g.h };
  }, []);

  const resetBall = useCallback(() => {
    const anchor = toGame(SLING_ANCHOR.x, SLING_ANCHOR.y);
    ballRef.current = {
      x: anchor.x, y: anchor.y,
      vx: 0, vy: 0,
      launched: false, landed: false,
      rotation: 0, trail: [],
    };
    draggingRef.current = false;
    assistAppliedRef.current = false;
    frameCountRef.current = 0;
  }, [toGame]);

  // ── Render loop ──
  const startLoop = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const loop = () => {
      if (phaseRef.current !== 'playing') return;
      const cw = c.width, ch = c.height;
      const dpr = dprRef.current;
      const g = gameAreaRef.current;
      const ball = ballRef.current;
      const br = BALL_RADIUS * dpr;
      const time = Date.now() * 0.003;

      ctx.clearRect(0, 0, cw, ch);

      /* ── Background ── */
      const bg = ctx.createLinearGradient(0, 0, cw, 0);
      bg.addColorStop(0, '#1a0a05');
      bg.addColorStop(0.5, '#0f1520');
      bg.addColorStop(1, '#0a0515');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cw, ch);

      /* ── Game area background ── */
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.beginPath();
      ctx.roundRect(g.x, g.y, g.w, g.h, 12 * dpr);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();

      /* ── Ground ── */
      const ground = toGame(0, 0.95);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(g.x, ground.y, g.w, g.y + g.h - ground.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(g.x, ground.y);
      ctx.lineTo(g.x + g.w, ground.y);
      ctx.stroke();

      /* ── Platforms & Cups ── */
      for (let i = 0; i < CUPS.length; i++) {
        const cup = CUPS[i];
        const plat = PLATFORMS[i];
        const pp = toGame(plat.x, plat.y);
        const pw = plat.w * g.w;

        // Platform
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(pp.x - pw / 2, pp.y, pw, 4 * dpr);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1 * dpr;
        ctx.strokeRect(pp.x - pw / 2, pp.y, pw, 4 * dpr);

        // Platform support
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(pp.x - 2 * dpr, pp.y + 4 * dpr, 4 * dpr, ground.y - pp.y - 4 * dpr);

        // Cup (U-shape)
        const cp = toGame(cup.x, cup.y);
        const cw2 = cup.w * g.w;
        const ch2 = cup.h * g.h;

        // Cup body
        ctx.save();
        ctx.shadowBlur = 12 * dpr;
        ctx.shadowColor = cup.color + '30';
        ctx.fillStyle = cup.color + '15';
        ctx.beginPath();
        ctx.moveTo(cp.x - cw2 / 2, cp.y);
        ctx.lineTo(cp.x - cw2 / 2, cp.y + ch2);
        ctx.arcTo(cp.x - cw2 / 2, cp.y + ch2 + 6 * dpr, cp.x, cp.y + ch2 + 6 * dpr, 6 * dpr);
        ctx.lineTo(cp.x + cw2 / 2 - 6 * dpr, cp.y + ch2 + 6 * dpr);
        ctx.arcTo(cp.x + cw2 / 2, cp.y + ch2 + 6 * dpr, cp.x + cw2 / 2, cp.y + ch2, 6 * dpr);
        ctx.lineTo(cp.x + cw2 / 2, cp.y);
        ctx.fill();
        ctx.strokeStyle = cup.color + '50';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
        ctx.restore();

        // Cup opening glow
        const pulse = 0.5 + Math.sin(time + i * 1.2) * 0.3;
        ctx.save();
        ctx.shadowBlur = 10 * dpr * pulse;
        ctx.shadowColor = cup.color;
        ctx.strokeStyle = cup.color + '40';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(cp.x - cw2 / 2, cp.y);
        ctx.lineTo(cp.x + cw2 / 2, cp.y);
        ctx.stroke();
        ctx.restore();
      }

      /* ── Obstacles ── */
      for (const obs of OBSTACLES) {
        const op = toGame(obs.x, obs.y);
        const ow = obs.w * g.w;
        const oh = obs.h * g.h;
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(op.x - ow / 2, op.y - oh / 2, ow, oh);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeRect(op.x - ow / 2, op.y - oh / 2, ow, oh);
      }

      /* ── Slingshot ── */
      const anchor = toGame(SLING_ANCHOR.x, SLING_ANCHOR.y);
      const postW = 5 * dpr;
      const postH = 40 * dpr;
      const postSpread = 18 * dpr;

      // Posts
      const leftPostX = anchor.x - postSpread;
      const rightPostX = anchor.x + postSpread;
      const postTop = anchor.y - postH;

      ctx.fillStyle = 'rgba(139,92,40,0.6)';
      ctx.fillRect(leftPostX - postW / 2, postTop, postW, postH + 20 * dpr);
      ctx.fillRect(rightPostX - postW / 2, postTop, postW, postH + 20 * dpr);

      // Post caps
      ctx.fillStyle = 'rgba(200,140,60,0.5)';
      ctx.beginPath(); ctx.arc(leftPostX, postTop, postW * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(rightPostX, postTop, postW * 0.8, 0, Math.PI * 2); ctx.fill();

      // Base
      ctx.fillStyle = 'rgba(100,70,30,0.4)';
      ctx.fillRect(leftPostX - 8 * dpr, anchor.y + 20 * dpr - 4 * dpr, postSpread * 2 + 16 * dpr, 8 * dpr);

      // Elastic bands (when dragging or before launch)
      if (!ball.launched) {
        const bandColor = draggingRef.current ? '#ef4444' : '#d97706';
        ctx.strokeStyle = bandColor;
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath(); ctx.moveTo(leftPostX, postTop + 3 * dpr); ctx.lineTo(ball.x, ball.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rightPostX, postTop + 3 * dpr); ctx.lineTo(ball.x, ball.y); ctx.stroke();

        // Glow on bands when stretched
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

      /* ── Ball physics ── */
      if (ball.launched && !ball.landed) {
        frameCountRef.current++;
        ball.vy += GRAVITY * dpr;
        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.rotation += ball.vx * 0.015;

        // Trail
        ball.trail.push({ x: ball.x, y: ball.y, alpha: 1 });
        if (ball.trail.length > 16) ball.trail.shift();
        ball.trail.forEach(t => { t.alpha *= 0.88; });

        // Boundary collisions
        if (ball.x - br < g.x) { ball.x = g.x + br; ball.vx *= -BOUNCE; }
        if (ball.x + br > g.x + g.w) { ball.x = g.x + g.w - br; ball.vx *= -BOUNCE; }
        if (ball.y - br < g.y) { ball.y = g.y + br; ball.vy *= -BOUNCE; }

        // Ground bounce
        if (ball.y + br > ground.y) {
          ball.y = ground.y - br;
          ball.vy *= -BOUNCE;
          ball.vx *= GROUND_FRICTION;
          if (Math.abs(ball.vy) < 1 * dpr) ball.vy = 0;
          getSoundEngine().impact();
        }

        // Obstacle collisions
        for (const obs of OBSTACLES) {
          const op = toGame(obs.x, obs.y);
          const ow = obs.w * g.w;
          const oh = obs.h * g.h;
          const left = op.x - ow / 2;
          const right = op.x + ow / 2;
          const top = op.y - oh / 2;
          const bottom = op.y + oh / 2;

          // Find closest point on rect to ball center
          const nearX = Math.max(left, Math.min(right, ball.x));
          const nearY = Math.max(top, Math.min(bottom, ball.y));
          const dx = ball.x - nearX;
          const dy = ball.y - nearY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < br) {
            const pen = br - dist;
            const nx = dist > 0 ? dx / dist : 0;
            const ny = dist > 0 ? dy / dist : -1;
            ball.x += nx * pen;
            ball.y += ny * pen;
            const dot = ball.vx * nx + ball.vy * ny;
            ball.vx -= 1.8 * dot * nx;
            ball.vy -= 1.8 * dot * ny;
            ball.vx *= 0.7;
            ball.vy *= 0.7;
            getSoundEngine().peg(Math.floor(Math.random() * 3));
          }
        }

        // Platform collisions
        for (const plat of PLATFORMS) {
          const pp = toGame(plat.x, plat.y);
          const pw = plat.w * g.w;
          const platLeft = pp.x - pw / 2;
          const platRight = pp.x + pw / 2;
          const platTop = pp.y;
          const platH = 4 * dpr;

          if (
            ball.x + br > platLeft && ball.x - br < platRight &&
            ball.y + br > platTop && ball.y - br < platTop + platH
          ) {
            if (ball.vy > 0 && ball.y < platTop + platH / 2) {
              ball.y = platTop - br;
              ball.vy *= -BOUNCE;
              ball.vx *= GROUND_FRICTION;
              getSoundEngine().impact();
            } else if (ball.vy < 0 && ball.y > platTop + platH / 2) {
              ball.y = platTop + platH + br;
              ball.vy *= -BOUNCE;
            }
          }
        }

        // Cup detection
        for (const cup of CUPS) {
          const cp = toGame(cup.x, cup.y);
          const cw2 = cup.w * g.w;
          const ch2 = cup.h * g.h;
          const cupLeft = cp.x - cw2 / 2;
          const cupRight = cp.x + cw2 / 2;
          const cupTop = cp.y;
          const cupBottom = cp.y + ch2;

          // Ball enters cup from top
          if (
            ball.x > cupLeft + br * 0.3 && ball.x < cupRight - br * 0.3 &&
            ball.y + br > cupTop && ball.y < cupBottom &&
            ball.vy > 0
          ) {
            // Slow ball down inside cup
            ball.vx *= 0.3;
            ball.vy *= 0.2;
            if (Math.abs(ball.vy) < 2 * dpr && Math.abs(ball.vx) < 2 * dpr) {
              // Landed!
              ball.landed = true;
              ball.x = cp.x;
              ball.y = cupTop + ch2 * 0.5;
              ball.vx = 0; ball.vy = 0;
              getSoundEngine().swish();
              setShowLanded(true);
              setTimeout(() => setShowLanded(false), 1000);
              if (targetPrizeRef.current) {
                setWonPrize(targetPrizeRef.current);
                setTimeout(() => { if (phaseRef.current === 'playing') setPhase('victory'); }, 1200);
              }
            }
          }

          // Cup wall collisions (sides)
          if (ball.y > cupTop && ball.y < cupBottom) {
            // Left wall
            if (ball.x + br > cupLeft && ball.x < cupLeft + 4 * dpr && ball.vx > 0) {
              ball.x = cupLeft - br;
              ball.vx *= -0.5;
            }
            // Right wall
            if (ball.x - br < cupRight && ball.x > cupRight - 4 * dpr && ball.vx < 0) {
              ball.x = cupRight + br;
              ball.vx *= -0.5;
            }
          }
        }

        // Rigging: after some frames, start guiding ball toward nearest cup
        if (frameCountRef.current > 60 && !assistAppliedRef.current) {
          let nearestCup = CUPS[0];
          let nearestDist = Infinity;
          for (const cup of CUPS) {
            const cp = toGame(cup.x, cup.y);
            const dx = ball.x - cp.x;
            const dy = ball.y - cp.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < nearestDist) { nearestDist = d; nearestCup = cup; }
          }
          const cp = toGame(nearestCup.x, nearestCup.y);
          const dx = cp.x - ball.x;
          const dy = cp.y - ball.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > 1) {
            const force = 0.04 * dpr;
            ball.vx += (dx / d) * force;
            ball.vy += (dy / d) * force * 0.5;
          }
        }

        // Stronger rigging if ball is losing energy on ground
        if (ball.y + br >= ground.y - 2 * dpr && Math.abs(ball.vx) < 1.5 * dpr && !ball.landed) {
          let nearestCup = CUPS[0];
          let nearestDist = Infinity;
          for (const cup of CUPS) {
            const cp = toGame(cup.x, cup.y);
            const d = Math.abs(ball.x - cp.x);
            if (d < nearestDist) { nearestDist = d; nearestCup = cup; }
          }
          const cp = toGame(nearestCup.x, nearestCup.y);
          ball.vx += (cp.x - ball.x) * 0.003 * dpr;
          // If stuck, give a boost up toward cup
          if (Math.abs(ball.vx) < 0.5 * dpr && Math.abs(ball.vy) < 0.5 * dpr) {
            ball.vy = -5 * dpr;
            ball.vx = (cp.x - ball.x) * 0.04 * dpr;
            assistAppliedRef.current = true;
          }
        }

        // Off screen reset
        if (ball.y > g.y + g.h + 50 * dpr || ball.x > g.x + g.w + 100 * dpr) {
          setAttempts(a => a + 1);
          resetBall();
        }
      }

      /* ── Draw trail ── */
      for (const t of ball.trail) {
        if (t.alpha < 0.05) continue;
        ctx.beginPath();
        ctx.arc(t.x, t.y, Math.max(2, br * t.alpha * 0.6), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(249,115,22,${t.alpha * 0.25})`;
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

      // Body
      const ballGrad = ctx.createRadialGradient(-br * 0.3, -br * 0.3, br * 0.1, 0, 0, br);
      ballGrad.addColorStop(0, '#fee2e2');
      ballGrad.addColorStop(0.4, '#ef4444');
      ballGrad.addColorStop(1, '#991b1b');
      ctx.beginPath(); ctx.arc(0, 0, br, 0, Math.PI * 2);
      ctx.fillStyle = ballGrad; ctx.fill();
      ctx.strokeStyle = 'rgba(153,27,27,0.4)';
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();

      // Angry face
      ctx.fillStyle = 'white';
      ctx.beginPath(); ctx.arc(-br * 0.25, -br * 0.15, br * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(br * 0.25, -br * 0.15, br * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath(); ctx.arc(-br * 0.22, -br * 0.12, br * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(br * 0.28, -br * 0.12, br * 0.07, 0, Math.PI * 2); ctx.fill();

      // Eyebrows (angry)
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(-br * 0.4, -br * 0.35);
      ctx.lineTo(-br * 0.1, -br * 0.25);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(br * 0.4, -br * 0.35);
      ctx.lineTo(br * 0.1, -br * 0.25);
      ctx.stroke();

      // Mouth
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(0, br * 0.2, br * 0.2, 0.2, Math.PI - 0.2);
      ctx.stroke();

      // Highlight
      ctx.beginPath(); ctx.arc(-br * 0.3, -br * 0.3, br * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fill();

      ctx.restore();

      /* ── Pull indicator (when dragging) ── */
      if (draggingRef.current && !ball.launched) {
        const dx = anchor.x - ball.x;
        const dy = anchor.y - ball.y;
        const pullDist = Math.sqrt(dx * dx + dy * dy);
        const maxPull = MAX_PULL * dpr;
        const strength = Math.min(pullDist / maxPull, 1);

        // Trajectory preview dots
        const launchVx = dx * LAUNCH_MULTIPLIER;
        const launchVy = dy * LAUNCH_MULTIPLIER;
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
          ctx.fillStyle = `rgba(249,115,22,${dotAlpha})`;
          ctx.fill();
        }
        ctx.restore();

        // Power bar
        const barX = g.x + 12 * dpr;
        const barY = g.y + g.h * 0.2;
        const barH = g.h * 0.5;
        const barW = 6 * dpr;
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(barX, barY, barW, barH);
        const fillH = barH * strength;
        const barGrad = ctx.createLinearGradient(0, barY + barH, 0, barY + barH - fillH);
        barGrad.addColorStop(0, '#22c55e');
        barGrad.addColorStop(0.5, '#f59e0b');
        barGrad.addColorStop(1, '#ef4444');
        ctx.fillStyle = barGrad;
        ctx.fillRect(barX, barY + barH - fillH, barW, fillH);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
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
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText('← Tirez la boule en arrière', anchor.x + 80 * dpr, anchor.y + 40 * dpr + bob);
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [toGame, resetBall]);

  const start = useCallback(() => {
    setupCanvas();
    resetBall();
    setWonPrize(null);
    setAttempts(0);
    setShowLanded(false);
    targetPrizeRef.current = selectRandomPrize(prizes);
    setPhase('playing');
    setTimeout(() => startLoop(), 50);
    return () => cancelAnimationFrame(animRef.current);
  }, [prizes, setupCanvas, resetBall, startLoop]);

  // ── Input handling ──
  const getCanvasPos = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const dpr = dprRef.current;
    const cx = 'touches' in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const cy = 'touches' in e ? e.touches[0]?.clientY ?? 0 : e.clientY;
    return { x: (cx - rect.left) * dpr, y: (cy - rect.top) * dpr };
  }, []);

  const onPointerDown = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (phase !== 'playing') return;
    const ball = ballRef.current;
    if (ball.launched || ball.landed) return;
    const pos = getCanvasPos(e);
    const dx = pos.x - ball.x;
    const dy = pos.y - ball.y;
    if (Math.sqrt(dx * dx + dy * dy) < 50 * dprRef.current) {
      draggingRef.current = true;
      dragPosRef.current = pos;
    }
  }, [phase, getCanvasPos]);

  const onPointerMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!draggingRef.current || phase !== 'playing') return;
    const pos = getCanvasPos(e);
    const anchor = toGame(SLING_ANCHOR.x, SLING_ANCHOR.y);
    const dx = pos.x - anchor.x;
    const dy = pos.y - anchor.y;
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
    const dx = anchor.x - ball.x;
    const dy = anchor.y - ball.y;
    const pullDist = Math.sqrt(dx * dx + dy * dy);

    if (pullDist > 15 * dprRef.current) {
      ball.vx = dx * LAUNCH_MULTIPLIER;
      ball.vy = dy * LAUNCH_MULTIPLIER;
      ball.launched = true;
      ball.trail = [];
      ball.rotation = 0;
      getSoundEngine().swoosh();
    } else {
      // Not enough pull, snap back
      ball.x = anchor.x;
      ball.y = anchor.y;
    }
  }, [phase, toGame]);

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  // Container style for forced landscape
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
      <div className="relative w-full h-full" style={{ background: '#0f0a05' }}>
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

        {/* Landed effect */}
        {showLanded && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none" style={{ animation: 'fadeInUp 0.3s ease-out both' }}>
            <span className="text-3xl font-black tracking-tight" style={{ background: `linear-gradient(135deg, ${ACCENT_FROM}, ${ACCENT_TO})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              DANS LE TROU! 🎯
            </span>
          </div>
        )}

        {/* Attempts */}
        {phase === 'playing' && attempts > 0 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
            <span className="text-xs font-semibold text-white/30">Tentative {attempts + 1}</span>
          </div>
        )}

        {/* Ready screen */}
        {phase === 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
            <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 30% 50%, #1a0a05 0%, #0f1520 50%, #0a0515 100%)' }} />
            <div className="relative z-10 flex flex-col items-center gap-4 px-8">
              <div className="text-6xl" style={{ animation: 'victoryFloat 3s ease-in-out infinite' }}>😡</div>
              <h1 className="text-[28px] font-extrabold text-white tracking-tight text-center" style={{ animation: 'fadeInUp 0.6s ease-out both' }}>
                Angry Ball
              </h1>
              <p className="text-white/40 text-[13px] leading-relaxed text-center max-w-[260px]" style={{ animation: 'fadeInUp 0.6s ease-out 0.1s both' }}>
                Tirez la boule en arrière puis relâchez<br />pour la lancer dans un des trous !
              </p>
              <button
                onClick={start}
                className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-[15px] tracking-wide transition-all duration-200 active:scale-[0.96]"
                style={{ background: `linear-gradient(135deg, ${ACCENT_FROM}, ${ACCENT_TO})`, boxShadow: `0 12px 40px -10px ${ACCENT_FROM}80`, animation: 'fadeInUp 0.6s ease-out 0.2s both' }}
              >
                Lancer 😡
              </button>
            </div>
          </div>
        )}

        {phase === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: '#0f0a05' }}>
            <div className="w-8 h-8 border-2 border-white/20 border-t-orange-500 rounded-full" style={{ animation: 'spin 0.8s linear infinite' }} />
          </div>
        )}

        {phase === 'victory' && wonPrize && (
          <VictoryScreen
            prize={wonPrize}
            onClose={() => { cancelAnimationFrame(animRef.current); setPhase('ready'); }}
            accentFrom={ACCENT_FROM}
            accentTo={ACCENT_TO}
          />
        )}
      </div>
    </div>
  );
}
