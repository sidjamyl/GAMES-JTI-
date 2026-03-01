'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectPremiumPrize, getConsolationPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';
import { getDisplaySlots, distributeProportionally, shuffle } from '../lib/gameConfig';

/* ═══════════════════════════════════════════════
   GYRO MAZE — Themeable
   Random maze generation each game.
   3 exits with different prizes.
   No rigging — pure skill.
   ═══════════════════════════════════════════════ */

const BALL_RADIUS = 8;
const GOAL_RADIUS = 12;
const WALL_THICKNESS = 3;
const FRICTION = 0.96;
const ACCEL = 0.42;
const MAX_SPEED = 2.8;
const RESTITUTION = 0.25;
const PHYSICS_SUBSTEPS = 3;
const TIME_LIMIT = 35; // seconds before consolation prize
const MAX_ATTEMPTS = 3;
const HOLE_RADIUS = 6;

const MAZE_COLS = 12;
const MAZE_ROWS = 12;

interface WallSeg { x1: number; y1: number; x2: number; y2: number; }
interface GoalDef { x: number; y: number; prize: Prize; color: string; }
interface BallState { x: number; y: number; vx: number; vy: number; }
interface HoleDef { x: number; y: number; }

/* ── Maze generation using recursive backtracking ── */
function generateMaze(cols: number, rows: number): boolean[][][] {
  // walls[r][c] = [top, right, bottom, left]
  const walls: boolean[][][] = [];
  const visited: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    walls[r] = [];
    visited[r] = [];
    for (let c = 0; c < cols; c++) {
      walls[r][c] = [true, true, true, true];
      visited[r][c] = false;
    }
  }

  const dirs: [number, number, number, number][] = [
    [-1, 0, 0, 2], // up: remove top of current, bottom of neighbor
    [0, 1, 1, 3],  // right
    [1, 0, 2, 0],  // down
    [0, -1, 3, 1], // left
  ];

  const stack: [number, number][] = [];
  const sr = Math.floor(rows / 2);
  const sc = Math.floor(cols / 2);
  visited[sr][sc] = true;
  stack.push([sr, sc]);

  while (stack.length > 0) {
    const [cr, cc] = stack[stack.length - 1];
    const neighbors: number[] = [];
    for (let d = 0; d < 4; d++) {
      const nr = cr + dirs[d][0];
      const nc = cc + dirs[d][1];
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc]) {
        neighbors.push(d);
      }
    }
    if (neighbors.length === 0) {
      stack.pop();
    } else {
      const d = neighbors[Math.floor(Math.random() * neighbors.length)];
      const nr = cr + dirs[d][0];
      const nc = cc + dirs[d][1];
      walls[cr][cc][dirs[d][2]] = false;
      walls[nr][nc][dirs[d][3]] = false;
      visited[nr][nc] = true;
      stack.push([nr, nc]);
    }
  }

  // Remove very few extra walls — keep maze tight and challenging
  const extraRemovals = Math.floor(cols * rows * 0.01);
  for (let i = 0; i < extraRemovals; i++) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    const d = Math.floor(Math.random() * 4);
    const nr = r + dirs[d][0];
    const nc = c + dirs[d][1];
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
      walls[r][c][dirs[d][2]] = false;
      walls[nr][nc][dirs[d][3]] = false;
    }
  }

  return walls;
}

function mazeToSegments(maze: boolean[][][], cols: number, rows: number): WallSeg[] {
  const segs: WallSeg[] = [];
  const cw = 1 / cols;
  const ch = 1 / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw;
      const y = r * ch;
      if (maze[r][c][0] && r > 0) {
        segs.push({ x1: x, y1: y, x2: x + cw, y2: y });
      }
      if (maze[r][c][1] && c < cols - 1) {
        segs.push({ x1: x + cw, y1: y, x2: x + cw, y2: y + ch });
      }
    }
  }

  // Deduplicate close segments
  const unique: WallSeg[] = [];
  for (const s of segs) {
    const dup = unique.find(u =>
      Math.abs(u.x1 - s.x1) < 0.001 && Math.abs(u.y1 - s.y1) < 0.001 &&
      Math.abs(u.x2 - s.x2) < 0.001 && Math.abs(u.y2 - s.y2) < 0.001
    );
    if (!dup) unique.push(s);
  }

  return unique;
}

