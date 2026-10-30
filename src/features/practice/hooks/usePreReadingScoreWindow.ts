import { useCallback, useEffect, useRef, useState } from "react";
import type { PreReadingBufferSize } from "../../../domain/types";

const NOTE_CAPTURE_MS = 600;

export function getPreReadingPreparationDurationSeconds(bufferSize: PreReadingBufferSize): number {
  return Math.max(3, bufferSize);
}

export type PreReadingNoteVisibility = "clear" | "obscured" | "played";
export type PreReadingWindowPhase = "idle" | "opening" | "training";

interface CaptureWindow {
  stage: "capture" | "obscured";
  remainingMs: number;
  startedAt: number | null;
  timeoutId: number | null;
}

interface UsePreReadingScoreWindowOptions {
  bufferSize: PreReadingBufferSize;
  canStartTraining: boolean;
  currentNoteIndex: number;
  enabled: boolean;
  isPaused: boolean;
  notesReady: boolean;
  sessionId?: string;
}

export function usePreReadingScoreWindow({
  bufferSize,
  canStartTraining,
  currentNoteIndex,
  enabled,
  isPaused,
  notesReady,
  sessionId,
}: UsePreReadingScoreWindowOptions): {
  getNoteVisibility: (noteIndex: number) => PreReadingNoteVisibility;
  openingSecondsRemaining: number;
  phase: PreReadingWindowPhase;
} {
  const openingPreviewMs = getPreReadingPreparationDurationSeconds(bufferSize) * 1000;
  const [openingComplete, setOpeningComplete] = useState(false);
  const [openingRemainingMs, setOpeningRemainingMs] = useState(openingPreviewMs);
  const [, setCaptureRevision] = useState(0);
  const activeSessionIdRef = useRef<string | null>(null);
  const openingRemainingMsRef = useRef(openingPreviewMs);
  const openingCompleteRef = useRef(false);
  const pausedRef = useRef(isPaused);
  const phaseRef = useRef<PreReadingWindowPhase>("idle");
  const capturesRef = useRef(new Map<number, CaptureWindow>());
  const lastBufferCurrentIndexRef = useRef<number | null>(null);

  pausedRef.current = isPaused;

  const pauseCaptures = useCallback((): void => {
    const now = performance.now();
    capturesRef.current.forEach((capture) => {
      if (capture.timeoutId !== null) {
        window.clearTimeout(capture.timeoutId);
        capture.timeoutId = null;
        if (capture.startedAt !== null) {
          capture.remainingMs = Math.max(0, capture.remainingMs - (now - capture.startedAt));
        }
        capture.startedAt = null;
      }
    });
  }, []);

  const armCapture = useCallback((capture: CaptureWindow): void => {
    if (
      pausedRef.current ||
      capture.remainingMs <= 0 ||
      capture.timeoutId !== null ||
      phaseRef.current !== "training"
    ) {
      return;
    }
    capture.startedAt = performance.now();
    capture.timeoutId = window.setTimeout(() => {
      capture.timeoutId = null;
      capture.startedAt = null;
      capture.stage = "obscured";
      capture.remainingMs = 0;
      setCaptureRevision((revision) => revision + 1);
    }, capture.remainingMs);
  }, []);

  const addCapture = useCallback(
    (noteIndex: number): void => {
      if (capturesRef.current.has(noteIndex)) return;
      const capture: CaptureWindow = {
        stage: "capture",
        remainingMs: NOTE_CAPTURE_MS,
        startedAt: null,
        timeoutId: null,
      };
      capturesRef.current.set(noteIndex, capture);
      armCapture(capture);
      setCaptureRevision((revision) => revision + 1);
    },
    [armCapture]
  );

  useEffect(() => {
    if (!enabled || !sessionId) {
      activeSessionIdRef.current = null;
      openingRemainingMsRef.current = openingPreviewMs;
      openingCompleteRef.current = false;
      capturesRef.current.clear();
      lastBufferCurrentIndexRef.current = null;
      phaseRef.current = "idle";
      setOpeningComplete(false);
      setOpeningRemainingMs(openingPreviewMs);
      setCaptureRevision((revision) => revision + 1);
      return;
    }
    if (activeSessionIdRef.current === sessionId) return;

    activeSessionIdRef.current = sessionId;
    openingRemainingMsRef.current = openingPreviewMs;
    openingCompleteRef.current = false;
    capturesRef.current.clear();
    lastBufferCurrentIndexRef.current = null;
    phaseRef.current = "opening";
    setOpeningComplete(false);
    setOpeningRemainingMs(openingPreviewMs);
    setCaptureRevision((revision) => revision + 1);
  }, [enabled, openingPreviewMs, sessionId]);

  useEffect(() => {
    if (!enabled || !sessionId || !notesReady || isPaused || openingCompleteRef.current) {
      return undefined;
    }

    const remainingAtStart = openingRemainingMsRef.current;
    const startedAt = performance.now();
    const timeoutId = window.setTimeout(() => {
      openingRemainingMsRef.current = 0;
      openingCompleteRef.current = true;
      setOpeningRemainingMs(0);
      setOpeningComplete(true);
    }, remainingAtStart);
    const intervalId = window.setInterval(() => {
      const remaining = Math.max(0, remainingAtStart - (performance.now() - startedAt));
      const nextSeconds = Math.ceil(remaining / 1000);
      setOpeningRemainingMs((current) =>
        Math.ceil(current / 1000) === nextSeconds ? current : remaining
      );
    }, 150);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      if (!openingCompleteRef.current) {
        openingRemainingMsRef.current = Math.max(
          0,
          remainingAtStart - (performance.now() - startedAt)
        );
      }
    };
  }, [enabled, isPaused, notesReady, openingComplete, sessionId]);

  const sessionInitialized =
    enabled && sessionId !== undefined && activeSessionIdRef.current === sessionId;
  const phase: PreReadingWindowPhase =
    !enabled || !sessionId
      ? "idle"
      : sessionInitialized && openingComplete && canStartTraining
        ? "training"
        : "opening";
  phaseRef.current = phase;

  useEffect(() => {
    if (phase !== "training") {
      pauseCaptures();
      lastBufferCurrentIndexRef.current = null;
      return;
    }
    if (isPaused) {
      pauseCaptures();
      return;
    }

    capturesRef.current.forEach(armCapture);
    const previousCurrentIndex = lastBufferCurrentIndexRef.current;
    if (previousCurrentIndex === null) {
      for (let index = currentNoteIndex + 1; index <= currentNoteIndex + bufferSize; index += 1) {
        addCapture(index);
      }
    } else if (currentNoteIndex > previousCurrentIndex) {
      for (
        let index = previousCurrentIndex + bufferSize + 1;
        index <= currentNoteIndex + bufferSize;
        index += 1
      ) {
        addCapture(index);
      }
      for (const [index, capture] of capturesRef.current) {
        if (index < currentNoteIndex) {
          if (capture.timeoutId !== null) window.clearTimeout(capture.timeoutId);
          capturesRef.current.delete(index);
        }
      }
    }
    lastBufferCurrentIndexRef.current = currentNoteIndex;
  }, [
    addCapture,
    armCapture,
    bufferSize,
    currentNoteIndex,
    isPaused,
    pauseCaptures,
    phase,
    sessionId,
  ]);

  useEffect(
    () => () => {
      pauseCaptures();
      capturesRef.current.clear();
    },
    [pauseCaptures]
  );

  const getNoteVisibility = useCallback(
    (noteIndex: number): PreReadingNoteVisibility => {
      // Keep the initial overview clear. Once it has finished, preserve the
      // current blur states while a paused synchronized session counts in again.
      if (!sessionInitialized || !openingComplete) return "clear";
      const capture = capturesRef.current.get(noteIndex);
      const isPast = noteIndex < currentNoteIndex;
      const isWithinBuffer = noteIndex <= currentNoteIndex + bufferSize;
      // The opening notes can pass before they ever enter the preview buffer.
      // Keep every passed note lightly blurred, even when it has no capture entry.
      if (isPast) return "played";
      if (capture?.stage === "obscured") {
        if (isWithinBuffer) return "obscured";
      }
      if (isWithinBuffer) return "clear";
      return "clear";
    },
    [bufferSize, currentNoteIndex, openingComplete, sessionInitialized]
  );

  return {
    getNoteVisibility,
    openingSecondsRemaining: Math.ceil(openingRemainingMs / 1000),
    phase,
  };
}
