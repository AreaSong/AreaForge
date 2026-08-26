"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { GlobalRecoveryHelp } from "@/components/global-recovery-help";
import { GlobalToolLayer, useGlobalTools } from "@/components/global-tool-system";
import { GlobalSessionCloseout } from "@/components/global-session-closeout";
import { WindowDiscardDialog, WindowLayer } from "@/components/window-layer";
import { useForegroundNotifications } from "@/components/use-foreground-notifications";
import { useShellActivityStatus } from "@/components/use-shell-activity-status";
import { useShellLayoutPreferences } from "@/components/use-shell-layout-preferences";
import { useShellRecovery } from "@/components/use-shell-recovery";
import { WorkbenchBreadcrumbActions } from "@/components/workbench-breadcrumb-actions";
import { GlobalContextStatusBar } from "@/components/shared-study-toolbar";
import { GlobalTopBar } from "@/components/global-top-bar";
import { PageToolbar } from "@/components/page-toolbar";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { SecondaryNavigation } from "@/components/secondary-navigation";
import { SharedMobileNavigation } from "@/components/shared-mobile-navigation";
import { TabletNavigationDrawer } from "@/components/tablet-navigation-drawer";
import { Modal } from "@/components/ui/overlays";
import { APP_NAVIGATION_ITEMS, getCanonicalRoute } from "@/lib/navigation/app-navigation";
import type { AppShellStatusDto } from "@/lib/contracts";

const toneClass: Record<string, string> = {
  gray: "border-zinc-600 text-zinc-400",
  blue: "border-sky-400/50 text-sky-200",
  green: "border-emerald-400/50 text-emerald-200",
  amber: "border-amber-400/50 text-amber-200",
  red: "border-red-400/50 text-red-200",
};

