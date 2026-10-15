import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings · Beacon" };

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
