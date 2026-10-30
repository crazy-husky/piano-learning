import type { VocalAudioCounts } from "./vocalPitch";

export type NoteName = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type PianoKeyName = NoteName | "C#" | "D#" | "F#" | "G#" | "A#";
export type Octave = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Staff = "treble" | "bass";
export type StaffNotationMode = "treble-only" | "bass-only" | "grand";
export type PitchId = `${NoteName}${Octave}`;
export type TargetNoteId = PitchId | `${PitchId}-${Staff}`;

export type PracticeMode = "open-ended" | "fixed-count" | "fixed-duration";
export type AnswerPitchMode = "note-name" | "exact-pitch" | "microphone";
export type StoredAnswerPitchMode = AnswerPitchMode | "absolute-pitch";
export type PracticeQueueStrategy = "adaptive" | "focused" | "melody" | "note-drill";
export type PromptDisplayMode = "single-note" | "staff-page";
export type PromptNoteDuration = "whole" | "quarter" | "eighth" | "sixteenth";
export type DuetPracticeLevel =
  "level-1" | "level-2" | "level-3" | "level-4" | "level-5" | "level-6";
export type EffectiveQueueAlgorithm =
  "adaptive-v1" | "adaptive-v2" | "focused-v1" | "melody-v1" | "melody-v2";
export type QueueComparisonFamily = "adaptive" | "melody-v1" | "melody-v2";
export type StaffDistanceDirection = "up" | "down" | "same";
export type StaffDistanceTrainingMode = "look" | "play";
export type StaffDistanceInputMethod = "midi" | "microphone";
export interface StaffDistancePracticeSettings {
  includeUnison: boolean;
  maxDistance: number;
}

export interface StaffRangeSelection {
  enabledGroupIds: PracticeGroupId[];
  enabledPitchIds?: PitchId[];
  crossGroupPitchIds?: PitchId[];
}
export type SessionEndReason =
  "manual-stop" | "completed-count" | "completed-duration" | "abandoned";
export type InterruptReason =
  | "focus-lost"
  | "inactive-timeout"
  | "manual-pause"
  | "midi-disconnected"
  | "microphone-disconnected"
  | "manual-stop"
  | "duration-ended"
  | "session-abandoned";

export interface TargetNote {
  id: TargetNoteId;
  pitchId: PitchId;
  noteName: NoteName;
  accidental?: "sharp" | "flat";
  octave: Octave;
  groupId: PracticeGroupId;
  staff: Staff;
  isInterStaffLedgerSpelling: boolean;
}

export type CurrentPracticeGroupId = "C2-B2" | "C3-B3" | "C4-B4" | "C5-B5" | "C6-B6";
export type LegacyPracticeGroupId = "F1-F2" | "G2-F3" | "G3-F4" | "G4-F5" | "G5-G6";
export type PracticeGroupId = CurrentPracticeGroupId | LegacyPracticeGroupId;

export interface PracticeGroup {
  id: CurrentPracticeGroupId;
  label: string;
  notes: TargetNote[];
}

export interface WrongAnswer {
  noteName: NoteName;
  atActiveMs: number;
  /** The outstanding duet target this wrong input was closest to; null means unassigned. */
  duetTargetNoteId?: TargetNoteId | null;
  midiNoteNumber?: number;
  confidence?: number;
  clipping?: boolean;
  inputMode?: AnswerInputMode;
  microphoneAlgorithm?: "swiftf0" | "yin";
}

export interface FocusLoss {
  lostFocusAt: string;
  regainedFocusAt?: string;
}

export interface ReviewRecord {
  id: string;
  schemaVersion: 1;
  sessionId: string;
  targetNoteId: TargetNoteId;
  groupId: PracticeGroupId;
  noteName: NoteName;
  octave: Octave;
  startedAt: string;
  endedAt: string;
  answeredAt?: string;
  answeredCorrectly: boolean;
  interrupted: boolean;
  interruptReason?: InterruptReason;
  activeMs: number;
  wrongAnswers: WrongAnswer[];
  /** True when a simultaneous-note prompt timed out without being completed. */
  wasMissed?: boolean;
  /** Both note ids for a simultaneous-note prompt; targetNoteId remains the treble-side anchor. */
  duetTargetNoteIds?: TargetNoteId[];
  /** Target notes already completed when a duet prompt timed out. */
  duetCompletedTargetNoteIds?: TargetNoteId[];
  replayCount: number;
  focusLosses: FocusLoss[];
  ignored?: boolean;
}

