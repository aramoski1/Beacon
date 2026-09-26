import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in · Beacon" };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
