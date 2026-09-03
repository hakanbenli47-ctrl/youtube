import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import AutoLiveSync from "./auto-live-sync";
import "./globals.css";
import "./youtube-theme.css";
import "./theme-patch-v3.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: "Tarihin İzi — YouTube Büyüme Sistemi",
  description:
    "Canlı YouTube analizi, günlük kilitli konu planı ve veri destekli Osmanlı içerik büyüme sistemi.",
  openGraph: {
    title: "Tarihin İzi — YouTube Büyüme Sistemi",
    description: "Kanal verisini her gün net içerik kararına çevir.",
  },
  twitter: {
    card: "summary",
    title: "Tarihin İzi — YouTube Büyüme Sistemi",
    description: "Kanal verisini her gün net içerik kararına çevir.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {children}
        <AutoLiveSync />
        <nav className="global-quick-nav" aria-label="Hızlı erişim">
          <Link href="/">Plan</Link>
          <Link href="/analytics">Canlı analizler</Link>
        </nav>
      </body>
    </html>
  );
}
