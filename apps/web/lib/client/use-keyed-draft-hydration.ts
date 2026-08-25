"use client";

import { useCallback, useState } from "react";

export interface KeyedHydrationToken {
  key: string;
  generation: number;
}

export function createKeyedHydrationGate() {
  let generation = 0;
  return {
    begin(key: string): KeyedHydrationToken {
      generation += 1;
      return { key, generation };
    },
    isCurrent(token: KeyedHydrationToken): boolean {
      return token.generation === generation;
    },
    cancel(token: KeyedHydrationToken): void {
      if (token.generation === generation) generation += 1;
    },
  };
}

/** 让草稿持久化只在当前 identity 的恢复代际完成后启用。 */
export function useKeyedDraftHydration(key: string) {
  const [gate] = useState(createKeyedHydrationGate);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const begin = useCallback(() => gate.begin(key), [gate, key]);
  const isCurrent = useCallback(
    (token: KeyedHydrationToken) => token.key === key && gate.isCurrent(token),
    [gate, key],
  );
  const complete = useCallback((token: KeyedHydrationToken) => {
    if (token.key === key && gate.isCurrent(token)) setLoadedKey(token.key);
  }, [gate, key]);
  const cancel = useCallback((token: KeyedHydrationToken) => gate.cancel(token), [gate]);

  return { ready: loadedKey === key, begin, isCurrent, complete, cancel };
}