export type AnswerEventMode =
  "free-practice" | "staff-game" | "song" | "staff-distance" | "name-to-key" | "staff-to-name";
export type AnswerInputMode = "microphone" | "midi" | "virtual-keyboard" | "computer-keyboard";
export type StaffGameChallengeMode = "learning" | "arcade";
export type DuetPracticeDifficulty = "sync" | "parallel" | "independent";

/** Canonical per-prompt answer record. Attempts are capped by the writer. */
export interface AnswerEvent {
  id: string;
  dataSetId: string;
  sessionId: string;
  eventIndex: number;
  occurredAt: string;
  promptStartedAt?: string;
  promptEndedAt?: string;
  mode: AnswerEventMode;
  /** Challenge subtype; absent for songs, review rounds, and legacy events. */
  gameMode?: StaffGameChallengeMode | null;
  staffGameSource?: "challenge" | "review";
  inputMode: AnswerInputMode;
  deviceInfo: "Mac" | "iPad" | "iPhone" | "other";
  inputGain?: number;
  sensitivityLevel?: 1 | 2 | 3 | 4 | 5;
  microphoneAlgorithm?: "swiftf0" | "yin";
  difficulty?: string;
  duetDifficulty?: DuetPracticeDifficulty;
  duetLevel?: DuetPracticeLevel;
  targetMidi?: number;
  targetMidiHigh?: number;
  targetMidiLow?: number;
  duetTargetNoteIds?: TargetNoteId[];
  /** Target notes already completed when a duet prompt timed out. */
  duetCompletedTargetNoteIds?: TargetNoteId[];
  duetTargetMidis?: { treble: number[]; bass: number[] };
  targetNoteId?: string;
  targetGroupId?: PracticeGroupId;
  targetNoteName?: NoteName;
  targetOctave?: Octave;
  targetDisplayName?: string;
  nameToKeyConfig?: {
    includeOctaveNumbers: boolean;
    includeBlackKeys: boolean;
    randomEnharmonics: boolean;
    inputMode: AnswerInputMode;
    range: "C4-B4" | "F1-B6";
  };
  staffToNameConfig?: {
    enabledGroupIds: CurrentPracticeGroupId[];
  };
  recognizedMidi?: number;
  confidence?: number;
  attempts: AnswerAttempt[];
  isCorrectFirstTry: boolean | null;
  isCorrectFinal: boolean | null;
  rawResponseTimeMs?: number | null;
  estimatedSystemDelayMs?: number;
  responseTimeMs?: number | null;
  activeMs?: number;
  timeLimitMs?: number;
  wrongAttempts: number;
  isExtraNote: boolean;
  isMissed: boolean;
  wasInterrupted?: boolean;
  wasSkipped?: boolean;
  songId?: string;
  levelId?: string;
  staffDistance?: {
    distance: number;
    direction: StaffDistanceDirection;
    maxDistance?: number;
    trainingMode?: StaffDistanceTrainingMode;
    usedHint?: boolean;
  };
}

export interface AnswerAttempt {
  midi?: number;
  noteName?: NoteName;
  atMs: number;
  /** The outstanding duet target this wrong input was closest to; null means unassigned. */
  duetTargetNoteId?: TargetNoteId | null;
  confidence?: number;
  inputMode?: AnswerInputMode;
  microphoneAlgorithm?: "swiftf0" | "yin";
  isCorrect: boolean;
  staffDistanceAnswer?: number;
  isLateForPrevious?: boolean;
  isExtraNote?: boolean;
  clipping?: boolean;
}

interface PracticeSessionRecordBase {
  activePracticeMs?: number;
  id: string;
  practiceType?: "staff-distance";
  staffDistance?: StaffDistancePracticeSessionDetails;
  mode: PracticeMode;
  enabledGroupIds: PracticeGroupId[];
  fixedCount?: number;
  fixedDurationSeconds?: number;
  queueStrategy?: PracticeQueueStrategy;
  drillNoteNames?: NoteName[];
  focusedTraining?: boolean;
  promptDisplayMode?: PromptDisplayMode;
  startedAt: string;
  endedAt?: string;
  endReason?: SessionEndReason;
  completedCount: number;
  interruptedCount: number;
}

