import type { Metadata } from "next";
import { Outfit, DM_Mono } from "next/font/google";
import "./globals.css";
import SessionCapture from "./components/SessionCapture";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

export const metadata: Metadata = {
  title: "Mini-Jeux",
  description: "Jouez et tentez de gagner des cadeaux",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body
        className={`${outfit.variable} ${dmMono.variable} antialiased`}
      >
        <SessionCapture />
        {children}
      </body>
    </html>
  );
}
