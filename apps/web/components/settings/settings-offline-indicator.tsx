"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Database, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import {
  countPendingCommands,
  readFocusOfflineSnapshot,
  subscribeFocusOfflineSync,
  syncFocusOfflineQueue,
} from "@/lib/client/focus-offline-store";
import { canUseIndexedDb } from "@/lib/client/focus-offline-storage";

export interface SettingsOfflineIndicatorProps {
  userId: string;
}

export function SettingsOfflineIndicator({ userId }: SettingsOfflineIndicatorProps) {
  const [isClient, setIsClient] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [hasIndexedDb, setHasIndexedDb] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const refreshState = async () => {
    if (typeof window === "undefined") return;
    try {
      const isIdbAvailable = canUseIndexedDb();
      setHasIndexedDb(isIdbAvailable);
      setIsOnline(window.navigator.onLine);

      if (userId) {
        const count = await countPendingCommands(userId);
        setPendingCount(count);
        const snapshot = await readFocusOfflineSnapshot(userId);
        if (snapshot?.savedAt) {
          setLastSyncedAt(snapshot.savedAt);
        }
      }
    } catch {
      // Fallback cleanly
    }
  };

  useEffect(() => {
    let active = true;

    const runInitialSync = async () => {
      if (!active || typeof window === "undefined") return;
      try {
        const isIdbAvailable = canUseIndexedDb();
        const online = window.navigator.onLine;
        let count = 0;
        let syncedAt: string | null = null;
        if (userId) {
          count = await countPendingCommands(userId);
          const snapshot = await readFocusOfflineSnapshot(userId);
          if (snapshot?.savedAt) {
            syncedAt = snapshot.savedAt;
          }
        }
        if (active) {
          setIsClient(true);
          setHasIndexedDb(isIdbAvailable);
          setIsOnline(online);
          setPendingCount(count);
          setLastSyncedAt(syncedAt);
        }
      } catch {
        if (active) setIsClient(true);
      }
    };

    void runInitialSync();

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const unsubscribe = subscribeFocusOfflineSync(() => {
      void refreshState();
    });

    return () => {
      active = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsubscribe();
    };
  }, [userId]);

  const handleManualSync = async () => {
    if (!userId || isSyncing) return;
    setIsSyncing(true);
    try {
      await syncFocusOfflineQueue(userId);
      await refreshState();
    } catch {
      // Handled internally
    } finally {
      setIsSyncing(false);
    }
  };

  const formatLastSync = (iso: string | null) => {
    if (!iso) return "暂无同步记录";
    try {
      const d = new Date(iso);
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const h = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      const s = String(d.getSeconds()).padStart(2, "0");
      return `${m}/${day} ${h}:${min}:${s}`;
    } catch {
      return iso;
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-3.5 sm:p-4 text-zinc-100 shadow-xl backdrop-blur-md space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="grid size-7 place-items-center rounded-lg bg-teal-500/10 text-teal-300 border border-teal-500/20">
            <Database size={15} />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-white">客户端离线同步与缓存</h3>
            <span className="text-[10px] text-zinc-400">IndexedDB 离线队列与断网韧性</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isOnline ? (
            <Badge tone="success" className="gap-1">
              <Wifi size={11} /> 在线
            </Badge>
          ) : (
            <Badge tone="warning" className="gap-1">
              <WifiOff size={11} /> 离线
            </Badge>
          )}
        </div>
      </div>

      {/* Grid of Offline Parameters */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-white/5 bg-[#090d0f] p-2 space-y-0.5">
          <span className="text-[11px] text-zinc-400">存储引擎</span>
          <p className="font-semibold font-mono text-teal-300">
            {isClient ? (hasIndexedDb ? "IndexedDB (就绪)" : "LocalStorage 降级") : "IndexedDB (检测中)"}
          </p>
        </div>

        <div className="rounded-xl border border-white/5 bg-[#090d0f] p-2 space-y-0.5">
          <span className="text-[11px] text-zinc-400">待同步离线队列</span>
          <p className="font-semibold font-mono text-white">
            {pendingCount === 0 ? (
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 size={12} /> 0 项 (已同步)
              </span>
            ) : (
              <span className="text-amber-400">{pendingCount} 项待推送</span>
            )}
          </p>
        </div>

        <div className="col-span-2 rounded-xl border border-white/5 bg-[#090d0f] p-2 flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[11px] text-zinc-400">上次同步时间</span>
            <p className="font-mono text-xs text-zinc-300">
              {isClient ? formatLastSync(lastSyncedAt) : "读取中..."}
            </p>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleManualSync}
            disabled={isSyncing || !isOnline}
            className="flex items-center gap-1.5 border-teal-500/30 bg-teal-500/10 text-teal-300 hover:bg-teal-500/20 text-[11px]"
          >
            <RefreshCw size={11} className={isSyncing ? "animate-spin" : ""} />
            {isSyncing ? "同步中..." : "立即同步"}
          </Button>
        </div>
      </div>
    </div>
  );
}