export interface StaffDistanceQuestionResult {
  distance: number;
  direction: StaffDistanceDirection;
  firstTryCorrect: boolean;
  responseMs: number;
  wrongAttempts: number;
  usedHint: boolean;
  targetPitchId?: PitchId;
}

export interface StaffDistancePracticeSessionDetails {
  enabledGroupIds: PracticeGroupId[];
  enabledPitchIds?: PitchId[];
  crossGroupPitchIds?: PitchId[];
  includeInterStaffLedgerSpellings: boolean;
  includeUnison: boolean;
  inputMethod?: StaffDistanceInputMethod;
  maxDistance: number;
  noteDuration?: PromptNoteDuration;
  noteDurations?: PromptNoteDuration[];
  questionResults: StaffDistanceQuestionResult[];
  staffNotationMode: StaffNotationMode;
  trainingMode?: StaffDistanceTrainingMode;
}

export interface PracticeSessionRecordV1 extends PracticeSessionRecordBase {
  schemaVersion: 1;
  includeLedgerVariants?: boolean;
}

export interface PracticeSessionRecordV2 extends PracticeSessionRecordBase {
  schemaVersion: 2;
  queueStrategy: PracticeQueueStrategy;
  drillNoteNames: NoteName[];
  promptDisplayMode: PromptDisplayMode;
  staffNotationMode: StaffNotationMode;
  targetNoteSetKey: string;
  effectiveQueueAlgorithm: EffectiveQueueAlgorithm;
  includeInterStaffLedgerSpellings?: boolean;
}

export interface PracticeSessionStartSnapshot {
  practiceConfig: {
    answerPitchMode?: StoredAnswerPitchMode;
    crossGroupPitchIds?: PitchId[];
    drillNoteNames: NoteName[];
    effectiveQueueAlgorithm: EffectiveQueueAlgorithm;
    enabledPitchIds?: PitchId[];
    enabledGroupIds: PracticeGroupId[];
    fixedCount?: number;
    fixedDurationSeconds?: number;
    includeInterStaffLedgerSpellings?: boolean;
    mode: PracticeMode;
    queueStrategy: PracticeQueueStrategy;
    staffNotationMode: StaffNotationMode;
    targetNoteSetKey: string;
    duetDifficulty?: DuetPracticeDifficulty;
    duetLevel?: DuetPracticeLevel;
    duetCurriculumVersion?: number;
    duetAllowDottedRhythms?: boolean;
    metronomeSync?: boolean;
  };
  presentationConfig: {
    autoPlayTarget: boolean;
    playAnswerNote?: boolean;
    promptDisplayMode: PromptDisplayMode;
    promptNoteDuration: PromptNoteDuration;
    promptNoteDurations?: PromptNoteDuration[];
    smoothStaffPageScroll: boolean;
    startPausedReading: boolean;
  };
  interactionConfig: {
    /** Stored only on older session snapshots; current keyboards use fixed sizing. */
    answerKeyboardScale?: number;
    correctDelayMs: number;
    inactivityThresholdSeconds: number;
    pianoVolume: number;
  };
  environment: {
    prefersReducedMotion: boolean;
  };
}

export interface PracticeSessionRecordV3 extends Omit<PracticeSessionRecordV2, "schemaVersion"> {
  schemaVersion: 3;
  promptNoteDuration: PromptNoteDuration;
  startSnapshot: PracticeSessionStartSnapshot;
}

export interface PracticeSessionRecordV4 extends Omit<PracticeSessionRecordV3, "schemaVersion"> {
  schemaVersion: 4;
  answerPitchMode: StoredAnswerPitchMode;
}

export interface PracticeSessionRecordV5 extends Omit<PracticeSessionRecordV4, "schemaVersion"> {
  schemaVersion: 5;
}

export type PracticeSessionRecord =
  | PracticeSessionRecordV1
  | PracticeSessionRecordV2
  | PracticeSessionRecordV3
  | PracticeSessionRecordV4
  | PracticeSessionRecordV5;

interface StaffRecallRunRecordBase {
  id: string;
  targetNoteIds: TargetNoteId[];
  columnOrder: NoteName[];
  columnActiveMs: Record<NoteName, number>;
  startedAt: string;
  endedAt: string;
}

export interface StaffRecallRunRecordV1 extends StaffRecallRunRecordBase {
  schemaVersion: 1;
  answerSetKey: string;
}

