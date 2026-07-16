import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Beacon",
  description: "AI-native CRM for real estate brokers.",
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
};

import { AppShell } from "@/components/app-shell";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Synchronously apply dark mode before first paint to prevent flash */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(localStorage.getItem('beacon-theme')==='dark')document.documentElement.classList.add('dark');}catch(e){}})();` }} />
      </head>
      <body className="h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
