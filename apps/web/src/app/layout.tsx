import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "News Digest",
  description: "Daily news digest portal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