/* ── Pick exit cells and create outer walls with gaps ── */
interface ExitDef { side: number; cellIndex: number; nx: number; ny: number; }

function pickExits(cols: number, rows: number, count: number): ExitDef[] {
  const exits: ExitDef[] = [];
  const midCol = Math.floor(cols / 2);
  const midRow = Math.floor(rows / 2);
  // Top exit (center)
  exits.push({ side: 0, cellIndex: midCol, nx: (midCol + 0.5) / cols, ny: -0.02 });
  // Right exit (middle)
  exits.push({ side: 1, cellIndex: midRow, nx: 1.02, ny: (midRow + 0.5) / rows });
  // Bottom exit (center)
  exits.push({ side: 2, cellIndex: midCol, nx: (midCol + 0.5) / cols, ny: 1.02 });
  // Left exit (middle) — 4th exit
  if (count >= 4) {
    exits.push({ side: 3, cellIndex: midRow, nx: -0.02, ny: (midRow + 0.5) / rows });
  }
  return exits.slice(0, count);
}

function outerWalls(cols: number, rows: number, exits: ExitDef[]): WallSeg[] {
  const segs: WallSeg[] = [];
  const cw = 1 / cols;
  const ch = 1 / rows;

  // Top edge
  for (let c = 0; c < cols; c++) {
    if (exits.some(e => e.side === 0 && e.cellIndex === c)) continue;
    segs.push({ x1: c * cw, y1: 0, x2: (c + 1) * cw, y2: 0 });
  }
  // Bottom edge
  for (let c = 0; c < cols; c++) {
    if (exits.some(e => e.side === 2 && e.cellIndex === c)) continue;
    segs.push({ x1: c * cw, y1: 1, x2: (c + 1) * cw, y2: 1 });
  }
  // Left edge
  for (let r = 0; r < rows; r++) {
    if (exits.some(e => e.side === 3 && e.cellIndex === r)) continue;
    segs.push({ x1: 0, y1: r * ch, x2: 0, y2: (r + 1) * ch });
  }
  // Right edge
  for (let r = 0; r < rows; r++) {
    if (exits.some(e => e.side === 1 && e.cellIndex === r)) continue;
    segs.push({ x1: 1, y1: r * ch, x2: 1, y2: (r + 1) * ch });
  }

  return segs;
}

