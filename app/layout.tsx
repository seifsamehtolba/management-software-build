import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { ClientBoot } from "@/components/ClientBoot";
import { ElevationProvider } from "@/components/ElevationProvider";
import { ThemeBoot } from "@/components/ThemeBoot";
import { AppShell } from "@/components/AppShell";
import { LanguageProvider } from "@/components/LanguageProvider";
import { UpdateBanner } from "@/components/UpdateBanner";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "نظام إدارة المتجر",
  description: "نظام إدارة متجر الحاسوب والمعدات — نقطة بيع وإدارة متكاملة",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "إدارة المتجر",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "msapplication-TileColor": "#0f172a",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${cairo.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" style={{ background: "var(--background)", color: "var(--foreground)" }}>
        <AuthProvider>
          <ElevationProvider>
            <LanguageProvider>
              <UpdateBanner />
              <ThemeBoot />
              <ClientBoot />
              <AppShell>{children}</AppShell>
            </LanguageProvider>
          </ElevationProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
