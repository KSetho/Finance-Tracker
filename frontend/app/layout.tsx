import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "../src/providers";
import "../src/index.css";

export const metadata: Metadata = {
  title: "Finance Tracker",
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b6b4f",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
