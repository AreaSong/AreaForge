import type { Metadata, Viewport } from "next";
import "./globals.css";

const description = "私人考研督战与自我锻造系统";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://forge.areasong.top"),
  applicationName: "AreaForge",
  title: {
    default: "AreaForge",
    template: "%s | AreaForge",
  },
  description,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/brand/areaforge-app-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/brand/areaforge-app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: "/",
    siteName: "AreaForge",
    title: "AreaForge",
    description,
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "AreaForge",
    description,
    images: ["/twitter-image.png"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AreaForge",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#06191F",
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
