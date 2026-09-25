import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: {
    default: "Vertex Legacy",
    template: "%s · Vertex Legacy",
  },
  description:
    "A disciplined, sandbox-first investment operations platform for verified investors.",
  metadataBase: new URL(process.env.WEB_ORIGIN ?? "http://localhost:3000"),
  icons: {
    icon: [{ url: "/icon.jpg", type: "image/jpeg" }],
    shortcut: "/icon.jpg",
    apple: [{ url: "/icon.jpg", type: "image/jpeg" }],
  },
  openGraph: {
    title: "Vertex Legacy",
    description: "Disciplined investing, transparent operations, and traceable financial records.",
    type: "website",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>{children}</Providers>
        <script nonce={nonce} suppressHydrationWarning />
      </body>
    </html>
  );
}
