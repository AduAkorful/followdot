import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/providers/providers";
import { ErrorBoundary } from "@/components/error-boundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Followdot — Follow the smart money",
  description:
    "Smart-money mirror for DreamDEX Event Contracts on Somnia. " +
    "Discover top wallets, see their edge, and copy trades with one click " +
    "or auto-mirror via session keys.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body>
        <ErrorBoundary>
          <Providers>
            <TooltipProvider>
              <div className="app-shell">
                <Sidebar />
                <div className="main-shell">
                  <Topbar />
                  <div className="content-shell">
                    {children}
                  </div>
                </div>
              </div>
            </TooltipProvider>
          </Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}

