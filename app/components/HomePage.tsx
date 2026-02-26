import Link from "next/link";
import { GameTheme, DEFAULT_THEME } from '../lib/themes';

/* ═══════════════════════════════════════════════
   Reusable Home Page — accepts theme for Winston/Camel/Default
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
      desc: "Lâchez la bille et gagnez un cadeau",
      emoji: "🎱",
      accentFrom: GOLD,
      accentTo: AMBER,
    },
    {
      href: `${routePrefix}/whac-a-mole`,
      title: "Gift Catcher",
      desc: "Attrapez un cadeau avant qu'il disparaisse !",
      emoji: "🎁",
      accentFrom: GOLD_BRIGHT,
      accentTo: GOLD,
    },
    {
      href: `${routePrefix}/gyro-maze`,
      title: "Gyro Maze",
      desc: "Guidez la bille dans un labyrinthe aléatoire",
      emoji: "🏁",
      accentFrom: GOLD,
      accentTo: SIENNA,
    },
    {
      href: `${routePrefix}/angry-ball`,
      title: "Angry Ball",
      desc: "Lancez la boule dans les trous !",
      emoji: "😡",
      accentFrom: AMBER,
      accentTo: '#ef4444',
    },
    {
      href: `${routePrefix}/swipe-shoot`,
      title: "Swipe & Shoot",
      desc: "Lancez la balle dans le panier",
      emoji: "🏀",
      accentFrom: '#f97316',
      accentTo: AMBER,
    },
    {
      href: `${routePrefix}/demineur`,
      title: "Hack the Grid",
      desc: "Déverrouillez le coffre numérique",
      emoji: "💻",
      accentFrom: '#10b981',
      accentTo: GOLD,
    },
    {
      href: `${routePrefix}/gift-slice`,
      title: "Gift Slice",
      desc: "Tranchez les cadeaux, évitez les bombes !",
      emoji: "🗡️",
      accentFrom: '#ef4444',
      accentTo: GOLD_BRIGHT,
    },
    {
      href: `${routePrefix}/gravity-drop`,
      title: "Gravity Drop",
      desc: "Inclinez pour guider la bille vers la sortie",
      emoji: "🌀",
      accentFrom: SIENNA,
      accentTo: GOLD,
    },
    {
      href: `${routePrefix}/nerve`,
      title: "Nerve",
      desc: "Plus vous attendez, plus vous gagnez gros",
      emoji: "💣",
      accentFrom: '#ef4444',
      accentTo: '#fbbf24',
    },
    {
      href: `${routePrefix}/pendulum`,
      title: "Pendulum",
      desc: "Attrapez le cadeau au bon moment !",
      emoji: "🎣",
      accentFrom: GOLD,
      accentTo: '#6366f1',
    },
    {
      href: `${routePrefix}/stack-tower`,
      title: "Stack Tower",
      desc: "Empilez les blocs le plus haut possible",
      emoji: "🏗️",
      accentFrom: AMBER,
      accentTo: GOLD_BRIGHT,
    },
    {
      href: `${routePrefix}/cannon`,
      title: "Cannon",
      desc: "Visez et tirez sur les plateformes",
      emoji: "💥",
      accentFrom: '#b45309',
      accentTo: '#ef4444',
    },
    {
      href: `${routePrefix}/crane-machine`,
      title: "Crane Machine",
      desc: "Attrapez un cadeau avec la pince !",
      emoji: "🏗️",
      accentFrom: GOLD_BRIGHT,
      accentTo: AMBER,
    },
    {
      href: `${routePrefix}/pachinko`,
      title: "Pachinko",
      desc: "Guidez la bille avec les flippers",
      emoji: "🎰",
      accentFrom: '#8b5cf6',
      accentTo: GOLD,
    },
  ];

  return (
    <div
      className="noise-overlay flex flex-col items-center px-6 gap-8 overflow-y-auto py-12"
      style={{
        width: "100%",
        minHeight: "100dvh",
        background: `radial-gradient(ellipse at 50% 20%, ${BG_LIGHT} 0%, ${BG_MID} 60%, ${BG_DARK} 100%)`,
      }}
    >
      {/* Decorative line at top */}
      <div
        className="w-16 h-0.5 rounded-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${GOLD}60, transparent)`,
          animation: "fadeIn 0.6s ease-out both",
        }}
      />

      <div className="text-center" style={{ animation: "fadeInUp 0.5s ease-out both" }}>
        <h1
          className="text-[32px] font-extrabold tracking-tight mb-2"
          style={{
            background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Mini-Jeux
        </h1>
        <p style={{ color: `${CREAM}45` }} className="text-sm">
          Choisissez un jeu et tentez de gagner un cadeau
        </p>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-[340px]">
        {GAMES.map((game, i) => (
          <Link
            key={game.href}
            href={game.href}
            className="group relative flex items-center gap-5 p-5 rounded-2xl transition-all duration-200 active:scale-[0.97]"
            style={{
              background: `${GOLD}08`,
              border: `1px solid ${GOLD}0a`,
              animation: `fadeInUp 0.5s ease-out ${0.15 + i * 0.1}s both`,
            }}
          >
            {/* Hover glow */}
            <div
              className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-300 pointer-events-none"
              style={{
                background: `linear-gradient(135deg, ${game.accentFrom}10, ${game.accentTo}10)`,
                border: `1px solid ${game.accentFrom}20`,
                borderRadius: "1rem",
              }}
            />

            <div
              className="relative flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center text-2xl"
              style={{
                background: `linear-gradient(135deg, ${game.accentFrom}12, ${game.accentTo}12)`,
                border: `1px solid ${game.accentFrom}20`,
              }}
            >
              {game.emoji}
            </div>

            <div className="relative flex-1 min-w-0">
              <h2
                className="font-bold text-[16px] tracking-tight"
                style={{ color: CREAM + 'dd' }}
              >
                {game.title}
              </h2>
              <p style={{ color: CREAM + '40' }} className="text-[13px] mt-0.5">
                {game.desc}
              </p>
            </div>

            <svg
              className="relative w-5 h-5 flex-shrink-0"
              style={{ color: CREAM + '20' }}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Link>
        ))}
      </div>

      {/* Bottom decorative line */}
      <div
        className="w-10 h-px rounded-full mt-4"
        style={{
          background: `linear-gradient(90deg, transparent, ${GOLD}30, transparent)`,
        }}
      />
    </div>
  );
}
