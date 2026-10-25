import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { INSTALL_CAPTURE_SCRIPT } from "@/lib/install-script";
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
  title: "GD Arena",
  description:
    "Practise a group discussion out loud against five AI participants, then get a scorecard and the full transcript.",
  applicationName: "GD Arena",
  // Home-screen app on iPhone and iPad (the manifest covers other browsers).
  appleWebApp: { capable: true, title: "GD Arena", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Matches --bg in globals.css for each colour scheme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0e12" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        {/* Catches the browser's install prompt before React loads (see install.ts). */}
        <script dangerouslySetInnerHTML={{ __html: INSTALL_CAPTURE_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col bg-bg font-sans text-ink">{children}</body>
    </html>
  );
}
