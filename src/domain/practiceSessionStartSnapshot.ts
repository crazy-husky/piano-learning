import { applicableLedgerSetting } from "./staffNotation";
import { normalizeAnswerPitchMode } from "./answerInput";
import { buildPracticeActivitySnapshot } from "./practiceComparison";
import type {
  AppSettings,
  PracticeMode,
  PracticeSessionRecordV4,
  PracticeSessionRecordV5,
  PracticeSessionStartSnapshot,
  DuetPracticeLevel,
  TargetNote,
} from "./types";

export interface BuildPracticeSessionStartSnapshotInput {
  autoPlayTarget: boolean;
  mode: PracticeMode;
  prefersReducedMotion: boolean;
  settings: AppSettings;
  smoothStaffPageScroll: boolean;
  startPausedReading: boolean;
  duetLevel?: DuetPracticeLevel;
  duetCurriculumVersion?: number;
  duetAllowDottedRhythms?: boolean;
  metronomeSync?: boolean;
}

export interface BuiltPracticeSessionStartSnapshot {
  notes: TargetNote[];
  snapshot: PracticeSessionStartSnapshot;
}

export function buildPracticeSessionRecordV4({
  id,
  snapshot,
  startedAt,
}: {
  id: string;
  snapshot: PracticeSessionStartSnapshot;
  startedAt: string;
}): PracticeSessionRecordV4 {
  const { practiceConfig, presentationConfig } = snapshot;
  return {
    completedCount: 0,
    answerPitchMode: normalizeAnswerPitchMode(practiceConfig.answerPitchMode),
    drillNoteNames: [...practiceConfig.drillNoteNames],
    effectiveQueueAlgorithm: practiceConfig.effectiveQueueAlgorithm,
    enabledGroupIds: [...practiceConfig.enabledGroupIds],
    fixedCount: practiceConfig.fixedCount,
    fixedDurationSeconds: practiceConfig.fixedDurationSeconds,
    focusedTraining: practiceConfig.queueStrategy === "focused",
    id,
    includeInterStaffLedgerSpellings: practiceConfig.includeInterStaffLedgerSpellings,
    interruptedCount: 0,
    mode: practiceConfig.mode,
    promptDisplayMode: presentationConfig.promptDisplayMode,
    promptNoteDuration: presentationConfig.promptNoteDuration,
    queueStrategy: practiceConfig.queueStrategy,
    schemaVersion: 4,
    staffNotationMode: practiceConfig.staffNotationMode,
    startSnapshot: snapshot,
    startedAt,
    targetNoteSetKey: practiceConfig.targetNoteSetKey,
  };
}

export function buildPracticeSessionRecordV5({
  id,
  snapshot,
  startedAt,
}: {
  id: string;
  snapshot: PracticeSessionStartSnapshot;
  startedAt: string;
}): PracticeSessionRecordV5 {
  const session = buildPracticeSessionRecordV4({ id, snapshot, startedAt });
  return { ...session, schemaVersion: 5 };
}

export function buildPracticeSessionStartSnapshot({
  autoPlayTarget,
  mode,
  prefersReducedMotion,
  settings,
  smoothStaffPageScroll,
  startPausedReading,
  duetLevel,
  duetCurriculumVersion,
  duetAllowDottedRhythms,
  metronomeSync,
}: BuildPracticeSessionStartSnapshotInput): BuiltPracticeSessionStartSnapshot | undefined {
  const activity = buildPracticeActivitySnapshot({
    answerPitchMode: settings.answerPitchMode,
    crossGroupPitchIds: settings.crossGroupPitchIds,
    drillNoteNames: settings.drillNoteNames,
    enabledGroupIds: settings.enabledGroupIds,
    enabledPitchIds: settings.enabledPitchIds,
    includeInterStaffLedgerSpellings: settings.includeInterStaffLedgerSpellings,
    promptDisplayMode: settings.promptDisplayMode,
    promptNoteDuration: settings.promptNoteDuration,
    queueStrategy: settings.queueStrategy,
    staffNotationMode: settings.staffNotationMode,
  });
  if (!activity) {
    return undefined;
  }

  return {
    notes: activity.notes,
    snapshot: {
      practiceConfig: {
        answerPitchMode: settings.answerPitchMode,
        crossGroupPitchIds: settings.crossGroupPitchIds
          ? [...settings.crossGroupPitchIds]
          : undefined,
        drillNoteNames: [...settings.drillNoteNames],
        effectiveQueueAlgorithm: activity.effectiveQueueAlgorithm,
        enabledGroupIds: [...settings.enabledGroupIds],
        enabledPitchIds: settings.enabledPitchIds ? [...settings.enabledPitchIds] : undefined,
        fixedCount: mode === "fixed-count" ? settings.fixedCount : undefined,
        fixedDurationSeconds: mode === "fixed-duration" ? settings.fixedDurationSeconds : undefined,
        includeInterStaffLedgerSpellings: applicableLedgerSetting(
          settings.staffNotationMode,
          settings.includeInterStaffLedgerSpellings
        ),
        mode,
        queueStrategy: settings.queueStrategy,
        staffNotationMode: settings.staffNotationMode,
        targetNoteSetKey: activity.targetNoteSetKey,
        ...(duetLevel
          ? {
              duetLevel,
              duetCurriculumVersion: duetCurriculumVersion ?? 2,
              duetAllowDottedRhythms: duetAllowDottedRhythms ?? false,
            }
          : {}),
        ...(metronomeSync ? { metronomeSync: true } : {}),
      },
      presentationConfig: {
        autoPlayTarget,
        playAnswerNote: settings.playAnswerNote,
        promptDisplayMode: settings.promptDisplayMode,
        promptNoteDuration: settings.promptNoteDuration,
        ...(settings.promptNoteDurations && settings.promptNoteDurations.length > 1
          ? { promptNoteDurations: [...settings.promptNoteDurations] }
          : {}),
        smoothStaffPageScroll,
        startPausedReading,
      },
      interactionConfig: {
        correctDelayMs: settings.correctDelayMs,
        inactivityThresholdSeconds: settings.inactivityThresholdSeconds,
        pianoVolume: settings.pianoVolume,
      },
      environment: {
        prefersReducedMotion,
      },
    },
  };
}
