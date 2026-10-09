import { useCallback, useState } from "react";
import type { PracticeSessionRecord, ReviewRecord, TargetNote } from "../domain/types";

export type PracticePhase = "setup" | "running" | "summary";

export interface PracticeSessionSummary {
  session: PracticeSessionRecord;
  reviews: ReviewRecord[];
}

export function usePracticeSessionState() {
  const [phase, setPhase] = useState<PracticePhase>("setup");
  const [session, setSession] = useState<PracticeSessionRecord | null>(null);
  const [currentNote, setCurrentNote] = useState<TargetNote | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [wrongAnswerCount, setWrongAnswerCount] = useState(0);
  const [summary, setSummary] = useState<PracticeSessionSummary | null>(null);

  const beginSessionState = useCallback((nextSession: PracticeSessionRecord): void => {
    setSession(nextSession);
    setCompletedCount(0);
    setWrongAnswerCount(0);
    setSummary(null);
    setPhase("running");
  }, []);

  const finishSessionState = useCallback((input: {
    finalSession: PracticeSessionRecord;
    reviews: ReviewRecord[];
    shouldKeepSession: boolean;
    showSummary: boolean;
  }): void => {
    setSession(input.shouldKeepSession ? input.finalSession : null);
    setSummary(input.shouldKeepSession && input.showSummary
      ? { session: input.finalSession, reviews: input.reviews }
      : null);
    setCurrentNote(null);
    setPhase(input.shouldKeepSession && input.showSummary ? "summary" : "setup");
  }, []);

  return {
    beginSessionState,
    completedCount,
    currentNote,
    finishSessionState,
    phase,
    session,
    setCompletedCount,
    setCurrentNote,
    setPhase,
    setSession,
    setSummary,
    setWrongAnswerCount,
    summary,
    wrongAnswerCount,
  };
}
