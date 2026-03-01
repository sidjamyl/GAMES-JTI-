'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectPremiumPrize, getConsolationPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';
import { getDisplaySlots, distributeProportionally, shuffle } from '../lib/gameConfig';

/* ═══════════════════════════════════════════════
   PENDULUM — Polished timing grab game
   Pendulum swings continuously. Hook drops while
   pendulum keeps swinging. Claw visually closes
   around gift, lifts it back up. Particles, shake.
   ═══════════════════════════════════════════════ */

interface ConveyorItem {
  x: number;
  prize: Prize;
  speed: number;
  size: number;
  hue: number;
  bobPhase: number;
  grabbed: boolean;
  vx: number;
  dirTimer: number;
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; color: string;
}

const GIFT_HUES = [0, 35, 55, 120, 210, 280, 340];
const MAX_ATTEMPTS = 3;

export default function Pendulum({ theme }: { theme?: GameTheme }) {
  const T = { ...DEFAULT_THEME, ...theme };
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, TOBACCO } = T;
  const goldRgb = hexToRgb(GOLD);
  const creamRgb = hexToRgb(CREAM);
  const mahoganyRgb = hexToRgb(MAHOGANY);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const phaseRef = useRef<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [missed, setMissed] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const animRef = useRef<number>(0);
  const dprRef = useRef(1);

  /* ── State refs ── */
  const pendRef = useRef({
    angle: 0.8, angVel: 0,
    dropping: false, retracting: false,
    extension: 0,        // how far the hook has extended (0 = at rest, positive = dropping)
    extSpeed: 0,
    clawOpen: 1,         // 1 = open, 0 = closed
    clawTarget: 1,
    frozenAngle: 0,      // angle locked at tap moment — hook drops straight down
  });
  const conveyorRef = useRef<ConveyorItem[]>([]);
  const caughtRef = useRef<{ prize: Prize; hue: number; size: number } | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const timeRef = useRef(0);
  const doneRef = useRef(false);
  const particlesRef = useRef<Particle[]>([]);
  const shakeRef = useRef({ amount: 0 });
  const lastTimeRef = useRef(0);
  const attemptsRef = useRef(0);

  const DAMPING = 0.9992;
  const G_ACCEL = 0.0038;

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { fetchPrizes().then(p => { setPrizes(p); setPhase('ready'); }); }, []);

  const addParticles = (x: number, y: number, count: number, color: string) => {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 3;
      particlesRef.current.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5,
        life: 0, maxLife: 25 + Math.random() * 20,
        size: 2 + Math.random() * 2.5, color,
      });
    }
  };

  const initConveyor = useCallback((w: number, prizes: Prize[]) => {
    const items: ConveyorItem[] = [];
    const displaySlots = getDisplaySlots('pendulum');
    const distributed = shuffle(distributeProportionally(prizes, displaySlots));
    const count = distributed.length || 1;
    const giftSize = Math.max(22, Math.min(36, w * 0.085));
    const spacing = w / Math.max(count, 1);
    for (let i = 0; i < count; i++) {
      items.push({
        x: 40 + i * spacing,
        prize: distributed[i],
        speed: 1.8 + Math.random() * 1.0,
        size: giftSize,
        hue: GIFT_HUES[Math.floor(Math.random() * GIFT_HUES.length)],
        bobPhase: Math.random() * Math.PI * 2,
        grabbed: false,
        vx: (Math.random() > 0.5 ? 1 : -1) * (2.5 + Math.random() * 2.0),
        dirTimer: 20 + Math.floor(Math.random() * 40),
      });
    }
    conveyorRef.current = items;
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

    const pivotX = w / 2;
    const pivotY = h * 0.08;
    const ropeRestLen = h * 0.28;
    const conveyorY = h * 0.72;
    const targetDropY = conveyorY - 8; // where gifts sit
    // maxExtension is computed dynamically per drop based on frozen angle

    pendRef.current = {
      angle: 0.75, angVel: 0,
      dropping: false, retracting: false,
      extension: 0, extSpeed: 0,
      clawOpen: 1, clawTarget: 1,
      frozenAngle: 0,
    };
    caughtRef.current = null;
    doneRef.current = false;
    particlesRef.current = [];
    shakeRef.current.amount = 0;
    initConveyor(w, prizes);
    timeRef.current = 0;
    lastTimeRef.current = 0;

    const loop = () => {
      if (doneRef.current) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const now = performance.now();
      const rawDt = lastTimeRef.current ? (now - lastTimeRef.current) / 16.667 : 1;
      const dt = Math.min(rawDt, 3);
      lastTimeRef.current = now;
      timeRef.current += dt;

      // Screen shake
      let sx = 0, sy = 0;
      if (shakeRef.current.amount > 0) {
        sx = (Math.random() - 0.5) * shakeRef.current.amount;
        sy = (Math.random() - 0.5) * shakeRef.current.amount;
        shakeRef.current.amount *= Math.pow(0.88, dt);
        if (shakeRef.current.amount < 0.3) shakeRef.current.amount = 0;
      }
      ctx.translate(sx, sy);
      ctx.clearRect(-10, -10, w + 20, h + 20);

      // Background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#0e0b18');
      bgGrad.addColorStop(0.4, '#14101f');
      bgGrad.addColorStop(1, '#0a0812');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(-10, -10, w + 20, h + 20);

      // Subtle grid
      ctx.strokeStyle = 'rgba(255,255,255,0.012)';
      ctx.lineWidth = 1;
      for (let gy = 0; gy < h; gy += 28) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
      }

      const pend = pendRef.current;

      /* ── PENDULUM PHYSICS ── swing only when NOT dropping/retracting ── */
      if (!pend.dropping && !pend.retracting) {
        const angAccel = -G_ACCEL * Math.sin(pend.angle);
        pend.angVel += angAccel * dt;
        pend.angVel *= Math.pow(DAMPING, dt);
        pend.angle += pend.angVel * dt;
      }
      // When dropping/retracting, use the frozen angle (hook goes straight down)
      const activeAngle = (pend.dropping || pend.retracting) ? pend.frozenAngle : pend.angle;

      /* ── HOOK EXTENSION ── */
      if (pend.dropping && !pend.retracting) {
        pend.extSpeed += 0.18 * dt;
        pend.extension += pend.extSpeed * dt;
        pend.clawTarget = 0.35; // partially close while descending
        // Dynamic limit: compute max extension so hook Y reaches conveyor level at the frozen angle
        // hookY = pivotY + cos(angle) * (ropeRestLen + extension) = targetDropY
        // => extension = targetDropY / cos(angle) - ropeRestLen  (clamped so cos != 0)
        const cosA = Math.max(0.3, Math.cos(activeAngle)); // clamp to avoid extreme extension at wide angles
        const dynamicMax = Math.max(30, (targetDropY - pivotY) / cosA - ropeRestLen);
        const currentHookY = pivotY + cosA * (ropeRestLen + pend.extension);
        if (pend.extension >= dynamicMax || currentHookY >= targetDropY) {
          pend.extension = Math.min(pend.extension, dynamicMax);
          pend.extSpeed = 0;
          // At bottom — check catch
          const hookEndX = pivotX + Math.sin(activeAngle) * (ropeRestLen + pend.extension);
          const hookEndY = pivotY + Math.cos(activeAngle) * (ropeRestLen + pend.extension);
          let caught = false;
          // Find the closest gift using box hitbox (AABB)
          let bestDist = 999;
          let bestItem: ConveyorItem | null = null;
          for (const item of conveyorRef.current) {
            if (item.grabbed) continue;
            const halfW = item.size * 0.30;  // very tight horizontal hitbox
            const giftTopY = conveyorY - item.size * 0.5 + 8;
            const giftBottomY = giftTopY + item.size;
            const inX = Math.abs(hookEndX - item.x) < halfW;
            const inY = hookEndY >= giftTopY - 4 && hookEndY <= giftBottomY + 4;
            if (inX && inY) {
              const dx = hookEndX - item.x;
              const dist = Math.abs(dx);
              if (dist < bestDist) {
                bestDist = dist;
                bestItem = item;
              }
            }
          }
          if (bestItem) {
            const item = bestItem;
            item.grabbed = true;
            caughtRef.current = { prize: item.prize, hue: item.hue, size: item.size };
            pend.clawTarget = 0; // fully close
            addParticles(hookEndX, hookEndY, 18, `hsl(${item.hue}, 60%, 60%)`);
            addParticles(hookEndX, hookEndY, 10, GOLD_BRIGHT);
            shakeRef.current.amount = 6;
            try { getSoundEngine().impact(); } catch {}
            caught = true;
          }
          if (!caught) {
            pend.clawTarget = 0;
            try { getSoundEngine().miss(); } catch {}
          }
          // Remove grabbed items from conveyor
          conveyorRef.current = conveyorRef.current.filter(it => !it.grabbed);
          // Begin retracting after small delay
          pend.retracting = false;
          setTimeout(() => { pend.retracting = true; pend.extSpeed = 0; }, 350);
        }
      } else if (pend.retracting) {
        pend.extSpeed += 0.1 * dt;
        pend.extension -= pend.extSpeed * dt;
        if (pend.extension <= 0) {
          pend.extension = 0;
          if (caughtRef.current) {
            doneRef.current = true;
            setWonPrize(caughtRef.current.prize);
            try { getSoundEngine().victory(); } catch {}
            setTimeout(() => setPhase('victory'), 500);
            return;
          } else {
            // Missed — track attempts
            attemptsRef.current++;
            setAttempts(attemptsRef.current);
            if (attemptsRef.current >= MAX_ATTEMPTS) {
              // All attempts used — consolation prize
              doneRef.current = true;
              const consolation = getConsolationPrize(prizes);
              setWonPrize(consolation);
              setGameOver(true);
              try { getSoundEngine().miss(); } catch {}
              setTimeout(() => setPhase('victory'), 800);
              return;
            }
            // Reset pendulum for next attempt
            pend.dropping = false;
            pend.retracting = false;
            pend.extension = 0;
            pend.extSpeed = 0;
            pend.clawOpen = 1;
            pend.clawTarget = 1;
            pend.angle = (pend.frozenAngle >= 0) ? 0.75 : -0.75;
            pend.angVel = 0;
            caughtRef.current = null;
          }
        }
      }

      // Animate claw open/close smoothly
      pend.clawOpen += (pend.clawTarget - pend.clawOpen) * 0.12 * dt;

      /* ── POSITIONS ── */
      const totalLen = ropeRestLen + pend.extension;
      const hookEndX = pivotX + Math.sin(activeAngle) * totalLen;
      const hookEndY = pivotY + Math.cos(activeAngle) * totalLen;

      /* ═══ RENDER ═══ */

      // Support beam — industrial I-beam
      const beamY = pivotY - 12;
      const beamH = 20;
      const beamGrad = ctx.createLinearGradient(0, beamY, 0, beamY + beamH);
      beamGrad.addColorStop(0, '#5a4a60');
      beamGrad.addColorStop(0.3, '#7a6a80');
      beamGrad.addColorStop(0.7, '#6a5a70');
      beamGrad.addColorStop(1, '#3a2a40');
      ctx.fillStyle = beamGrad;
      ctx.fillRect(w * 0.08, beamY, w * 0.84, beamH);
      // Top/bottom flanges
      ctx.fillStyle = '#8a7a90';
      ctx.fillRect(w * 0.08, beamY, w * 0.84, 3);
      ctx.fillRect(w * 0.08, beamY + beamH - 3, w * 0.84, 3);
      // Rivets
      for (let rx = w * 0.12; rx < w * 0.9; rx += 28) {
        const rivGrad = ctx.createRadialGradient(rx - 0.5, beamY + beamH / 2 - 0.5, 0, rx, beamY + beamH / 2, 3.5);
        rivGrad.addColorStop(0, '#b0a0b8');
        rivGrad.addColorStop(1, '#5a4a60');
        ctx.fillStyle = rivGrad;
        ctx.beginPath(); ctx.arc(rx, beamY + beamH / 2, 3.5, 0, Math.PI * 2); ctx.fill();
      }

      // Pivot mount
      const pivGrad = ctx.createRadialGradient(pivotX - 1, pivotY - 1, 0, pivotX, pivotY, 7);
      pivGrad.addColorStop(0, '#c0b0c8');
      pivGrad.addColorStop(0.5, '#8a7a90');
      pivGrad.addColorStop(1, '#4a3a50');
      ctx.fillStyle = pivGrad;
      ctx.beginPath(); ctx.arc(pivotX, pivotY, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      /* ── ROPE (chain with extension) ── */
      const chainSegs = 14 + Math.floor(pend.extension / 15);
      ctx.lineWidth = 2;
      for (let s = 0; s < chainSegs; s++) {
        const t1 = s / chainSegs;
        const t2 = (s + 1) / chainSegs;
        const x1 = pivotX + (hookEndX - pivotX) * t1;
        const y1 = pivotY + (hookEndY - pivotY) * t1;
        const x2 = pivotX + (hookEndX - pivotX) * t2;
        const y2 = pivotY + (hookEndY - pivotY) * t2;
        // Slight sag in each segment
        const sagAmount = Math.sin(t1 * Math.PI) * (2 + pend.extension * 0.005);
        const sway = Math.sin(timeRef.current * 0.04 + s * 0.7) * 0.6;
        const perpX = -(y2 - y1); // perpendicular direction
        const perpLen = Math.sqrt(perpX * perpX + (x2 - x1) * (x2 - x1)) || 1;
        const offX = (perpX / perpLen) * (sagAmount + sway) * 0.15;

        // Alternate chain link colors for depth
        ctx.strokeStyle = s % 2 === 0 ? '#9a8aa0' : '#6a5a70';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo((x1 + x2) / 2 + offX, (y1 + y2) / 2 + sagAmount + sway, x2, y2);
        ctx.stroke();

        // Chain link circle at joints
        if (s % 3 === 0) {
          ctx.fillStyle = '#b0a0b8';
          ctx.beginPath(); ctx.arc(x1, y1, 2, 0, Math.PI * 2); ctx.fill();
        }
      }

      /* ── CLAW/HOOK ── */
      const hx = hookEndX;
      const hy = hookEndY;
      const open = pend.clawOpen;
      const armLen = 18;

      // Hook motor housing
      ctx.save();
      ctx.translate(hx, hy);
      // Rotate housing to match rope angle
      const ropeAngle = Math.atan2(hookEndX - pivotX, hookEndY - pivotY);
      ctx.rotate(ropeAngle * 0.1); // subtle tilt

      // Housing body
      const housingGrad = ctx.createLinearGradient(-10, -6, 10, 10);
      housingGrad.addColorStop(0, '#8a7a90');
      housingGrad.addColorStop(0.5, '#b0a0b8');
      housingGrad.addColorStop(1, '#5a4a60');
      ctx.fillStyle = housingGrad;
      ctx.beginPath(); ctx.roundRect(-10, -5, 20, 13, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      // Housing detail lines
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.moveTo(-8, -1); ctx.lineTo(8, -1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8, 3); ctx.lineTo(8, 3); ctx.stroke();
      // Bolts
      ctx.fillStyle = '#ccc';
      ctx.beginPath(); ctx.arc(-6, 1, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(6, 1, 1.5, 0, Math.PI * 2); ctx.fill();

      ctx.restore();

      // 3 prong claw arms
      const drawClaw = (baseOffsetX: number, spreadDir: number) => {
        const baseX = hx + baseOffsetX;
        const baseY = hy + 8;
        const spread = open * 14 * spreadDir;
        const elbowX = baseX + spread * 0.3;
        const elbowY = baseY + armLen * 0.45;
        const tipX = baseX + spread;
        const tipY = baseY + armLen;
        // Arm shadow
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(baseX + 1, baseY + 1);
        ctx.lineTo(elbowX + 1, elbowY + 1);
        ctx.lineTo(tipX + 1, tipY + 1);
        ctx.stroke();
        // Arm body
        const armGrad = ctx.createLinearGradient(baseX, baseY, tipX, tipY);
        armGrad.addColorStop(0, '#9a8aa0');
        armGrad.addColorStop(0.5, '#c0b0c8');
        armGrad.addColorStop(1, '#7a6a80');
        ctx.strokeStyle = armGrad;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.lineTo(elbowX, elbowY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
        // Tip hook curl
        const curlX = tipX - spreadDir * 5;
        const curlY = tipY + 2;
        ctx.strokeStyle = '#8a7a90';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.quadraticCurveTo(tipX - spreadDir * 2, tipY + 5, curlX, curlY);
        ctx.stroke();
        // Joint circles
        ctx.fillStyle = '#b0a0b8';
        ctx.beginPath(); ctx.arc(elbowX, elbowY, 2, 0, Math.PI * 2); ctx.fill();
      };

      drawClaw(-5, -1); // left arm
      drawClaw(0, 0);   // center arm (goes straight down)
      drawClaw(5, 1);    // right arm

      // Caught gift — rendered as colored box held by closed claw
      const caught = caughtRef.current;
      if (caught) {
        const gs = caught.size * 0.65;
        const gx = hx;
        const gy = hy + armLen + 12;

        // Gift box body
        const giftGrad = ctx.createLinearGradient(gx - gs / 2, gy - gs / 2, gx + gs / 2, gy + gs / 2);
        giftGrad.addColorStop(0, `hsl(${caught.hue}, 60%, 55%)`);
        giftGrad.addColorStop(1, `hsl(${caught.hue}, 60%, 35%)`);
        ctx.fillStyle = giftGrad;
        ctx.beginPath(); ctx.roundRect(gx - gs / 2, gy - gs / 2, gs, gs, 4); ctx.fill();
        // Highlight
        ctx.fillStyle = `hsla(${caught.hue}, 50%, 75%, 0.15)`;
        ctx.fillRect(gx - gs / 2 + 2, gy - gs / 2 + 1, gs - 4, gs * 0.3);
        // Ribbon
        ctx.strokeStyle = `hsla(${(caught.hue + 40) % 360}, 60%, 80%, 0.5)`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(gx, gy - gs / 2); ctx.lineTo(gx, gy + gs / 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx - gs / 2, gy); ctx.lineTo(gx + gs / 2, gy); ctx.stroke();
        // Bow
        ctx.fillStyle = `hsl(${caught.hue}, 45%, 70%)`;
        ctx.beginPath(); ctx.ellipse(gx - 3, gy - gs / 2 - 2, 4, 2.5, -0.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(gx + 3, gy - gs / 2 - 2, 4, 2.5, 0.4, 0, Math.PI * 2); ctx.fill();
        // Emoji
        ctx.font = `${gs * 0.45}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(caught.prize.emoji, gx, gy + 1);
        // Glow
        ctx.shadowColor = `hsl(${caught.hue}, 60%, 50%)`;
        ctx.shadowBlur = 8;
        ctx.strokeStyle = `hsla(${caught.hue}, 60%, 60%, 0.3)`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(gx - gs / 2, gy - gs / 2, gs, gs, 4); ctx.stroke();
        ctx.shadowBlur = 0;
      }

      /* ── CONVEYOR ── */
      const beltTopY = conveyorY + 18;
      const beltH = 26;

      // Belt surface
      const beltGrad = ctx.createLinearGradient(0, beltTopY, 0, beltTopY + beltH);
      beltGrad.addColorStop(0, '#4a3a50');
      beltGrad.addColorStop(0.3, '#5a4a60');
      beltGrad.addColorStop(0.7, '#4a3a50');
      beltGrad.addColorStop(1, '#3a2a40');
      ctx.fillStyle = beltGrad;
      ctx.fillRect(0, beltTopY, w, beltH);
      // Belt depth shadow
      ctx.fillStyle = '#1a1020';
      ctx.fillRect(0, beltTopY + beltH, w, 6);

      // Belt treads (moving)
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      const treadOff = (timeRef.current * 0.7) % 16;
      for (let tx = -16 + treadOff; tx < w + 16; tx += 16) {
        ctx.beginPath();
        ctx.moveTo(tx, beltTopY + 1);
        ctx.lineTo(tx - 5, beltTopY + beltH - 1);
        ctx.stroke();
      }

      // Rollers at ends
      for (const rx of [16, w - 16]) {
        // Roller body
        const rollGrad = ctx.createRadialGradient(rx - 1, beltTopY + beltH / 2 - 1, 0, rx, beltTopY + beltH / 2, 11);
        rollGrad.addColorStop(0, '#8a7a90');
        rollGrad.addColorStop(0.7, '#5a4a60');
        rollGrad.addColorStop(1, '#3a2a40');
        ctx.fillStyle = rollGrad;
        ctx.beginPath(); ctx.arc(rx, beltTopY + beltH / 2, 11, 0, Math.PI * 2); ctx.fill();
        // Spinning spokes
        const spAngle = timeRef.current * 0.025;
        ctx.strokeStyle = '#6a5a70';
        ctx.lineWidth = 1.5;
        for (let sp = 0; sp < 4; sp++) {
          const a = spAngle + sp * Math.PI / 2;
          ctx.beginPath();
          ctx.moveTo(rx + Math.cos(a) * 3, beltTopY + beltH / 2 + Math.sin(a) * 3);
          ctx.lineTo(rx + Math.cos(a) * 9, beltTopY + beltH / 2 + Math.sin(a) * 9);
          ctx.stroke();
        }
        // Center hub
        ctx.fillStyle = '#9a8aa0';
        ctx.beginPath(); ctx.arc(rx, beltTopY + beltH / 2, 3, 0, Math.PI * 2); ctx.fill();
      }

      // Side guards
      ctx.fillStyle = '#3a2a40';
      ctx.fillRect(0, conveyorY - 5, 5, beltH + 28);
      ctx.fillRect(w - 5, conveyorY - 5, 5, beltH + 28);

      /* ── CONVEYOR ITEMS ── */
      const isDropping = pend.dropping || pend.retracting;
      for (const item of conveyorRef.current) {
        if (item.grabbed) continue; // skip grabbed items
        // Freeze gift movement while claw is dropping/retracting
        if (!isDropping) {
          // Random movement — gifts change direction unpredictably
          item.dirTimer -= dt;
          if (item.dirTimer <= 0) {
            item.vx = (Math.random() > 0.5 ? 1 : -1) * (2.5 + Math.random() * 3.5);
            item.dirTimer = 12 + Math.floor(Math.random() * 30);
          }
          item.x += item.vx * dt;
          // Bounce off edges
          if (item.x < item.size) { item.x = item.size; item.vx = Math.abs(item.vx); }
          if (item.x > w - item.size) { item.x = w - item.size; item.vx = -Math.abs(item.vx); }
        }

        const s = item.size;
        const bob = Math.sin(timeRef.current * 0.035 + item.bobPhase) * 2;
        const gx = item.x;
        const gy = conveyorY - s * 0.5 + 8 + bob;

        // Shadow on belt
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.beginPath(); ctx.ellipse(gx, beltTopY - 1, s * 0.35, 3, 0, 0, Math.PI * 2); ctx.fill();

        // Gift box
        const grad = ctx.createLinearGradient(gx - s / 2, gy, gx + s / 2, gy + s);
        grad.addColorStop(0, `hsl(${item.hue}, 58%, 56%)`);
        grad.addColorStop(1, `hsl(${item.hue}, 60%, 36%)`);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.roundRect(gx - s / 2, gy, s, s, 5); ctx.fill();

        // Lid highlight
        ctx.fillStyle = `hsla(${item.hue}, 50%, 72%, 0.15)`;
        ctx.fillRect(gx - s / 2 + 2, gy + 1, s - 4, s * 0.25);

        // Ribbon
        const rh = (item.hue + 40) % 360;
        ctx.strokeStyle = `hsla(${rh}, 65%, 78%, 0.5)`;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx - s / 2, gy + s / 2); ctx.lineTo(gx + s / 2, gy + s / 2); ctx.stroke();

        // Bow
        ctx.fillStyle = `hsl(${item.hue}, 45%, 68%)`;
        ctx.beginPath(); ctx.ellipse(gx - 4, gy - 2, 5, 3, -0.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(gx + 4, gy - 2, 5, 3, 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `hsl(${item.hue}, 50%, 58%)`;
        ctx.beginPath(); ctx.arc(gx, gy - 1, 2.5, 0, Math.PI * 2); ctx.fill();

        // Emoji
        ctx.font = `${s * 0.33}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.prize.emoji, gx, gy + s / 2 + 2);
      }

      /* ── DROP GUIDE ── */
      if (!pend.dropping) {
        ctx.setLineDash([3, 6]);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hookEndX, hookEndY + 30);
        ctx.lineTo(hookEndX, conveyorY);
        ctx.stroke();
        ctx.setLineDash([]);
        // Target dot
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.arc(hookEndX, conveyorY, 6, 0, Math.PI * 2); ctx.fill();
      }

      /* ── PARTICLES ── */
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.life += dt;
        if (p.life > p.maxLife) { particlesRef.current.splice(i, 1); continue; }
        p.vy += 0.04 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(0.98, dt);
        const alpha = 1 - p.life / p.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      /* ── HUD ── */
      // Attempts counter top-left
      const remaining = MAX_ATTEMPTS - attemptsRef.current;
      ctx.fillStyle = CREAM + '60';
      ctx.font = 'bold 13px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(`${'🪝'.repeat(remaining)}${'✖️'.repeat(attemptsRef.current)}`, 14, 24);

      if (!pend.dropping) {
        ctx.fillStyle = CREAM + '25';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('APPUYEZ pour lâcher le crochet', w / 2, h - 22);
      } else if (!pend.retracting && pend.extension > 0) {
        ctx.fillStyle = CREAM + '20';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Descente...', w / 2, h - 22);
      } else if (pend.retracting) {
        ctx.fillStyle = caughtRef.current ? GOLD + '50' : CREAM + '15';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(caughtRef.current ? '🎁 Attrapé !' : 'Raté...', w / 2, h - 22);
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, prizes, initConveyor, GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, TOBACCO, goldRgb, creamRgb, mahoganyRgb]);

  const handleTap = () => {
    if (phaseRef.current !== 'playing') return;
    const pend = pendRef.current;
    if (pend.dropping) return;
    pend.dropping = true;
    pend.frozenAngle = pend.angle; // lock angle — hook drops straight down from here
    pend.angVel = 0;
    pend.extension = 0;
    pend.extSpeed = 0;
    pend.clawTarget = 0.4;
    try { getSoundEngine().swoosh(); } catch {}
  };

  const start = () => { setWonPrize(null); setMissed(false); setAttempts(0); attemptsRef.current = 0; setGameOver(false); caughtRef.current = null; setPhase('playing'); };

  return (
    <div className="game-container noise-overlay flex flex-col items-center justify-center" style={{ background: BG_DARK }}>
      {phase === 'playing' && (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ touchAction: 'none' }}
          onTouchStart={handleTap} onMouseDown={handleTap} />
      )}
      {phase === 'ready' && (
        <div className="flex flex-col items-center gap-6 z-20 px-8">
          <div className="text-6xl" style={{ animation: 'victoryFloat 2s ease-in-out infinite' }}>🪝</div>
          <h1 className="text-[32px] font-extrabold tracking-tight text-center" style={{
            background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Pendulum</h1>
          <p className="text-[14px] text-center max-w-[260px] leading-relaxed" style={{ color: CREAM + '60' }}>
            Le pendule oscille. Tapez au bon moment<br/>pour attraper un cadeau sur le tapis !
            <br/><span style={{ color: CREAM + '35' }} className="text-[11px]">{MAX_ATTEMPTS} tentatives pour gagner un cadeau premium</span>
          </p>
          {gameOver && (
            <p className="text-sm font-bold" style={{ color: '#ef4444', animation: 'fadeIn 0.3s ease-out both' }}>
              Perdu ! Réessayez 💪
            </p>
          )}
          <button onClick={start} className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-lg tracking-wide transition-all active:scale-[0.96]" style={{
            background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`, boxShadow: `0 12px 40px -10px ${GOLD}80`,
          }}>{gameOver ? 'Réessayer 🪝' : 'Commencer'}</button>
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
      {missed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-30" style={{ background: 'rgba(10,8,18,0.85)' }}>
          <div className="text-6xl mb-4" style={{ animation: 'victoryFloat 1.5s ease-in-out infinite' }}>😔</div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: CREAM + 'cc' }}>Raté !</h2>
          <p className="text-sm mt-2" style={{ color: CREAM + '60' }}>Le crochet n&apos;a rien attrapé.<br/>Réessayez !</p>
        </div>
      )}
    </div>
  );
}
