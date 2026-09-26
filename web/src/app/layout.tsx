import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { Navbar } from "@/components/layout/Navbar";

import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "500"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Keep It Real",
  description: "Drone mapping and AI property walkthrough workspace.",
};

interface RootLayoutProps {
  children: ReactNode;
}

/** Defines shared fonts, navigation, metadata, and providers for every route. */
export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>
          <Navbar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
