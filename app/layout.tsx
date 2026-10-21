import type { Metadata } from "next";
import { JetBrains_Mono, Zen_Kaku_Gothic_New } from "next/font/google";
import { SiteShell } from "@/components/site-shell";
import { I18nProvider } from "@/components/i18n-provider";
import { getI18n } from "@/lib/i18n/server";
import "./globals.css";
import "./learning.css";

const jpSans = Zen_Kaku_Gothic_New({
  variable: "--font-jp-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const mono = JetBrains_Mono({
  variable: "--font-jp-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("OJP - Online Judge"), description: t("Online judge, problems, contests and learning materials.") };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale } = await getI18n();
  return (
    <html lang={locale}>
      <body className={`${jpSans.variable} ${mono.variable}`}>
        <I18nProvider initialLocale={locale}><SiteShell>{children}</SiteShell></I18nProvider>
      </body>
    </html>
  );
}
