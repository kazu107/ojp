import type { Metadata } from "next";
import { JetBrains_Mono, Zen_Kaku_Gothic_New } from "next/font/google";
import { SiteShell } from "@/components/site-shell";
import "./globals.css";

const jpSans = Zen_Kaku_Gothic_New({
  variable: "--font-jp-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const mono = JetBrains_Mono({
  variable: "--font-jp-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OJP - AtCoder-like Platform MVP",
  description:
    "AtCoder風オンラインジャッジ/問題投稿/コンテスト運営のMVPプロトタイプ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={`${jpSans.variable} ${mono.variable}`}>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
