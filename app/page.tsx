import Link from "next/link";

const GAMES = [
  {
    href: "/swipe-shoot",
    title: "Swipe & Shoot",
    desc: "Lancez la bille dans le bon slot",
    emoji: "🎯",
    accentFrom: "#3b82f6",
    accentTo: "#8b5cf6",
  },
  {
    href: "/demineur",
    title: "La Matrice",
    desc: "Choisissez la bonne case",
    emoji: "💎",
    accentFrom: "#8b5cf6",
    accentTo: "#06b6d4",
  },
  {
    href: "/plinko",
    title: "Plinko",
    desc: "Lâchez la bille et gagnez",
    emoji: "🔮",
    accentFrom: "#f59e0b",
    accentTo: "#ef4444",
  },
  {
    href: "/whac-a-mole",
    title: "Whac-A-Mole",
    desc: "Tapez les taupes avant qu'elles disparaissent",
    emoji: "🔨",
    accentFrom: "#f59e0b",
    accentTo: "#dc2626",
  },
];

export default function Home() {
  return (
    <div
      className="game-container noise-overlay flex flex-col items-center justify-center px-6 gap-10"
      style={{
        background:
          "radial-gradient(ellipse at 50% 20%, #1a1040 0%, #0c0a1a 60%, #050410 100%)",
      }}
    >
      <div className="text-center" style={{ animation: "fadeInUp 0.5s ease-out both" }}>
        <h1 className="text-[32px] font-extrabold text-white tracking-tight mb-2">
          Mini-Jeux
        </h1>
        <p className="text-white/35 text-sm">
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
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
              animation: `fadeInUp 0.5s ease-out ${0.15 + i * 0.1}s both`,
            }}
          >
            {/* Hover/active glow */}
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
                background: `linear-gradient(135deg, ${game.accentFrom}15, ${game.accentTo}15)`,
                border: `1px solid ${game.accentFrom}25`,
              }}
            >
              {game.emoji}
            </div>

            <div className="relative flex-1 min-w-0">
              <h2 className="text-white font-bold text-[16px] tracking-tight">
                {game.title}
              </h2>
              <p className="text-white/35 text-[13px] mt-0.5">{game.desc}</p>
            </div>

            <svg
              className="relative w-5 h-5 text-white/20 flex-shrink-0"
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
    </div>
  );
}
