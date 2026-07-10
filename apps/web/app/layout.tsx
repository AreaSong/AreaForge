import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AreaForge",
  description: "私人考研督战与自我锻造系统",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full bg-[#080b0f] text-zinc-100">{children}</body>
    </html>
  );
}