export interface StaffRecallRunRecordV2 extends StaffRecallRunRecordBase {
  schemaVersion: 2;
  targetNoteSetKey: string;
  enabledGroupIds: PracticeGroupId[];
  includeInterStaffLedgerSpellings?: boolean;
  staffNotationMode: StaffNotationMode;
}

export type StaffRecallRunRecord = StaffRecallRunRecordV1 | StaffRecallRunRecordV2;

export type StaffGameWrongNoteArchiveSource = "challenge" | "review";

export interface StaffGameWrongNoteNoteStats {
  midi: number;
  note: string;
  appear: number;
  correct: number;
  wrong: number;
  missed: number;
  confusions: Record<string, number>;
  /** Latest wrong-input or missed-bubble time for this note in this run. */
  lastErrorAt?: string;
  /** Sum of positive reaction times for first-input-correct targets in marked runs. */
  totalResponseMs?: number;
  /** Number of positive first-input-correct reaction samples; optional for legacy archives. */
  responseSampleCount?: number;
}

export interface StaffGameWrongNoteArchiveRun {
  runId: string;
  source: StaffGameWrongNoteArchiveSource;
  /** Challenge subtype; absent for review runs and legacy archives. */
  gameMode?: StaffGameChallengeMode;
  level: number | null;
  difficulty: string;
  inputMode: string;
  startedAt: string;
  endedAt: string;
  /** Missing on archives created before updatedAt was introduced. */
  updatedAt?: string;
  /** Review pool range; null for challenges, missing on legacy runs. */
  reviewRange?: 3 | 7 | 15 | 30 | "all" | null;
  /** Challenge note pool scope; null for reviews and missing on legacy runs. */
  notePoolScope?: "current-group" | "all-history" | "all-history-current-clef" | null;
  /** Review uses its dedicated weighted bag; missing on legacy runs. */
  noteSchedulingStrategy?: "random" | "system" | "review-weighted";
  /** Performance-only rows are excluded from wrong-note study, comparison, and management. */
  trendOnly?: boolean;
  /** Response samples are valid only for targets answered correctly on the first input. */
  responseTimeBasis?: "first-correct";
  totalTargets: number;
  firstTryCorrect: number;
  lowSample: boolean;
  notes: Record<string, StaffGameWrongNoteNoteStats>;
}

/** One daily archive row. Its id and date are the local YYYY-MM-DD key. */
export interface StaffGameWrongNoteArchive {
  id: string;
  date: string;
  runs: StaffGameWrongNoteArchiveRun[];
}

/** Independent per-target reaction sample; never merged into wrong-note archives. */
export interface StaffGameProficiencySample {
  id: string;
  dataSetId: string;
  runId: string;
  date: string;
  startedAt: string;
  endedAt: string;
  midi: number;
  note: string;
  inputMode: "microphone" | "midi" | "virtual-keyboard";
  sensitivityLevel: 1 | 2 | 3 | 4 | 5;
  microphoneAlgorithm?: "swiftf0" | "yin";
  rawResponseTimeMs: number | null;
  estimatedSystemDelayMs: number;
  playerResponseTimeMs: number | null;
  firstInputCorrect: boolean | null;
  missed: boolean;
  wasInterrupted?: boolean;
  inputGain?: number;
  deviceInfo?: AnswerEvent["deviceInfo"];
  mode?: "staff-game" | "song";
  /** Challenge subtype; absent for songs, review rounds, and legacy samples. */
  gameMode?: StaffGameChallengeMode | null;
  levelId?: string;
  songId?: string;
  attempts?: AnswerAttempt[];
  difficulty?: string;
  timeLimitMs?: number;
  staffGameSource?: "challenge" | "review";
}

export type StaffGameProficiencySampleDraft = Omit<StaffGameProficiencySample, "dataSetId">;

