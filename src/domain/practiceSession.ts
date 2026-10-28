import { isCompletedReview, isStatisticalReview } from "./reviews";
import type { PracticeSessionRecord, ReviewRecord } from "./types";

type PracticeSessionScope = Pick<PracticeSessionRecord, "drillNoteNames" | "queueStrategy"> & {
  startSnapshot?: {
    practiceConfig: { duetDifficulty?: string; duetLevel?: string };
  };
};

function isDuetPracticeSession(session: PracticeSessionScope): boolean {
  return (
    session.startSnapshot?.practiceConfig.duetDifficulty !== undefined ||
    session.startSnapshot?.practiceConfig.duetLevel !== undefined
  );
}

export function isSingleNoteNameDrill(session: PracticeSessionScope): boolean {
  return session.queueStrategy === "note-drill" && (session.drillNoteNames?.length ?? 1) <= 1;
}

// Single-note-name drills create ignored reviews only as in-session activity; they are not persisted as long-term reviews.
export function shouldIgnoreReviewForSession(session: PracticeSessionScope): boolean {
  return !isDuetPracticeSession(session) && isSingleNoteNameDrill(session);
}

export function shouldKeepPracticeSession(
  session: PracticeSessionScope,
  reviews: ReviewRecord[]
): boolean {
  if (isSingleNoteNameDrill(session) && !isDuetPracticeSession(session)) {
    return reviews.some(isCompletedReview);
  }
  return reviews.some(isStatisticalReview);
}