export function AppShell(props: {
  children: React.ReactNode;
  initialStatus: AppShellStatusDto;
  email: string;
  userId: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [lightOpen, setLightOpen] = useState(false);
  const [tabletNavigationOpen, setTabletNavigationOpen] = useState(false);
  const { openTool } = useGlobalTools();
  const {
    status,
    syncState,
    quickReviewClaim,
    offlineFocusSession,
    currentActivitySession,
    displayStatus,
  } = useShellActivityStatus({
    initialStatus: props.initialStatus,
    pathname,
    userId: props.userId,
  });
  const {
    sidebarCollapsed,
    secondaryCollapsed,
    toggleSidebar,
    toggleSecondary,
  } = useShellLayoutPreferences();
  const immersive = pathname.endsWith("/run");
  const fullCanvasPage = immersive || pathname === "/focus" || pathname === "/knowledge/canvas" || pathname.endsWith("/preview");
  const suppressDistractions = immersive || pathname === "/focus";
  const recovery = useShellRecovery({
    userId: props.userId,
    workspaceId: status.workspaceId,
    suppressDistractions,
    reminderCandidate: status.motivationReminderCandidate,
    openTool,
  });
  const currentHref = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  const activeNavigationItem = APP_NAVIGATION_ITEMS.find((item) => item.match(pathname));
  const canonicalRoute = getCanonicalRoute(pathname);
  const showPageToolbar = canonicalRoute?.shell !== "app" || canonicalRoute.toolbar !== "none";
  const secondaryNavigationItems = activeNavigationItem?.children ?? [];
  // Immersive review keeps the global shell, but removes the module rail so
  // the review task remains focused without losing global recovery and window
  // controls.
  const showSecondaryNavigation = !immersive && secondaryNavigationItems.length > 0;
  useForegroundNotifications({ status, suppressDistractions });

  function openStatusLight() {
    setLightOpen((current) => !current);
  }

  return (
    <div className="af-app-shell h-dvh overflow-hidden bg-[var(--af-canvas)] text-zinc-100" data-layout-region="app-shell">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[1000] focus:inline-flex focus:h-10 focus:items-center focus:rounded-md focus:bg-teal-300 focus:px-3 focus:text-sm focus:font-medium focus:text-slate-950"
      >
        跳到主要内容
      </a>
      <div className="flex h-full w-full">
        <PrimaryNavigation pathname={pathname} collapsed={sidebarCollapsed} email={props.email} userId={props.userId} onToggle={toggleSidebar} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <GlobalTopBar
            pathname={pathname}
            userId={props.userId}
            statusTone={displayStatus.mobileTop.tone}
            statusSummary={displayStatus.mobileTop.summary}
            activeSession={status.activeSession}
            offlineSession={offlineFocusSession}
            quickReviewClaim={quickReviewClaim}
            onOpenStatus={openStatusLight}
            statusOpen={lightOpen}
            onOpenMotivationHelp={() => void recovery.open()}
            hasMotivationReminder={recovery.hasAutomaticReminder}
            onOpenNavigation={() => setTabletNavigationOpen(true)}
          />
          <TabletNavigationDrawer
            open={tabletNavigationOpen}
            pathname={pathname}
            email={props.email}
            userId={props.userId}
            onClose={() => setTabletNavigationOpen(false)}
          />
          {showSecondaryNavigation && activeNavigationItem ? (
            <nav className="af-secondary-compact-navigation shrink-0 overflow-x-auto px-4 pt-3 pb-1 sm:px-6 xl:px-8" tabIndex={0} aria-label={`${activeNavigationItem.label}子导航`} data-layout-region="secondary-mobile-navigation">
              <div className="flex min-w-max gap-2 whitespace-nowrap">
                {secondaryNavigationItems.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    aria-current={pathname === child.href ? "page" : child.match(pathname) ? "location" : undefined}
                    className={`rounded-md border px-3 py-1.5 text-xs ${child.match(pathname) ? "border-teal-400/50 text-teal-200" : "border-white/10 text-zinc-400"}`}
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
            </nav>
          ) : null}
          {showPageToolbar ? (
            <PageToolbar>
              <WorkbenchBreadcrumbActions pathname={pathname} currentHref={currentHref} />
            </PageToolbar>
          ) : null}

          <div className="flex min-h-0 min-w-0 flex-1">
            {showSecondaryNavigation && activeNavigationItem ? <SecondaryNavigation pathname={pathname} workbench={activeNavigationItem} collapsed={secondaryCollapsed} onToggle={toggleSecondary} /> : null}

            <div className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col">
              <main
                id="main-content"
                className={`af-shell-main min-h-0 min-w-0 flex-1 ${fullCanvasPage ? "overflow-y-auto" : "overflow-y-auto px-3.5 py-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5 sm:py-4 xl:px-6"}`}
                data-ai-page-context="true"
                data-layout-region="page-content"
                data-immersive-content={immersive ? "true" : undefined}
              >{props.children}</main>
            </div>
          </div>

          <GlobalContextStatusBar pathname={pathname} currentHref={currentHref} activeSession={currentActivitySession} statusLights={displayStatus.lights} syncState={syncState} serverTime={status.serverTime} />

          <SharedMobileNavigation pathname={pathname} email={props.email} userId={props.userId} />
        </div>
      </div>

      <GlobalRecoveryHelp
        title={recovery.source === "automatic" ? "行动提醒" : "我学不下去了"}
        motivationLine={recovery.line}
        motivationUrl={recovery.url}
        motivationError={recovery.error}
        workspaceId={status.workspaceId}
        defaultSubjectId={status.defaultSubjectId}
      />
      <GlobalSessionCloseout
        userId={props.userId}
        activeSession={currentActivitySession}
        returnTo={currentHref}
        initialNow={status.serverTime}
        pathname={pathname}
      />
      <GlobalToolLayer />
      <WindowLayer />
      <WindowDiscardDialog />
      <Modal open={lightOpen} title="今日状态" onClose={() => setLightOpen(false)}>
        <div className="divide-y divide-white/10" aria-label="今日状态详情">
          {displayStatus.lights.map((light) => (
            <div key={light.kind} className="py-4 first:pt-0">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full border ${toneClass[light.tone] ?? toneClass.gray}`} aria-hidden="true" />
                <p className="text-sm font-medium text-zinc-200">{light.label}</p>
              </div>
              <p className="mt-1 text-sm leading-6 text-zinc-500">{light.summary}</p>
              {light.action ? (
                <Link href={light.action.href} className="mt-2 inline-flex text-sm text-teal-300 hover:underline" onClick={() => setLightOpen(false)}>
                  {light.action.label}
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
