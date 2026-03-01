import Link from "next/link";
import { GameTheme, DEFAULT_THEME } from '../lib/themes';

/* ═══════════════════════════════════════════════
   Reusable Home Page — Grid layout for landscape tablet
   ═══════════════════════════════════════════════ */

export default function HomePage({ theme = DEFAULT_THEME }: { theme?: GameTheme }) {
  const {
    GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA,
    BG_DARK, BG_MID, BG_LIGHT, routePrefix,
  } = theme;

  const GAMES = [
    {
      href: `${routePrefix}/plinko`,
      title: "Plinko",
      emoji: "🎱",
      accentFrom: GOLD,
      accentTo: AMBER,
    },
    {
      href: `${routePrefix}/gyro-maze`,
      title: "Gyro Maze",
      emoji: "🏁",
      accentFrom: GOLD,
      accentTo: SIENNA,
    },
    {
      href: `${routePrefix}/angry-ball`,
      title: "Angry Ball",
      emoji: "😡",
      accentFrom: AMBER,
      accentTo: '#ef4444',
    },
    {
      href: `${routePrefix}/pendulum`,
      title: "Pendulum",
      emoji: "🎣",
      accentFrom: GOLD,
      accentTo: '#6366f1',
    },
    {
      href: `${routePrefix}/cannon`,
      title: "Cannon",
      emoji: "💥",
      accentFrom: '#b45309',
      accentTo: '#ef4444',
    },
    {
      href: `${routePrefix}/spin`,
      title: "Spin & Win",
      emoji: "🎰",
      accentFrom: GOLD,
      accentTo: '#22c55e',
    },
  ];

  return (
    <div
      className="noise-overlay flex flex-col items-center justify-center px-6 overflow-hidden"
      style={{
        width: "100%",
        height: "100dvh",
        background: `radial-gradient(ellipse at 50% 30%, ${BG_LIGHT} 0%, ${BG_MID} 60%, ${BG_DARK} 100%)`,
      }}
    >
      {/* Title */}
      <div className="text-center mb-5" style={{ animation: "fadeInUp 0.4s ease-out both" }}>
        <h1
          className="text-[26px] font-extrabold tracking-tight"
          style={{
            background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Mini-Jeux
        </h1>
        <p style={{ color: `${CREAM}40` }} className="text-[11px] mt-1">
          Choisissez un jeu et tentez de gagner un cadeau
        </p>
      </div>

      {/* Games Grid — 3 columns */}
      <div
        className="grid gap-3 w-full"
        style={{
          gridTemplateColumns: 'repeat(3, 1fr)',
          maxWidth: '600px',
        }}
      >
        {GAMES.map((game, i) => (
          <Link
            key={game.href}
            href={game.href}
            className="group relative flex flex-col items-center justify-center gap-2 p-4 rounded-2xl transition-all duration-200 active:scale-[0.95]"
            style={{
              background: `linear-gradient(145deg, ${game.accentFrom}0c, ${game.accentTo}08)`,
              border: `1px solid ${game.accentFrom}15`,
              animation: `fadeInUp 0.4s ease-out ${0.08 + i * 0.06}s both`,
            }}
          >
            {/* Hover glow */}
            <div
              className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-300 pointer-events-none"
              style={{
                background: `radial-gradient(circle at 50% 40%, ${game.accentFrom}18, transparent 70%)`,
                border: `1px solid ${game.accentFrom}30`,
                borderRadius: "1rem",
              }}
            />

            {/* Emoji */}
            <div
              className="relative text-4xl select-none"
              style={{
                filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))',
              }}
            >
              {game.emoji}
            </div>

            {/* Title */}
            <h2
              className="relative font-bold text-[12px] tracking-tight text-center"
              style={{ color: CREAM + 'cc' }}
            >
              {game.title}
            </h2>

            {/* Subtle bottom accent line */}
            <div
              className="absolute bottom-0 left-[20%] right-[20%] h-px rounded-full"
              style={{
                background: `linear-gradient(90deg, transparent, ${game.accentFrom}30, transparent)`,
              }}
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
