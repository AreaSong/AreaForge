import { useCallback, useEffect, useRef, useState } from "react";

export interface TimelineState {
  activeStageIndex: number;
  globalProgress: number; // 0.0 -> 1.0
  localProgress: number;  // 0.0 -> 1.0
  continuousStep: number; // 0.0 -> 6.0
  isPlaying: boolean;
  isInteracting: boolean;
}

export interface TimelineActions {
  seekToStage: (stageIndex: number, autoResume?: boolean) => void;
  seekToProgress: (progress: number) => void;
  togglePlay: () => void;
  setInteracting: (interacting: boolean) => void;
  stepNext: () => void;
  stepPrev: () => void;
}

export interface UseContinuousTimelineOptions {
  stageCount?: number;
  stageDurationMs?: number;
  initialStage?: number;
  autoPlay?: boolean;
  reducedMotion?: boolean;
  onStageChange?: (newStage: number, prevStage: number) => void;
}

export function useContinuousTimeline(options: UseContinuousTimelineOptions = {}): [TimelineState, TimelineActions] {
  const {
    stageCount = 6,
    stageDurationMs = 6000,
    initialStage = 0,
    autoPlay = true,
    reducedMotion = false,
    onStageChange,
  } = options;

  const totalDurationMs = stageCount * stageDurationMs;

  const [activeStageIndex, setActiveStageIndex] = useState(initialStage);
  const [globalProgress, setGlobalProgress] = useState((initialStage * stageDurationMs) / totalDurationMs);
  const [localProgress, setLocalProgress] = useState(0);
  const [continuousStep, setContinuousStep] = useState(initialStage);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isInteracting, setIsInteracting] = useState(false);

  const elapsedMsRef = useRef<number>((initialStage * stageDurationMs));
  const lastTimestampRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const prevStageRef = useRef<number>(initialStage);
  const onStageChangeRef = useRef(onStageChange);
  useEffect(() => {
    onStageChangeRef.current = onStageChange;
  }, [onStageChange]);

  const syncStateFromElapsed = useCallback((elapsed: number) => {
    const normElapsed = ((elapsed % totalDurationMs) + totalDurationMs) % totalDurationMs;
    const global = normElapsed / totalDurationMs;
    const stageFloat = global * stageCount;
    const stageIdx = Math.min(Math.floor(stageFloat), stageCount - 1);
    const local = stageFloat - stageIdx;

    if (stageIdx !== prevStageRef.current) {
      onStageChangeRef.current?.(stageIdx, prevStageRef.current);
      prevStageRef.current = stageIdx;
    }

    setActiveStageIndex(stageIdx);
    setGlobalProgress(global);
    setLocalProgress(local);
    setContinuousStep(stageFloat);
  }, [stageCount, totalDurationMs]);

  // Main continuous animation loop
  useEffect(() => {
    if (reducedMotion || !isPlaying || isInteracting) {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      lastTimestampRef.current = null;
      return;
    }

    const tick = (timestamp: number) => {
      if (lastTimestampRef.current !== null) {
        const delta = Math.min(timestamp - lastTimestampRef.current, 100);
        elapsedMsRef.current = (elapsedMsRef.current + delta) % totalDurationMs;
        syncStateFromElapsed(elapsedMsRef.current);
      }
      lastTimestampRef.current = timestamp;
      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isPlaying, isInteracting, reducedMotion, syncStateFromElapsed, totalDurationMs]);

  // Handle tab visibility change to pause rAF and avoid time skips
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        lastTimestampRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const seekToStage = useCallback((stageIndex: number, autoResume = true) => {
    const clampedIndex = Math.max(0, Math.min(stageCount - 1, stageIndex));
    const targetElapsed = clampedIndex * stageDurationMs;
    elapsedMsRef.current = targetElapsed;
    lastTimestampRef.current = null;
    syncStateFromElapsed(targetElapsed);
    if (autoResume) {
      setIsPlaying(true);
    }
  }, [stageCount, stageDurationMs, syncStateFromElapsed]);

  const seekToProgress = useCallback((progress: number) => {
    const clampedProgress = Math.max(0, Math.min(0.999999, progress));
    const targetElapsed = clampedProgress * totalDurationMs;
    elapsedMsRef.current = targetElapsed;
    lastTimestampRef.current = null;
    syncStateFromElapsed(targetElapsed);
  }, [syncStateFromElapsed, totalDurationMs]);

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
    lastTimestampRef.current = null;
  }, []);

  const setInteracting = useCallback((interacting: boolean) => {
    setIsInteracting(interacting);
    lastTimestampRef.current = null;
  }, []);

  const stepNext = useCallback(() => {
    seekToStage((activeStageIndex + 1) % stageCount);
  }, [activeStageIndex, seekToStage, stageCount]);

  const stepPrev = useCallback(() => {
    seekToStage((activeStageIndex - 1 + stageCount) % stageCount);
  }, [activeStageIndex, seekToStage, stageCount]);

  return [
    {
      activeStageIndex,
      globalProgress,
      localProgress,
      continuousStep,
      isPlaying,
      isInteracting,
    },
    {
      seekToStage,
      seekToProgress,
      togglePlay,
      setInteracting,
      stepNext,
      stepPrev,
    },
  ];
}
