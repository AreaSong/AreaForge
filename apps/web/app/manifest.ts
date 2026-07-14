import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AreaForge - 私人考研督战与自我锻造系统",
    short_name: "AreaForge",
    description: "把每日计划、专注、知识证据、复盘与阶段调整连接成长期备考闭环。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#06191F",
    theme_color: "#06191F",
    lang: "zh-CN",
    categories: ["education", "productivity"],
    icons: [
      {
        src: "/brand/areaforge-app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/areaforge-app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/areaforge-app-icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/brand/areaforge-app-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
