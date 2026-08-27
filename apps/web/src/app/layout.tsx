import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { UI_TOKEN_STYLE } from "../features/experience/token-style";

import "./globals.css";

export const metadata: Metadata = {
  title: "都记得 · Fixture Experience",
  description: "Fixed-data role experience for responsibility handover and family care.",
  manifest: "/manifest.webmanifest",
  applicationName: "We Remember",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#5A3E2B",
  width: "device-width",
  initialScale: 1,
};

interface RootLayoutProps {
  readonly children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="zh-CN" style={UI_TOKEN_STYLE}>
      <body>{children}</body>
    </html>
  );
}
