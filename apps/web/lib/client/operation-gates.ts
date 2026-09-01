export interface OperationToken {
  generation: number;
}

export function createLatestOperationGate() {
  let generation = 0;

  return {
    begin(): OperationToken {
      generation += 1;
      return { generation };
    },

    isCurrent(token: OperationToken): boolean {
      return token.generation === generation;
    },

    finish(token: OperationToken): boolean {
      if (token.generation !== generation) return false;
      generation += 1;
      return true;
    },

    invalidate(): void {
      generation += 1;
    },
  };
}

export function createExclusiveOperationGate() {
  let generation = 0;
  let activeGeneration: number | null = null;

  return {
    acquire(): OperationToken | null {
      if (activeGeneration !== null) return null;
      generation += 1;
      activeGeneration = generation;
      return { generation };
    },

    isActive(token: OperationToken): boolean {
      return token.generation === activeGeneration;
    },

    isLocked(): boolean {
      return activeGeneration !== null;
    },

    release(token: OperationToken): boolean {
      if (token.generation !== activeGeneration) return false;
      activeGeneration = null;
      return true;
    },

    invalidate(): void {
      generation += 1;
      activeGeneration = null;
    },
  };
}
