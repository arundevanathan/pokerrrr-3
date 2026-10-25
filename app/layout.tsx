import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#101b19", viewportFit: "cover" };

export const metadata: Metadata = {
  title: "Dunzo Club",
  description: "A private mixed poker table for your circle. Hold’em, PLO4 and PLO5.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Dunzo Club" },
  icons: {
    icon: "/favicon.svg",
    apple: "/icon-192.png",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