export default function GyroMaze({ theme }: { theme?: GameTheme }) {
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, TOBACCO, BG_DARK, BG_MID, BG_LIGHT } = { ...DEFAULT_THEME, ...theme };
  const creamRgb = hexToRgb(CREAM);
  const tobaccoRgb = hexToRgb(TOBACCO);
  const GOAL_COLORS = [GOLD, '#ef4444', '#3b82f6', '#22c55e'];

  const [phase, setPhase] = useState<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [hasGyro, setHasGyro] = useState<boolean | null>(null);
  const [gameOver, setGameOver] = useState(false);
  const [gyroPermission, setGyroPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ballRef = useRef<BallState>({ x: 0, y: 0, vx: 0, vy: 0 });
  const tiltRef = useRef({ x: 0, y: 0 });
  const animRef = useRef(0);
  const phaseRef = useRef<GamePhase>('loading');
  const dprRef = useRef(1);
  const sizeRef = useRef({ w: 0, h: 0, mazeX: 0, mazeY: 0, mazeSize: 0 });
  const startTimeRef = useRef(0);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchActiveRef = useRef(false);
  const touchPosRef = useRef({ x: 0, y: 0 });
  const calibrationRef = useRef({ beta: 0, gamma: 0, calibrated: false });

  const wallsRef = useRef<WallSeg[]>([]);
  const goalsRef = useRef<GoalDef[]>([]);
  const holesRef = useRef<HoleDef[]>([]);
  const attemptsRef = useRef(0);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); }); }, []);
  useEffect(() => { setHasGyro('DeviceOrientationEvent' in window); }, []);

  const requestGyroPermission = useCallback(async () => {
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE.requestPermission === 'function') {
      try {
        const perm = await DOE.requestPermission();
        setGyroPermission(perm === 'granted' ? 'granted' : 'denied');
        return perm === 'granted';
      } catch { setGyroPermission('denied'); return false; }
    }
    setGyroPermission('granted');
    return true;
  }, []);

  const setupCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const w = c.offsetWidth * dpr;
    const h = c.offsetHeight * dpr;
    c.width = w; c.height = h;
    const padding = 20 * dpr;
    // In landscape (tablet), use height as limiting dimension with more space
    const isLandscape = w > h;
    const mazeSize = isLandscape
      ? Math.min(h - padding * 2, w * 0.55)
      : Math.min(w - padding * 2, h * 0.60);
    const mazeX = (w - mazeSize) / 2;
    const mazeY = isLandscape ? (h - mazeSize) / 2 : h * 0.2;
    sizeRef.current = { w, h, mazeX, mazeY, mazeSize };
  }, []);

  const toCanvas = useCallback((nx: number, ny: number) => {
    const { mazeX, mazeY, mazeSize } = sizeRef.current;
    return { x: mazeX + nx * mazeSize, y: mazeY + ny * mazeSize };
  }, []);

  const lineCircleCollide = useCallback((
    x1: number, y1: number, x2: number, y2: number,
    cx: number, cy: number, r: number
  ) => {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return { hit: false, nx: 0, ny: 0, pen: 0 };
    const ux = dx / len, uy = dy / len;
    const fx = cx - x1, fy = cy - y1;
    let t = fx * ux + fy * uy;
    t = Math.max(0, Math.min(len, t));
    const closestX = x1 + ux * t, closestY = y1 + uy * t;
    const distX = cx - closestX, distY = cy - closestY;
    const dist = Math.sqrt(distX * distX + distY * distY);
    const wallR = WALL_THICKNESS * dprRef.current * 0.5;
    if (dist < r + wallR) {
      const pen = r + wallR - dist;
      const nx = dist > 0 ? distX / dist : 0;
      const ny = dist > 0 ? distY / dist : 1;
      return { hit: true, nx, ny, pen };
    }
    return { hit: false, nx: 0, ny: 0, pen: 0 };
  }, []);

  const generateNewMaze = useCallback(() => {
    const maze = generateMaze(MAZE_COLS, MAZE_ROWS);
    const goalCount = getDisplaySlots('gyro-maze');
    const exits = pickExits(MAZE_COLS, MAZE_ROWS, goalCount);
    const internal = mazeToSegments(maze, MAZE_COLS, MAZE_ROWS);
    const outer = outerWalls(MAZE_COLS, MAZE_ROWS, exits);

    // Also remove internal walls that block exit cells
    const cw = 1 / MAZE_COLS;
    const ch = 1 / MAZE_ROWS;
    const filtered = internal.filter(seg => {
      for (const exit of exits) {
        if (exit.side === 0) {
          const cx = (exit.cellIndex + 0.5) * cw;
          if (Math.abs(seg.y1) < 0.001 && Math.abs(seg.y2) < 0.001) {
            if (seg.x1 >= exit.cellIndex * cw - 0.001 && seg.x2 <= (exit.cellIndex + 1) * cw + 0.001) return false;
          }
        }
        if (exit.side === 1) {
          const cy = (exit.cellIndex + 0.5) * ch;
          if (Math.abs(seg.x1 - 1) < 0.01 && Math.abs(seg.x2 - 1) < 0.01) {
            if (seg.y1 >= exit.cellIndex * ch - 0.001 && seg.y2 <= (exit.cellIndex + 1) * ch + 0.001) return false;
          }
        }
        if (exit.side === 2) {
          const cx = (exit.cellIndex + 0.5) * cw;
          if (Math.abs(seg.y1 - 1) < 0.01 && Math.abs(seg.y2 - 1) < 0.01) {
            if (seg.x1 >= exit.cellIndex * cw - 0.001 && seg.x2 <= (exit.cellIndex + 1) * cw + 0.001) return false;
          }
        }
      }
      return true;
    });

    wallsRef.current = [...filtered, ...outer];

    // Create goals at exits — proportional prize distribution
    const distributed = shuffle(distributeProportionally(prizes, exits.length));
    const goals: GoalDef[] = exits.map((exit, i) => ({
      x: exit.nx,
      y: exit.ny,
      prize: distributed[i] ?? prizes[0],
      color: GOAL_COLORS[i % GOAL_COLORS.length],
    }));
    goalsRef.current = goals;

    // Generate trap holes in random cells
    const holes: HoleDef[] = [];
    const centerR = Math.floor(MAZE_ROWS / 2);
    const centerC = Math.floor(MAZE_COLS / 2);
    const exitCells = new Set<string>();
    for (const exit of exits) {
      if (exit.side === 0) exitCells.add(`0,${exit.cellIndex}`);
      if (exit.side === 1) exitCells.add(`${exit.cellIndex},${MAZE_COLS - 1}`);
      if (exit.side === 2) exitCells.add(`${MAZE_ROWS - 1},${exit.cellIndex}`);
      if (exit.side === 3) exitCells.add(`${exit.cellIndex},0`);
    }
    const holeCount = 12 + Math.floor(Math.random() * 6);
    for (let i = 0; i < holeCount; i++) {
      let r: number, c: number, tries = 0;
      do {
        r = Math.floor(Math.random() * MAZE_ROWS);
        c = Math.floor(Math.random() * MAZE_COLS);
        tries++;
      } while (tries < 50 && (
        (r === centerR && c === centerC) ||
        exitCells.has(`${r},${c}`) ||
        Math.abs(r - centerR) + Math.abs(c - centerC) <= 1 ||
        holes.some(h => Math.abs(h.x - (c + 0.5) / MAZE_COLS) < 0.01 && Math.abs(h.y - (r + 0.5) / MAZE_ROWS) < 0.01)
      ));
      if (tries < 50) {
        holes.push({ x: (c + 0.5) / MAZE_COLS, y: (r + 0.5) / MAZE_ROWS });
      }
    }

    // Guardian holes near each exit — every exit path must go through obstacles
    for (const exit of exits) {
      let nearCells: [number, number][] = [];
      if (exit.side === 0) { // top exit
        const c = exit.cellIndex;
        nearCells = [[1, c - 1], [1, c + 1], [2, c], [3, c - 1], [3, c + 1]];
      } else if (exit.side === 1) { // right exit
        const r = exit.cellIndex;
        nearCells = [[r - 1, MAZE_COLS - 2], [r + 1, MAZE_COLS - 2], [r, MAZE_COLS - 3], [r - 1, MAZE_COLS - 4], [r + 1, MAZE_COLS - 4]];
      } else if (exit.side === 2) { // bottom exit
        const c = exit.cellIndex;
        nearCells = [[MAZE_ROWS - 2, c - 1], [MAZE_ROWS - 2, c + 1], [MAZE_ROWS - 3, c], [MAZE_ROWS - 4, c - 1], [MAZE_ROWS - 4, c + 1]];
      } else if (exit.side === 3) { // left exit
        const r = exit.cellIndex;
        nearCells = [[r - 1, 1], [r + 1, 1], [r, 2], [r - 1, 3], [r + 1, 3]];
      }
      for (const [gr, gc] of nearCells) {
        if (gr >= 0 && gr < MAZE_ROWS && gc >= 0 && gc < MAZE_COLS &&
            !(gr === centerR && gc === centerC) &&
            !exitCells.has(`${gr},${gc}`) &&
            Math.abs(gr - centerR) + Math.abs(gc - centerC) > 2 &&
            !holes.some(h => Math.abs(h.x - (gc + 0.5) / MAZE_COLS) < 0.01 && Math.abs(h.y - (gr + 0.5) / MAZE_ROWS) < 0.01)) {
          holes.push({ x: (gc + 0.5) / MAZE_COLS, y: (gr + 0.5) / MAZE_ROWS });
        }
      }
    }

    holesRef.current = holes;
  }, [prizes]);

  const resetBall = useCallback(() => {
    const { mazeX, mazeY, mazeSize } = sizeRef.current;
    ballRef.current = {
      x: mazeX + 0.5 * mazeSize,
      y: mazeY + 0.5 * mazeSize,
      vx: 0, vy: 0,
    };
  }, []);

  const startGame = useCallback(async () => {
    if (hasGyro && gyroPermission === 'prompt') {
      await requestGyroPermission();
    }
    calibrationRef.current = { beta: 0, gamma: 0, calibrated: false };
    setupCanvas();
    generateNewMaze();
    resetBall();
    setElapsed(0);
    setWonPrize(null);
    setGameOver(false);
    attemptsRef.current = 0;
    setAttempts(0);
    tiltRef.current = { x: 0, y: 0 };
    startTimeRef.current = Date.now();
    setPhase('playing');
    elapsedIntervalRef.current = setInterval(() => {
      if (phaseRef.current === 'playing') {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);
  }, [hasGyro, gyroPermission, requestGyroPermission, setupCanvas, resetBall, generateNewMaze]);

  // Gyroscope — landscape-aware axis mapping
  useEffect(() => {
    if (phase !== 'playing') return;
    const handle = (e: DeviceOrientationEvent) => {
      const beta = e.beta || 0;
      const gamma = e.gamma || 0;
      if (!calibrationRef.current.calibrated) {
        calibrationRef.current = { beta, gamma, calibrated: true };
      }
      const cal = calibrationRef.current;
      const rawGamma = (gamma - cal.gamma) / 20;
      const rawBeta = (beta - cal.beta) / 20;
      // gamma = left-right tilt → X, beta = forward-back tilt → Y
      const dx = Math.max(-1, Math.min(1, rawGamma));
      const dy = Math.max(-1, Math.min(1, rawBeta));
      tiltRef.current = { x: dx, y: dy };
    };
    window.addEventListener('deviceorientation', handle);
    return () => window.removeEventListener('deviceorientation', handle);
  }, [phase]);

  // Touch controls
  const onPointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (phase !== 'playing') return;
    touchActiveRef.current = true;
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = dprRef.current;
    const cx = ('touches' in e ? e.touches[0].clientX : e.clientX);
    const cy = ('touches' in e ? e.touches[0].clientY : e.clientY);
    touchPosRef.current = { x: (cx - rect.left) * dpr, y: (cy - rect.top) * dpr };
    updateTiltFromTouch();
  }, [phase]);

  const onPointerMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!touchActiveRef.current || phase !== 'playing') return;
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = dprRef.current;
    const cx = ('touches' in e ? e.touches[0].clientX : e.clientX);
    const cy = ('touches' in e ? e.touches[0].clientY : e.clientY);
    touchPosRef.current = { x: (cx - rect.left) * dpr, y: (cy - rect.top) * dpr };
    updateTiltFromTouch();
  }, [phase]);

  const onPointerUp = useCallback(() => {
    touchActiveRef.current = false;
    tiltRef.current = { x: 0, y: 0 };
  }, []);

  const updateTiltFromTouch = useCallback(() => {
    const ball = ballRef.current;
    const touch = touchPosRef.current;
    const dx = touch.x - ball.x;
    const dy = touch.y - ball.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 5) { tiltRef.current = { x: 0, y: 0 }; return; }
    const maxDist = 150 * dprRef.current;
    const strength = Math.min(1, dist / maxDist);
    tiltRef.current = { x: (dx / dist) * strength, y: (dy / dist) * strength };
  }, []);

  // Game loop
  useEffect(() => {
    if (phase !== 'playing') return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const loop = () => {
      if (phaseRef.current !== 'playing') return;
      const { w: W, h: H, mazeX, mazeY, mazeSize } = sizeRef.current;
      const dpr = dprRef.current;
      const ball = ballRef.current;
      const time = Date.now() * 0.003;

      ctx.clearRect(0, 0, W, H);

      /* ── Background ── */
      const bg = ctx.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, H);
      bg.addColorStop(0, BG_LIGHT);
      bg.addColorStop(0.5, BG_MID);
      bg.addColorStop(1, BG_DARK);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      /* ── Maze board frame ── */
      const bp = 10 * dpr;
      ctx.strokeStyle = GOLD + '20';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.roundRect(mazeX - bp, mazeY - bp, mazeSize + bp * 2, mazeSize + bp * 2, 14 * dpr);
      ctx.stroke();
      ctx.fillStyle = `rgba(${tobaccoRgb},0.6)`;
      ctx.fill();

      // Inner dark area
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(mazeX, mazeY, mazeSize, mazeSize);

      /* ── Goal zones ── */
      for (let i = 0; i < goalsRef.current.length; i++) {
        const goal = goalsRef.current[i];
        const gp = toCanvas(goal.x, goal.y);
        const gr = GOAL_RADIUS * dpr;
        const pulse = 0.5 + Math.sin(time + i * 1.5) * 0.3;

        ctx.save();
        ctx.shadowBlur = 20 * dpr * pulse;
        ctx.shadowColor = goal.color;
        ctx.fillStyle = goal.color + '18';
        ctx.beginPath(); ctx.arc(gp.x, gp.y, gr * 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        const gg = ctx.createRadialGradient(gp.x, gp.y, 0, gp.x, gp.y, gr);
        gg.addColorStop(0, goal.color + '50');
        gg.addColorStop(1, goal.color + '10');
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(gp.x, gp.y, gr, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = goal.color;
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();

        // Prize emoji
        ctx.font = `${gr * 1.1}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(goal.prize.emoji, gp.x, gp.y);
      }

      /* ── Maze walls ── */
      ctx.lineCap = 'round';
      for (const wall of wallsRef.current) {
        const p1 = toCanvas(wall.x1, wall.y1);
        const p2 = toCanvas(wall.x2, wall.y2);
        ctx.save();
        ctx.shadowBlur = 4 * dpr;
        ctx.shadowColor = GOLD + '15';
        ctx.strokeStyle = GOLD + '45';
        ctx.lineWidth = WALL_THICKNESS * dpr;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        ctx.restore();
      }

      /* ── Trap holes ── */
      for (const hole of holesRef.current) {
        const hp = toCanvas(hole.x, hole.y);
        const hr = HOLE_RADIUS * dpr;
        const holeGrad = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, hr);
        holeGrad.addColorStop(0, 'rgba(0,0,0,0.9)');
        holeGrad.addColorStop(0.7, 'rgba(0,0,0,0.6)');
        holeGrad.addColorStop(1, 'rgba(180,40,40,0.3)');
        ctx.fillStyle = holeGrad;
        ctx.beginPath(); ctx.arc(hp.x, hp.y, hr, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ef444460';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.arc(hp.x, hp.y, hr, 0, Math.PI * 2); ctx.stroke();
      }

      /* ── Physics (NO auto-assist) ── */
      if (touchActiveRef.current) updateTiltFromTouch();

      const tilt = tiltRef.current;
      const br = BALL_RADIUS * dpr;

      // Apply tilt acceleration and friction once per frame
      ball.vx += tilt.x * ACCEL * dpr;
      ball.vy += tilt.y * ACCEL * dpr;
      ball.vx *= FRICTION;
      ball.vy *= FRICTION;

      const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
      if (speed > MAX_SPEED * dpr) {
        const s = (MAX_SPEED * dpr) / speed;
        ball.vx *= s; ball.vy *= s;
      }

      // Substep movement + collision for stable physics
      let hitWall = false;
      for (let step = 0; step < PHYSICS_SUBSTEPS; step++) {
        ball.x += ball.vx / PHYSICS_SUBSTEPS;
        ball.y += ball.vy / PHYSICS_SUBSTEPS;

        for (const wall of wallsRef.current) {
          const p1 = toCanvas(wall.x1, wall.y1);
          const p2 = toCanvas(wall.x2, wall.y2);
          const col = lineCircleCollide(p1.x, p1.y, p2.x, p2.y, ball.x, ball.y, br);
          if (col.hit) {
            // Push ball out of wall
            ball.x += col.nx * col.pen;
            ball.y += col.ny * col.pen;
            // Only reflect if moving INTO the wall
            const dot = ball.vx * col.nx + ball.vy * col.ny;
            if (dot < 0) {
              ball.vx -= (1 + RESTITUTION) * dot * col.nx;
              ball.vy -= (1 + RESTITUTION) * dot * col.ny;
            }
            hitWall = true;
          }
        }
      }
      if (hitWall) getSoundEngine().peg(Math.floor(Math.random() * 5));

      // Hole collision — trap!
      for (const hole of holesRef.current) {
        const hp = toCanvas(hole.x, hole.y);
        const hr = HOLE_RADIUS * dpr;
        const hx = ball.x - hp.x, hy = ball.y - hp.y;
        if (Math.sqrt(hx * hx + hy * hy) < hr * 0.7) {
          try { getSoundEngine().miss(); } catch {}
          attemptsRef.current++;
          setAttempts(attemptsRef.current);
          if (attemptsRef.current >= MAX_ATTEMPTS) {
            const consolation = getConsolationPrize(prizes);
            setWonPrize(consolation);
            setGameOver(true);
            setPhase('victory');
            if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
            return;
          }
          resetBall();
          animRef.current = requestAnimationFrame(loop);
          return;
        }
      }

      // Time limit check
      const elapsedSec = Math.floor((Date.now() - startTimeRef.current) / 1000);
      if (elapsedSec >= TIME_LIMIT) {
        const consolation = getConsolationPrize(prizes);
        setWonPrize(consolation);
        setGameOver(true);
        setPhase('victory');
        if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
        return;
      }

      // Goal collision
      for (const goal of goalsRef.current) {
        const gp = toCanvas(goal.x, goal.y);
        const dx = ball.x - gp.x, dy = ball.y - gp.y;
        if (Math.sqrt(dx * dx + dy * dy) < (GOAL_RADIUS + BALL_RADIUS * 0.3) * dpr) {
          getSoundEngine().swish();
          setWonPrize(goal.prize);
          setPhase('victory');
          if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
          return;
        }
      }

      /* ── Draw ball ── */
      // Shadow
      ctx.beginPath();
      ctx.ellipse(ball.x + 2 * dpr, ball.y + 3 * dpr, br * 0.9, br * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fill();

      // Ball body — gold metallic
      const ballGrad = ctx.createRadialGradient(ball.x - br * 0.3, ball.y - br * 0.3, br * 0.1, ball.x, ball.y, br);
      ballGrad.addColorStop(0, CREAM);
      ballGrad.addColorStop(0.3, GOLD_BRIGHT);
      ballGrad.addColorStop(0.6, GOLD);
      ballGrad.addColorStop(1, SIENNA);
      ctx.beginPath(); ctx.arc(ball.x, ball.y, br, 0, Math.PI * 2);
      ctx.fillStyle = ballGrad;
      ctx.fill();

      // Highlight
      ctx.beginPath(); ctx.arc(ball.x - br * 0.25, ball.y - br * 0.3, br * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${creamRgb},0.5)`;
      ctx.fill();

      /* ── Touch indicator ── */
      if (touchActiveRef.current) {
        const tp = touchPosRef.current;
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 2 * dpr;
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.beginPath(); ctx.moveTo(ball.x, ball.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(tp.x, tp.y, 12 * dpr, 0, Math.PI * 2);
        ctx.strokeStyle = GOLD;
        ctx.stroke();
        ctx.restore();
      }

      /* ── Tilt indicator ── */
      const indX = W / 2;
      const indY = mazeY + mazeSize + 35 * dpr;
      const indR = 18 * dpr;
      ctx.strokeStyle = `rgba(${creamRgb},0.08)`;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(indX, indY, indR, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.arc(
        indX + tiltRef.current.x * indR * 0.8,
        indY + tiltRef.current.y * indR * 0.8,
        3.5 * dpr, 0, Math.PI * 2
      );
      ctx.fill();

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animRef.current);
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    };
  }, [phase, prizes, toCanvas, lineCircleCollide, resetBall, updateTiltFromTouch]);

  return (
    <div
      className="game-container noise-overlay flex flex-col items-center"
      style={{ background: `radial-gradient(ellipse at 50% 20%, ${BG_LIGHT} 0%, ${BG_MID} 50%, ${BG_DARK} 100%)` }}
    >
      {/* Header */}
      {phase === 'playing' && (
      <div className="absolute top-2 left-0 right-0 flex flex-col items-center z-10 pointer-events-none" style={{ animation: 'fadeInUp 0.5s ease-out both' }}>
        <h1
          className="text-[18px] font-black tracking-tight text-center"
          style={{ background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
        >
          Gyro Maze
        </h1>
      </div>
      )}

      {/* HUD */}
      {phase === 'playing' && (
        <div className="absolute top-2 left-4 right-4 flex items-center justify-between z-10 pointer-events-none" style={{ animation: 'fadeIn 0.3s ease-out both' }}>
          <div className="flex items-center gap-1">
            {Array.from({ length: MAX_ATTEMPTS }).map((_, i) => (
              <span key={i} className="text-lg">{i < MAX_ATTEMPTS - attempts ? '🟡' : '✕'}</span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span style={{ color: (TIME_LIMIT - elapsed) <= 10 ? '#ef4444' : CREAM + '50' }} className="text-[11px] font-semibold uppercase tracking-wider">⏱</span>
            <span style={{ color: (TIME_LIMIT - elapsed) <= 10 ? '#ef4444' : CREAM + 'aa' }} className="text-sm font-bold tabular-nums">{Math.max(0, TIME_LIMIT - elapsed)}s</span>
          </div>
        </div>
      )}

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
        onTouchStart={onPointerDown}
        onTouchMove={onPointerMove}
        onTouchEnd={onPointerUp}
      />

      {/* Loading */}
      {phase === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: BG_DARK }}>
          <div className="w-8 h-8 rounded-full border-2" style={{ borderColor: `${GOLD}30`, borderTopColor: GOLD, animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {/* Ready screen */}
      {phase === 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
          <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 30%, ${BG_LIGHT} 0%, ${BG_MID} 50%, ${BG_DARK} 100%)` }} />
          <div className="relative z-10 flex flex-col items-center gap-5 px-8">
            <div className="flex gap-3 text-4xl" style={{ animation: 'victoryFloat 3s ease-in-out infinite' }}>
              <span>🎁</span><span>🎁</span><span>🎁</span>
            </div>
            <h2 className="text-[28px] font-extrabold tracking-tight text-center"
              style={{ background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${AMBER})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'fadeInUp 0.6s ease-out both' }}>
              Gyro Maze
            </h2>
            <p style={{ color: CREAM + '50' }} className="text-[13px] text-center max-w-[260px] leading-relaxed">
              {gameOver ? (
                <>Pas de chance cette fois…</>
              ) : (
                <>
                  Un labyrinthe complexe vous attend.<br />
                  Évitez les trous et guidez la bille<br />
                  vers un des 4 cadeaux ! {MAX_ATTEMPTS} vies.<br />
                  <span style={{ color: CREAM + '30' }} className="text-[11px]">Inclinez ou touchez pour diriger</span>
                </>
              )}
            </p>
            {hasGyro === false && (
              <p className="text-[11px] text-center" style={{ color: AMBER + '80', animation: 'fadeIn 0.5s ease-out 0.3s both' }}>
                Gyroscope non détecté — touchez/glissez pour jouer
              </p>
            )}
            <button
              onClick={startGame}
              className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-[15px] tracking-wide transition-all duration-200 active:scale-[0.96]"
              style={{ background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`, boxShadow: `0 12px 40px -10px ${GOLD}80`, animation: 'fadeInUp 0.6s ease-out 0.2s both' }}
            >
              Jouer 🏁
            </button>
          </div>
        </div>
      )}

      {/* Victory */}
      {phase === 'victory' && wonPrize && (
        <VictoryScreen prize={wonPrize} onClose={() => setPhase('ready')} accentFrom={GOLD} accentTo={AMBER} />
      )}
    </div>
  );
}
