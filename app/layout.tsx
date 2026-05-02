// app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ChatProvider } from "@/components/chat-provider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const themeInitScript = `
  try {
    const t = localStorage.getItem("bimmerllm_theme");
    const a = localStorage.getItem("bimmerllm_accent");
    if (t) document.documentElement.dataset.theme = t;
    if (a) document.documentElement.dataset.accent = a;
  } catch {}
`;

export const metadata: Metadata = {
  title: "bimmerllm",
  description: "BMW knowledge consultant powered by bimmerpost forum data.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <ChatProvider>{children}</ChatProvider>
      </body>
    </html>
  );
}
