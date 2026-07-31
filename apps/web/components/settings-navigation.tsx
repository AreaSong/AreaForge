"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_TAB_ITEMS } from "@/lib/navigation/batch7";

export function SettingsNavigation() {
  const pathname = usePathname();

  return (
    <nav className="grid grid-cols-3 gap-1 sm:flex sm:flex-wrap" aria-label="设置">
      {SETTINGS_TAB_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-2 text-center text-sm transition-colors ${active
              ? "bg-white/10 text-white"
              : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
