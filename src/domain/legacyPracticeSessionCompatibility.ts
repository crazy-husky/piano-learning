import {
  buildPracticeComparisonSnapshot,
  type PracticeComparisonSnapshot,
} from "./practiceComparison";
import { normalizeAnswerPitchMode } from "./answerInput";
import type { PracticeSessionRecord, PracticeSessionRecordV1 } from "./types";

function deriveV1PracticeComparisonSnapshot(
  session: PracticeSessionRecordV1
): PracticeComparisonSnapshot | undefined {
  if (
    session.promptDisplayMode === undefined ||
    session.includeLedgerVariants === undefined ||
    session.queueStrategy === undefined ||
    (session.queueStrategy === "note-drill" && session.drillNoteNames === undefined)
  ) {
    return undefined;
  }
  return buildPracticeComparisonSnapshot({
    drillNoteNames: session.drillNoteNames ?? [],
    enabledGroupIds: session.enabledGroupIds,
    includeInterStaffLedgerSpellings: session.includeLedgerVariants,
    promptDisplayMode: session.promptDisplayMode,
    promptNoteDuration: "quarter",
    queueStrategy: session.queueStrategy,
    staffNotationMode: "grand",
  });
}

export function getPracticeSessionComparisonSnapshot(
  session: PracticeSessionRecord
): PracticeComparisonSnapshot | undefined {
  if (session.schemaVersion === 3 || session.schemaVersion === 4 || session.schemaVersion === 5) {
    const { practiceConfig } = session.startSnapshot;
    const duet =
      practiceConfig.duetLevel !== undefined || practiceConfig.duetDifficulty !== undefined;
    return {
      answerPitchMode: normalizeAnswerPitchMode(practiceConfig.answerPitchMode),
      effectiveQueueAlgorithm: practiceConfig.effectiveQueueAlgorithm,
      practiceMode: duet ? "duet" : "single-hand",
      ...(practiceConfig.duetDifficulty ? { duetDifficulty: practiceConfig.duetDifficulty } : {}),
      ...(practiceConfig.duetLevel ? { duetLevel: practiceConfig.duetLevel } : {}),
      ...(practiceConfig.duetCurriculumVersion !== undefined
        ? { duetCurriculumVersion: practiceConfig.duetCurriculumVersion }
        : {}),
      ...(practiceConfig.duetAllowDottedRhythms !== undefined
        ? { duetAllowDottedRhythms: practiceConfig.duetAllowDottedRhythms }
        : {}),
      ...(practiceConfig.metronomeSync !== undefined
        ? { metronomeSync: practiceConfig.metronomeSync }
        : {}),
      promptDisplayMode: session.startSnapshot.presentationConfig.promptDisplayMode,
      promptNoteDuration: session.startSnapshot.presentationConfig.promptNoteDuration,
      targetNoteSetKey: practiceConfig.targetNoteSetKey,
    };
  }
  if (session.schemaVersion === 2) {
    return {
      answerPitchMode: "note-name",
      effectiveQueueAlgorithm: session.effectiveQueueAlgorithm,
      practiceMode: "single-hand",
      promptDisplayMode: session.promptDisplayMode,
      promptNoteDuration: "quarter",
      targetNoteSetKey: session.targetNoteSetKey,
    };
  }
  return deriveV1PracticeComparisonSnapshot(session);
}
