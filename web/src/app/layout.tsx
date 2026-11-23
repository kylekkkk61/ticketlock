import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";
import { getConfig } from "@/server/config";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "TicketLock", template: "%s · TicketLock" },
  description: "Tickets you own, transfer and use once. A presentation demo on Base Sepolia.",
  icons: { icon: "/brand/ticketlock-mark.svg", apple: "/brand/ticketlock-icon-180.png" },
};

export const viewport: Viewport = { themeColor: "#0e1512", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The deployment manifest is read when the request arrives, not baked in at build time.
  await connection();
  const config = getConfig().public;
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <Providers config={config}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
