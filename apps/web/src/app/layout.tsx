import type { Metadata } from "next";
import { IBM_Plex_Sans, Manrope } from "next/font/google";

import "./globals.css";

const display = Manrope({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  variable: "--font-display",
  weight: ["600", "700", "800"],
});

const sans = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  variable: "--font-sans",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "n. — news digest",
  description: "Topic digests researched by an agent and published to Telegra.ph",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
