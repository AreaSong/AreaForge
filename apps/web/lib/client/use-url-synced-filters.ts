"use client";

import { useCallback, useOptimistic, useState, useTransition } from "react";

type FilterRecord = Record<string, string>;

export function mergeUrlSyncedFilters<Filters extends FilterRecord>(
  current: Filters,
  patch: Partial<Filters>,
): Filters {
  return { ...current, ...patch };
}

/**
 * URL/RSC props 是筛选源事实；本地 state 只覆盖一次导航往返的等待窗口。
 * sourceKey 变化（包括浏览器前进/后退）时，重新吸收 URL 快照。
 */
export function useUrlSyncedFilters<Filters extends FilterRecord>(input: {
  source: Filters;
  sourceKey: string;
  onCommit: (filters: Filters) => void;
}) {
  const [canonical, setCanonical] = useState({ sourceKey: input.sourceKey, filters: input.source });
  if (canonical.sourceKey !== input.sourceKey) {
    setCanonical({ sourceKey: input.sourceKey, filters: input.source });
  }
  const canonicalFilters = canonical.sourceKey === input.sourceKey ? canonical.filters : input.source;
  const [filters, applyOptimisticPatch] = useOptimistic<Filters, Partial<Filters>>(
    canonicalFilters,
    mergeUrlSyncedFilters,
  );
  const [, startTransition] = useTransition();

  const commit = useCallback((patch: Partial<Filters>) => {
    const next = mergeUrlSyncedFilters(filters, patch);
    startTransition(() => {
      applyOptimisticPatch(patch);
      input.onCommit(next);
    });
  }, [applyOptimisticPatch, filters, input, startTransition]);

  return { filters, commit };
}
