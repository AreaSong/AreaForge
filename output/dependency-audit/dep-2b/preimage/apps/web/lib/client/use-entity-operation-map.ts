"use client";

import { useCallback, useReducer, useRef } from "react";

export interface EntityOperationState {
  generation: number;
  pending: boolean;
  error: string | null;
}

type EntityOperationAction<Id> =
  | { type: "begin"; id: Id; generation: number }
  | { type: "succeed"; id: Id; generation: number }
  | { type: "fail"; id: Id; generation: number; error: string }
  | { type: "clear-error"; id: Id };

const IDLE_OPERATION: EntityOperationState = {
  generation: 0,
  pending: false,
  error: null,
};

export function reduceEntityOperations<Id>(
  state: ReadonlyMap<Id, EntityOperationState>,
  action: EntityOperationAction<Id>,
): ReadonlyMap<Id, EntityOperationState> {
  const current = state.get(action.id);
  if (action.type !== "begin" && action.type !== "clear-error"
    && current?.generation !== action.generation) {
    return state;
  }

  const next = new Map(state);
  switch (action.type) {
    case "begin":
      next.set(action.id, { generation: action.generation, pending: true, error: null });
      break;
    case "succeed":
      next.delete(action.id);
      break;
    case "fail":
      next.set(action.id, { generation: action.generation, pending: false, error: action.error });
      break;
    case "clear-error":
      if (current?.error) next.set(action.id, { ...current, error: null });
      break;
  }
  return next;
}

/** 按实体隔离并发操作；旧 generation 的完成结果不能覆盖同实体的新操作。 */
export function useEntityOperationMap<Id>() {
  const [operations, dispatch] = useReducer(reduceEntityOperations<Id>, new Map());
  const nextGeneration = useRef(0);
  const active = useRef(new Map<Id, number>());

  const begin = useCallback((id: Id): number => {
    const generation = nextGeneration.current + 1;
    nextGeneration.current = generation;
    active.current.set(id, generation);
    dispatch({ type: "begin", id, generation });
    return generation;
  }, []);

  const tryBegin = useCallback((id: Id): number | null => {
    if (active.current.has(id)) return null;
    const generation = nextGeneration.current + 1;
    nextGeneration.current = generation;
    active.current.set(id, generation);
    dispatch({ type: "begin", id, generation });
    return generation;
  }, []);

  const succeed = useCallback((id: Id, generation: number) => {
    if (active.current.get(id) === generation) active.current.delete(id);
    dispatch({ type: "succeed", id, generation });
  }, []);

  const fail = useCallback((id: Id, generation: number, error: string) => {
    if (active.current.get(id) === generation) active.current.delete(id);
    dispatch({ type: "fail", id, generation, error });
  }, []);

  const clearError = useCallback((id: Id) => {
    dispatch({ type: "clear-error", id });
  }, []);

  const get = useCallback(
    (id: Id): EntityOperationState => operations.get(id) ?? IDLE_OPERATION,
    [operations],
  );

  return { begin, tryBegin, succeed, fail, clearError, get };
}
