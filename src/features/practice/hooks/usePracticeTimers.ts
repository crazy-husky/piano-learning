import { useCallback, useRef, type MutableRefObject } from "react";
import type { FocusLoss } from "../../../domain/types";

export interface PracticePromptTimerState {
  activeBaseMs: number;
  activeStartedAt: number | null;
  focusLosses: FocusLoss[];
  lastInputAt: number;
}

export interface PracticeTimers {
  getPromptActiveMs: () => number;
  getPromptInactiveMs: () => number;
  getSessionActiveMs: () => number;
  markPromptInput: () => void;
  pauseActiveTimers: () => void;
  resetSessionActiveTimer: (startPaused: boolean) => void;
  resumeActiveTimers: () => void;
}

export function usePracticeTimers<TPrompt extends PracticePromptTimerState>(
  promptRef: MutableRefObject<TPrompt | null>,
): PracticeTimers {
  const sessionActiveBaseMsRef = useRef(0);
  const sessionActiveStartedAtRef = useRef<number | null>(null);

  const getPromptActiveMs = useCallback((): number => {
    const prompt = promptRef.current;
    if (!prompt) return 0;
    const running = prompt.activeStartedAt === null ? 0 : performance.now() - prompt.activeStartedAt;
    return Math.round(prompt.activeBaseMs + running);
  }, [promptRef]);

  const getPromptInactiveMs = useCallback((): number => {
    const prompt = promptRef.current;
    return prompt ? performance.now() - prompt.lastInputAt : 0;
  }, [promptRef]);

  const getSessionActiveMs = useCallback((): number => {
    const running = sessionActiveStartedAtRef.current === null
      ? 0
      : performance.now() - sessionActiveStartedAtRef.current;
    return Math.round(sessionActiveBaseMsRef.current + running);
  }, []);

  const markPromptInput = useCallback((): void => {
    const prompt = promptRef.current;
    if (prompt) prompt.lastInputAt = performance.now();
  }, [promptRef]);

  const pauseActiveTimers = useCallback((): void => {
    const now = performance.now();
    const prompt = promptRef.current;
    if (prompt?.activeStartedAt !== null && prompt?.activeStartedAt !== undefined) {
      prompt.activeBaseMs += now - prompt.activeStartedAt;
      prompt.activeStartedAt = null;
    }
    if (sessionActiveStartedAtRef.current !== null) {
      sessionActiveBaseMsRef.current += now - sessionActiveStartedAtRef.current;
      sessionActiveStartedAtRef.current = null;
    }
  }, [promptRef]);

  const resetSessionActiveTimer = useCallback((startPaused: boolean): void => {
    sessionActiveBaseMsRef.current = 0;
    sessionActiveStartedAtRef.current = startPaused ? null : performance.now();
  }, []);

  const resumeActiveTimers = useCallback((): void => {
    const now = performance.now();
    const prompt = promptRef.current;
    if (prompt && prompt.activeStartedAt === null) {
      const lastLoss = prompt.focusLosses[prompt.focusLosses.length - 1];
      if (lastLoss && !lastLoss.regainedFocusAt) {
        lastLoss.regainedFocusAt = new Date().toISOString();
      }
      prompt.activeStartedAt = now;
      prompt.lastInputAt = now;
    }
    if (sessionActiveStartedAtRef.current === null) {
      sessionActiveStartedAtRef.current = now;
    }
  }, [promptRef]);

  return {
    getPromptActiveMs,
    getPromptInactiveMs,
    getSessionActiveMs,
    markPromptInput,
    pauseActiveTimers,
    resetSessionActiveTimer,
    resumeActiveTimers,
  };
}
