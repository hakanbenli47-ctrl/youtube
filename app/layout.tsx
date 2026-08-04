import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
  title: "Kronik — Tarih Kanalı Büyüme Sistemi",
  description:
    "Tarih kanalları için canlı YouTube analizi, konu tekrar kontrolü ve veri destekli yayın planı.",
  openGraph: {
    title: "Kronik — Tarih Kanalı Büyüme Sistemi",
    description: "Tarih kanalının verisini editoryal karara çevir.",
  },
  twitter: {
    card: "summary",
    title: "Kronik — Tarih Kanalı Büyüme Sistemi",
    description: "Tarih kanalının verisini editoryal karara çevir.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
