"use client";

import { useCallback, useReducer, useRef } from "react";

export interface VersionedDecisionCommandState<Command> {
  command: Command | null;
  generation: number;
  pending: boolean;
  error: string | null;
}

type VersionedDecisionAction<Command> =
  | { type: "begin"; command: Command; generation: number }
  | { type: "succeed"; generation: number }
  | { type: "fail"; generation: number; error: string }
  | { type: "restore"; command: Command | null }
  | { type: "clear-error" };

const IDLE_STATE: VersionedDecisionCommandState<never> = {
  command: null,
  generation: 0,
  pending: false,
  error: null,
};

export function reduceVersionedDecisionCommand<Command>(
  state: VersionedDecisionCommandState<Command>,
  action: VersionedDecisionAction<Command>,
): VersionedDecisionCommandState<Command> {
  switch (action.type) {
    case "begin":
      return { command: action.command, generation: action.generation, pending: true, error: null };
    case "succeed":
      return state.pending && state.generation === action.generation
        ? { ...state, command: null, pending: false }
        : state;
    case "fail":
      return state.pending && state.generation === action.generation
        ? { ...state, pending: false, error: action.error }
        : state;
    case "restore":
      return { ...state, command: action.command, pending: false, error: null };
    case "clear-error":
      return state.error ? { ...state, error: null } : state;
  }
};

/**
 * 为一个版本化决策实体提供同步互斥和过期完成保护。
 * 持久化、冲突合并和领域 API 仍由调用方拥有。
 */
export function useVersionedDecisionCommand<Command>() {
  const [state, dispatch] = useReducer(
    reduceVersionedDecisionCommand<Command>,
    IDLE_STATE as VersionedDecisionCommandState<Command>,
  );
  const nextGeneration = useRef(0);
  const activeGeneration = useRef<number | null>(null);

  const begin = useCallback((command: Command): number | null => {
    if (activeGeneration.current !== null) return null;
    const generation = nextGeneration.current + 1;
    nextGeneration.current = generation;
    activeGeneration.current = generation;
    dispatch({ type: "begin", command, generation });
    return generation;
  }, []);

  const succeed = useCallback((generation: number): boolean => {
    if (activeGeneration.current !== generation) return false;
    activeGeneration.current = null;
    dispatch({ type: "succeed", generation });
    return true;
  }, []);

  const fail = useCallback((generation: number, error: string): boolean => {
    if (activeGeneration.current !== generation) return false;
    activeGeneration.current = null;
    dispatch({ type: "fail", generation, error });
    return true;
  }, []);

  const clearError = useCallback(() => dispatch({ type: "clear-error" }), []);
  const restore = useCallback((command: Command | null) => dispatch({ type: "restore", command }), []);

  return { ...state, begin, succeed, fail, clearError, restore };
}
