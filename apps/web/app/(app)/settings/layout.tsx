import { SettingsNavigation } from "@/components/settings-navigation";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <header className="border-b border-white/10 pb-3">
        <SettingsNavigation />
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