interface AppSettingsBase {
  id: "default";
  dataSetId: string;
  createdAt: string;
  firstReviewAt?: string;
  crossGroupPitchIds?: PitchId[];
  staffRangeProfiles?: Partial<Record<StaffNotationMode, StaffRangeSelection>>;
  enabledGroupIds: PracticeGroupId[];
  enabledPitchIds?: PitchId[];
  answerPitchMode: AnswerPitchMode;
  defaultMode: PracticeMode;
  promptDisplayMode: PromptDisplayMode;
  promptNoteDuration: PromptNoteDuration;
  promptNoteDurations?: PromptNoteDuration[];
  fixedCount: number;
  fixedDurationSeconds: number;
  autoPlayTarget: boolean;
  playAnswerNote: boolean;
  includeInterStaffLedgerSpellings: boolean;
  pianoVolume: number;
  queueStrategy: PracticeQueueStrategy;
  drillNoteNames: NoteName[];
  focusedTraining?: boolean;
  inactivityThresholdSeconds: number;
  correctDelayMs: number;
}

export interface AppSettingsV1 extends Partial<
  Omit<AppSettingsBase, "id" | "dataSetId" | "createdAt" | "includeInterStaffLedgerSpellings">
> {
  id: "default";
  schemaVersion: 1;
  dataSetId: string;
  createdAt: string;
  includeLedgerVariants?: boolean;
}

export interface AppSettings extends AppSettingsBase {
  schemaVersion: 2;
  staffNotationMode: StaffNotationMode;
}

export type StoredAppSettings =
  | AppSettingsV1
  | (Omit<AppSettings, "answerPitchMode"> & { answerPitchMode: StoredAnswerPitchMode });

export interface BackupState {
  id: "default";
  schemaVersion: 1;
  directoryHandle?: FileSystemDirectoryHandle;
  directoryName?: string;
  dataConflictBeforeBackup?: boolean;
  syncRequiredBeforeBackup?: boolean;
  conflictBrowserModifiedAt?: string;
  conflictBackupModifiedAt?: string;
  conflictBrowserFirstReviewAt?: string;
  conflictBrowserLastReviewAt?: string;
  conflictBrowserReviewCount?: number;
  conflictBackupFirstReviewAt?: string;
  conflictBackupLastReviewAt?: string;
  conflictBackupReviewCount?: number;
  conflictBrowserFirstDataAt?: string;
  conflictBrowserLastDataAt?: string;
  conflictBrowserRecordCount?: number;
  conflictBrowserStaffRecallRunCount?: number;
  conflictBrowserVocalAudioCounts?: VocalAudioCounts;
  conflictLearningData?: boolean;
  conflictVocalAudio?: boolean;
  conflictRevision?: {
    backupLearningDataDigest?: string;
    backupVersion?: string;
    backupVocalAudioLibraryDigest: string;
    browserLearningDataDigest: string;
    browserVocalAudioLibraryDigest: string;
  };
  conflictBackupFirstDataAt?: string;
  conflictBackupLastDataAt?: string;
  conflictBackupRecordCount?: number;
  conflictBackupStaffRecallRunCount?: number;
  conflictBackupVocalAudioCounts?: VocalAudioCounts;
  lastSeenBackupVersion?: string;
  lastSeenBackupDataSetId?: string;
  lastSeenBackupDayFileDigests?: Record<string, string>;
  lastSeenBackupDayFileMetadata?: Record<string, BackupDayFileMetadata>;
  lastSeenLearningDataDigest?: string;
  lastSeenVocalAudioLibraryDigest?: string;
  lastSeenVocalAudioFileMetadata?: Record<string, BackupDayFileMetadata>;
  backupDataModifiedAt?: string;
  lastBackupAt?: string;
  lastBackupReviewId?: string;
  lastError?: string;
}

export interface BackupDayFileMetadata {
  size: number;
  lastModified: number;
}

export interface BackupManifest {
  schemaVersion: 1;
  snapshotId?: string;
  dataSetId: string;
  createdAt: string;
  firstReviewAt?: string;
  settings?: StoredAppSettings;
  dataModifiedAt?: string;
  lastBackupAt: string;
  lastReviewId?: string;
  lastStaffRecallRunId?: string;
  lastStaffGameWrongNoteArchiveRunId?: string;
  lastAnswerEventId?: string;
  dayFileDigests?: Record<string, string>;
  learningDataDigest?: string;
  vocalAudioLibraryDigest?: string;
  dates: string[];
}

export interface BackupDayFile {
  schemaVersion: 1;
  date: string;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  answerEvents?: AnswerEvent[];
  staffRecallRuns?: StaffRecallRunRecord[];
  staffGameWrongNoteArchives?: StaffGameWrongNoteArchive[];
}

export interface BackupSnapshot {
  manifest: BackupManifest;
  days: Record<string, BackupDayFile>;
}
