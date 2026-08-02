"use client";

import { Bell, Bot, BriefcaseBusiness, MonitorCog, SlidersHorizontal, UserRound, Wrench } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_TAB_ITEMS } from "@/lib/navigation/batch7";

const itemMeta = {
  "/settings/workspace": { icon: BriefcaseBusiness, description: "考试目标、科目与分组" },
  "/settings/profile": { icon: UserRound, description: "档案、动机与恢复偏好" },
  "/settings/notifications": { icon: Bell, description: "提醒类别与安静时段" },
  "/settings/ai": { icon: Bot, description: "Provider 与数据边界" },
  "/settings/experience": { icon: SlidersHorizontal, description: "主题、密度与界面偏好" },
  "/settings/system": { icon: MonitorCog, description: "版本、更新与运行状态" },
} as const;

export function SettingsNavigation() {
  const pathname = usePathname();
  return (
    <nav className="flex min-w-0 gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible" aria-label="设置">
      <SettingsLink href="/settings" label="设置总览" description="配置状态与下一步" active={pathname === "/settings"} icon={Wrench} />
      {SETTINGS_TAB_ITEMS.map((item) => {
        const meta = itemMeta[item.href];
        return <SettingsLink key={item.href} href={item.href} label={item.label} description={meta.description} active={pathname === item.href} icon={meta.icon} />;
      })}
    </nav>
  );
}

function SettingsLink(props: {
  href: string;
  label: string;
  description: string;
  active: boolean;
  icon: typeof Wrench;
}) {
  const Icon = props.icon;
  return (
    <Link href={props.href} aria-current={props.active ? "page" : undefined} className={`flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-colors lg:h-auto lg:min-h-12 lg:items-start lg:py-2.5 ${props.active ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/[0.05] hover:text-white"}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0"><span className="block font-medium">{props.label}</span><span className="mt-0.5 hidden text-xs leading-4 text-zinc-500 lg:block">{props.description}</span></span>
    </Link>
  );
}
