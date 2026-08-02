import { SettingsNavigation } from "@/components/settings-navigation";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-0 w-full gap-5 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-7">
      <aside className="min-w-0 border-b border-white/10 pb-3 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
        <p className="mb-3 hidden px-3 text-xs font-medium text-zinc-500 lg:block">设置中心</p>
        <SettingsNavigation />
      </aside>
      <div className="min-h-0 min-w-0">{children}</div>
    </div>
  );
}
