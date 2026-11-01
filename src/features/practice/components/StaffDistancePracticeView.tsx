import {
  Cable,
  ChevronDown,
  CircleHelp,
  Eye,
  Mic,
  Music2,
  RotateCcw,
  Settings2,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { writeBackupNow } from "../../../data/backup";
import { db, replacePracticeSessionDiscardingAnswerEvents } from "../../../data/db";
import { createUuid } from "../../../domain/id";
import { getNotesForSelection, getStaffSelectedPitchIds } from "../../../domain/notes";
import { validateStaffDistancePractice } from "../../../domain/staffDistancePractice";
import {
  createStaffDistanceFingerCards,
  getStaffDistanceFingerGroupIds,
  getStaffDistanceFingerProfile,
} from "../../../domain/staffDistanceFinger";
import type {
  AppSettings,
  PitchId,
  PracticeMode,
  PracticeSessionRecord,
  PromptNoteDuration,
  StaffDistanceInputMethod,
  StaffDistanceFingerHand,
  StaffDistanceFingerBatch,
  StaffDistanceFingerInteractionMode,
  StaffDistanceFingerNumber,
  StaffDistancePracticeSettings,
  StaffDistanceTrainingMode,
  StaffNotationMode,
} from "../../../domain/types";
import type { PracticeAnswerInput } from "../../../domain/answerInput";
import type { MidiInputController } from "../../../midi/useMidiInput";
import type { PracticeChaseSettings } from "./PracticeChaseSettingsDialog";
import { MidiInputControl } from "../../../midi/MidiInputControl";
import { GlobalRangeControls } from "../../../shared/components/GlobalRangeControls";
import { BoundedNumberInput } from "../../../shared/components/BoundedNumberInput";
import { PracticeMicrophoneRetryButton } from "../../../shared/components/PracticeMicrophoneRetryButton";
import { useMidiConnectionAttention } from "../../../shared/hooks/useMidiConnectionAttention";
import { guideSetupRequirement } from "../../../shared/utils/guideSetupRequirement";
import { LoadingActivityText } from "../../../shared/components/LoadingActivity";
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";
import { useConfirmDialog } from "../../../shared/components/ui/ConfirmDialog";
import {
  isInteractiveShortcutTarget,
  shouldHandleGlobalEnter,
} from "../../../shared/keyboard/keyboardShortcuts";
import { StaffDistanceRun, type StaffDistanceMicrophoneInput } from "./StaffDistanceRun";
import type { PracticeDistanceMode } from "../../../routing/appRoutes";
import { PRACTICE_FIXED_COUNT_PRESETS } from "../logic/practiceLengthOptions";
import {
  PRACTICE_PIANO_CALIBRATION_CARD_WIDTH_MM,
  PRACTICE_PIANO_SCALE_MAX,
  PRACTICE_PIANO_SCALE_MIN,
  PRACTICE_PIANO_SCALE_STEP,
  canFitPracticePianoKeyboard,
  canFitPracticePianoKeyboardInEitherOrientation,
} from "./staffDistanceFingerKeyboardLayout";
import { usePracticeViewportSize } from "./usePracticeViewportSize";
import {
  DEFAULT_SCORE_CHASE_PREFERENCES,
  SCORE_CHASE_SPEED_OPTIONS,
  type ChaseHandMode,
} from "../logic/scoreChase";
import {
  hasSeenStaffDistanceFingerNoAnswerIntro,
  markStaffDistanceFingerNoAnswerIntroSeen,
} from "../logic/staffDistanceFingerNoAnswer";

interface PracticeNavigationExitRequest {
  id: number;
  returnToSetup?: boolean;
  targetView: "home" | "practice" | "stats" | "settings" | "study" | "vocal" | "metronome";
}

interface StaffDistancePreferences extends StaffDistancePracticeSettings {
  chaseEnabled: boolean;
  chaseHandMode: ChaseHandMode;
  chaseSpeedMultiplier: number;
  chaseStartCount: number;
  fixedCount: number;
  fixedDurationSeconds: number;
  fingerHand: StaffDistanceFingerHand;
  fingerInteractionMode: StaffDistanceFingerInteractionMode;
  fingerNumber: StaffDistanceFingerNumber;
  inputMethod: StaffDistanceInputMethod;
  keyboardScale: number;
  mode: PracticeMode;
  noteDurations: PromptNoteDuration[];
  trainingMode: StaffDistanceTrainingMode;
}

interface DistanceFocus {
  distance?: number;
  fingerBatch?: StaffDistanceFingerBatch;
}

interface StaffDistancePracticeViewProps {
  isActive: boolean;
  showRestartControl?: boolean;
  distanceMode?: PracticeDistanceMode;
  midi: MidiInputController;
  microphone: StaffDistanceMicrophoneInput;
  navigationExitRequest?: PracticeNavigationExitRequest | null;
  onBeforePracticeStart: () => Promise<{ proceed: boolean; settings?: AppSettings }>;
  onDistanceModeChange: (mode: PracticeDistanceMode, replace?: boolean) => void;
  onDataChanged: () => Promise<void>;
  onMicrophoneAnswerHandlerChange: (
    handler: ((answer: PracticeAnswerInput) => void) | null
  ) => void;
  onInputModeChange: (mode: "midi" | "microphone" | "virtual-keyboard" | null) => void;
  onNavigationExit?: (targetView: PracticeNavigationExitRequest["targetView"]) => void;
  onPracticeFinished: () => void;
  onFullscreenAvailabilityChange: (active: boolean) => void;
  onRunStageChange: (active: boolean) => void;
  onRunningChange: (running: boolean) => void;
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
  settings: AppSettings;
}

const STAFF_DISTANCE_PREFERENCES_KEY = "anki-note.staffDistancePracticePreferences";
const DEFAULT_PREFERENCES: StaffDistancePreferences = {
  chaseEnabled: DEFAULT_SCORE_CHASE_PREFERENCES.enabled,
  chaseHandMode: "both",
  chaseSpeedMultiplier: DEFAULT_SCORE_CHASE_PREFERENCES.speedMultiplier,
  chaseStartCount: DEFAULT_SCORE_CHASE_PREFERENCES.startCount,
  includeUnison: false,
  inputMethod: "midi",
  keyboardScale: 1,
  maxDistance: 2,
  fixedCount: 30,
  fixedDurationSeconds: 60,
  fingerHand: "right",
  fingerInteractionMode: "play",
  fingerNumber: 1,
  mode: "fixed-count",
  noteDurations: ["quarter"],
  trainingMode: "look",
};

const NOTE_DURATION_OPTIONS: ReadonlyArray<{
  label: string;
  symbol: string;
  value: PromptNoteDuration;
}> = [
  { label: "全音符", symbol: "𝅝", value: "whole" },
  { label: "四分", symbol: "♩", value: "quarter" },
  { label: "八分", symbol: "♪", value: "eighth" },
  { label: "十六分", symbol: "𝅘𝅥𝅯", value: "sixteenth" },
];

const STAFF_DISTANCE_MODE_TABS: ReadonlyArray<{
  label: string;
  value: StaffDistanceTrainingMode;
}> = [
  { label: "看音距", value: "look" },
  { label: "弹音距", value: "play" },
  { label: "单指专项", value: "finger" },
];

function isPromptNoteDuration(value: unknown): value is PromptNoteDuration {
  return value === "whole" || value === "quarter" || value === "eighth" || value === "sixteenth";
}

function normalizePreferences(value: unknown): StaffDistancePreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return DEFAULT_PREFERENCES;
  const record = value as Record<string, unknown>;
  const numberInRange = (
    candidate: unknown,
    fallback: number,
    min: number,
    max: number
  ): number => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
  };
  const scaleInRange = (candidate: unknown, fallback: number, min: number, max: number): number => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  const savedDurations = Array.isArray(record.noteDurations)
    ? record.noteDurations.filter(isPromptNoteDuration)
    : isPromptNoteDuration(record.noteDuration)
      ? [record.noteDuration]
      : ["quarter"];
  const selectedDurations = NOTE_DURATION_OPTIONS.filter((option) =>
    savedDurations.includes(option.value)
  ).map((option) => option.value);
  const savedChaseSpeed = Number(record.chaseSpeedMultiplier);
  const chaseSpeedMultiplier = SCORE_CHASE_SPEED_OPTIONS.includes(
    savedChaseSpeed as (typeof SCORE_CHASE_SPEED_OPTIONS)[number]
  )
    ? savedChaseSpeed
    : DEFAULT_SCORE_CHASE_PREFERENCES.speedMultiplier;
  return {
    chaseEnabled:
      typeof record.chaseEnabled === "boolean"
        ? record.chaseEnabled
        : DEFAULT_SCORE_CHASE_PREFERENCES.enabled,
    chaseHandMode:
      record.chaseHandMode === "left" || record.chaseHandMode === "right"
        ? record.chaseHandMode
        : "both",
    chaseSpeedMultiplier,
    chaseStartCount: numberInRange(
      record.chaseStartCount,
      DEFAULT_SCORE_CHASE_PREFERENCES.startCount,
      2,
      12
    ),
    includeUnison: typeof record.includeUnison === "boolean" ? record.includeUnison : false,
    maxDistance: numberInRange(record.maxDistance, 2, 1, 7),
    fixedCount: numberInRange(record.fixedCount, 30, 1, 500),
    fixedDurationSeconds: numberInRange(record.fixedDurationSeconds, 60, 60, 7200),
    fingerHand: record.fingerHand === "left" ? "left" : "right",
    fingerInteractionMode: record.fingerInteractionMode === "no-answer" ? "no-answer" : "play",
    fingerNumber: ([1, 2, 3, 4, 5] as number[]).includes(Number(record.fingerNumber))
      ? (Number(record.fingerNumber) as StaffDistanceFingerNumber)
      : 1,
    keyboardScale: scaleInRange(
      record.keyboardScale,
      DEFAULT_PREFERENCES.keyboardScale,
      PRACTICE_PIANO_SCALE_MIN,
      PRACTICE_PIANO_SCALE_MAX
    ),
    inputMethod:
      record.inputMethod === "microphone" || record.inputMethod === "virtual-keyboard"
        ? record.inputMethod
        : "midi",
    mode:
      record.mode === "open-ended" ||
      record.mode === "fixed-count" ||
      record.mode === "fixed-duration"
        ? record.mode
        : "fixed-count",
    noteDurations: selectedDurations.length > 0 ? selectedDurations : ["quarter"],
    trainingMode:
      record.trainingMode === "play" || record.trainingMode === "finger"
        ? record.trainingMode
        : "look",
  };
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function percentage(correct: number, count: number): string {
  return count === 0 ? "—" : `${Math.round((correct / count) * 100)}%`;
}

function describeValidation(
  validation: ReturnType<typeof validateStaffDistancePractice>,
  staffNotationMode: StaffNotationMode
): string | undefined {
  if (validation.ok) return undefined;
  if (validation.reason === "need-two-groups") {
    return "7 步题至少需要两个连续音组；大谱表还必须在同一谱表内有一对相隔 7 步的音。";
  }
  if (validation.reason === "only-one-answer") {
    return "当前只会出现数字 1。请开启同音 0，或把最大音距调到 2 步以上。";
  }
  const missingDistances = validation.missing?.join("、") ?? "所选";
  if (staffNotationMode === "grand" && validation.missing?.includes(7)) {
    return "当前选择的连续组不符合生成条件，请在高音区（中央 C 右边）选择连续多组音符，或者在低音区（中央 C 左边）选择连续多组音符。";
  }
  return `当前音域在同一谱表内无法生成 ${missingDistances} 步的音距音对；跨谱表的音不组成一道题。请在当前谱表扩展音域，或缩小最大音距。`;
}

function createDistanceSession(
  settings: AppSettings,
  preferences: StaffDistancePreferences,
  focus?: { distance?: number; fingerBatch?: StaffDistanceFingerBatch }
): PracticeSessionRecord {
  const isFingerMode = preferences.trainingMode === "finger";
  const staffNotationMode = isFingerMode
    ? preferences.fingerHand === "right"
      ? "treble-only"
      : "bass-only"
    : settings.staffNotationMode;
  const startedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: createUuid(),
    practiceType: "staff-distance",
    mode: isFingerMode ? "fixed-count" : preferences.mode,
    enabledGroupIds: [],
    fixedCount: isFingerMode
      ? 28
      : preferences.mode === "fixed-count"
        ? preferences.fixedCount
        : undefined,
    fixedDurationSeconds:
      !isFingerMode && preferences.mode === "fixed-duration"
        ? preferences.fixedDurationSeconds
        : undefined,
    startedAt,
    completedCount: 0,
    interruptedCount: 0,
    staffDistance: {
      enabledGroupIds: isFingerMode
        ? getStaffDistanceFingerGroupIds(preferences.fingerHand)
        : [...settings.enabledGroupIds],
      enabledPitchIds:
        !isFingerMode && settings.enabledPitchIds ? [...settings.enabledPitchIds] : undefined,
      crossGroupPitchIds: isFingerMode ? [] : [...(settings.crossGroupPitchIds ?? [])],
      includeInterStaffLedgerSpellings:
        staffNotationMode === "grand" ? false : settings.includeInterStaffLedgerSpellings,
      includeUnison: isFingerMode ? false : preferences.includeUnison,
      inputMethod: preferences.trainingMode !== "look" ? preferences.inputMethod : undefined,
      maxDistance: isFingerMode ? 7 : preferences.maxDistance,
      noteDuration:
        preferences.noteDurations.length === 1 ? preferences.noteDurations[0] : undefined,
      noteDurations: [...preferences.noteDurations],
      questionResults: [],
      staffNotationMode,
      trainingMode: preferences.trainingMode,
      ...(isFingerMode
        ? {
            fingerHand: preferences.fingerHand,
            fingerNumber: preferences.fingerNumber,
            fingerInteractionMode: preferences.fingerInteractionMode,
            ...(focus?.fingerBatch ? { focusFingerBatch: focus.fingerBatch } : {}),
          }
        : {}),
      ...(!isFingerMode && focus?.distance !== undefined ? { focusDistance: focus.distance } : {}),
    },
  };
}

function getDistanceNotes(
  settings: Pick<
    AppSettings,
    "enabledGroupIds" | "enabledPitchIds" | "crossGroupPitchIds" | "staffNotationMode"
  >
) {
  // Distance practice uses one canonical staff per pitch: C4 and above on treble,
  // B3 and below on bass. Alternate ledger spellings would duplicate pitch choices.
  return getNotesForSelection(
    settings.enabledGroupIds,
    settings.enabledPitchIds,
    settings.crossGroupPitchIds,
    false,
    settings.staffNotationMode
  );
}

function formatMedianResponse(session: PracticeSessionRecord): string {
  const details = session.staffDistance;
  const response = median(
    details?.questionResults
      .filter((result) => result.firstTryCorrect)
      .map((result) => result.responseMs) ?? []
  );
  return response === undefined ? "—" : `${(response / 1000).toFixed(2)} 秒`;
}

export function StaffDistancePracticeView({
  isActive,
  showRestartControl = false,
  distanceMode,
  midi,
  microphone,
  navigationExitRequest,
  onBeforePracticeStart,
  onDistanceModeChange,
  onDataChanged,
  onMicrophoneAnswerHandlerChange,
  onInputModeChange,
  onNavigationExit,
  onPracticeFinished,
  onFullscreenAvailabilityChange,
  onRunStageChange,
  onRunningChange,
  onSettingsSaved,
  settings,
}: StaffDistancePracticeViewProps): JSX.Element {
  const confirm = useConfirmDialog();
  const {
    canRequestConnection: canRequestMidiConnection,
    isActive: isMidiConnectionAttentionActive,
    show: showMidiConnectionAttention,
  } = useMidiConnectionAttention(midi);
  const [preferences, setPreferences] = useLocalStorageState(
    STAFF_DISTANCE_PREFERENCES_KEY,
    DEFAULT_PREFERENCES,
    { parse: normalizePreferences }
  );
  const trainingMode = distanceMode ?? preferences.trainingMode;
  const isFingerNoAnswerSelected =
    trainingMode === "finger" && preferences.fingerInteractionMode === "no-answer";
  const viewportSize = usePracticeViewportSize();
  const keyboardFitsEitherOrientation = canFitPracticePianoKeyboardInEitherOrientation(
    viewportSize,
    preferences.keyboardScale
  );
  const canOfferVirtualKeyboard = canFitPracticePianoKeyboardInEitherOrientation(
    viewportSize,
    PRACTICE_PIANO_SCALE_MIN
  );
  const keyboardFitsCurrentOrientation = canFitPracticePianoKeyboard(
    viewportSize,
    preferences.keyboardScale
  );
  const activeInputMethod: StaffDistanceInputMethod =
    trainingMode !== "finger" && preferences.inputMethod === "virtual-keyboard"
      ? "midi"
      : preferences.inputMethod;
  const previousMidiConnectionRef = useRef(midi.isConnected);
  const keyboardCalibrationRef = useRef<HTMLDetailsElement | null>(null);
  const inputMethodSelectionRevisionRef = useRef(0);
  const setInputMethod = useCallback(
    (inputMethod: StaffDistanceInputMethod): void => {
      inputMethodSelectionRevisionRef.current += 1;
      setPreferences((current) => ({ ...current, inputMethod }));
    },
    [setPreferences]
  );
  useLayoutEffect(() => {
    if (isActive) onInputModeChange(isFingerNoAnswerSelected ? null : activeInputMethod);
  }, [activeInputMethod, isActive, isFingerNoAnswerSelected, onInputModeChange]);
  const [isCustomCountSelected, setIsCustomCountSelected] = useState(
    () =>
      !PRACTICE_FIXED_COUNT_PRESETS.includes(
        preferences.fixedCount as (typeof PRACTICE_FIXED_COUNT_PRESETS)[number]
      )
  );
  const [customFixedCount, setCustomFixedCount] = useState(() =>
    PRACTICE_FIXED_COUNT_PRESETS.includes(
      preferences.fixedCount as (typeof PRACTICE_FIXED_COUNT_PRESETS)[number]
    )
      ? PRACTICE_FIXED_COUNT_PRESETS[0]
      : preferences.fixedCount
  );
  const customFixedCountInputRef = useRef<HTMLInputElement | null>(null);
  const [runSession, setRunSession] = useState<PracticeSessionRecord | null>(null);
  const [summarySession, setSummarySession] = useState<PracticeSessionRecord | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const handledSummaryNavigationRequestRef = useRef<number | null>(null);
  const selectTrainingMode = useCallback(
    (mode: StaffDistanceTrainingMode): void => {
      setStartError(null);
      setPreferences((current) => ({ ...current, trainingMode: mode }));
      onDistanceModeChange(mode);
    },
    [onDistanceModeChange, setPreferences]
  );
  const handleTrainingModeTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
      const currentIndex = STAFF_DISTANCE_MODE_TABS.findIndex(
        ({ value }) => value === event.currentTarget.dataset.distanceMode
      );
      if (currentIndex < 0) return;

      let nextIndex: number;
      switch (event.key) {
        case "ArrowLeft":
          nextIndex =
            (currentIndex - 1 + STAFF_DISTANCE_MODE_TABS.length) % STAFF_DISTANCE_MODE_TABS.length;
          break;
        case "ArrowRight":
          nextIndex = (currentIndex + 1) % STAFF_DISTANCE_MODE_TABS.length;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = STAFF_DISTANCE_MODE_TABS.length - 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      const nextMode = STAFF_DISTANCE_MODE_TABS[nextIndex]!.value;
      selectTrainingMode(nextMode);
      event.currentTarget.parentElement
        ?.querySelector<HTMLButtonElement>(`[data-distance-mode="${nextMode}"]`)
        ?.focus();
    },
    [selectTrainingMode]
  );
  useEffect(() => {
    if (
      !PRACTICE_FIXED_COUNT_PRESETS.includes(
        preferences.fixedCount as (typeof PRACTICE_FIXED_COUNT_PRESETS)[number]
      )
    ) {
      setIsCustomCountSelected(true);
      setCustomFixedCount(preferences.fixedCount);
    }
  }, [preferences.fixedCount]);
  const distanceCrossGroupPitchIds = settings.crossGroupPitchIds;
  const distanceEnabledGroupIds = settings.enabledGroupIds;
  const distanceEnabledPitchIds = settings.enabledPitchIds;
  const distanceStaffNotationMode = settings.staffNotationMode;
  const allSelectedNotes = useMemo(
    () =>
      getDistanceNotes({
        crossGroupPitchIds: distanceCrossGroupPitchIds,
        enabledGroupIds: distanceEnabledGroupIds,
        enabledPitchIds: distanceEnabledPitchIds,
        staffNotationMode: distanceStaffNotationMode,
      }),
    [
      distanceCrossGroupPitchIds,
      distanceEnabledGroupIds,
      distanceEnabledPitchIds,
      distanceStaffNotationMode,
    ]
  );
  const notes = allSelectedNotes;
  const fingerGroupIds = useMemo(
    () => getStaffDistanceFingerGroupIds(preferences.fingerHand),
    [preferences.fingerHand]
  );
  const fingerNotes = useMemo(
    () => getNotesForSelection([...fingerGroupIds], undefined, [], false, "grand"),
    [fingerGroupIds]
  );
  const intervalSettings = useMemo<StaffDistancePracticeSettings>(
    () => ({
      includeUnison: preferences.includeUnison,
      maxDistance: preferences.maxDistance,
    }),
    [preferences.includeUnison, preferences.maxDistance]
  );
  const selectedPitchIds = getStaffSelectedPitchIds(
    settings.enabledGroupIds,
    settings.enabledPitchIds,
    settings.crossGroupPitchIds,
    settings.staffNotationMode
  );
  const validation = validateStaffDistancePractice(notes, selectedPitchIds, intervalSettings);
  const fingerDeckValidation = useMemo(
    () =>
      createStaffDistanceFingerCards(
        fingerNotes,
        preferences.fingerHand,
        preferences.fingerNumber,
        () => 0.5
      ),
    [fingerNotes, preferences.fingerHand, preferences.fingerNumber]
  );
  const fingerProfile = useMemo(
    () => getStaffDistanceFingerProfile(preferences.fingerHand, preferences.fingerNumber),
    [preferences.fingerHand, preferences.fingerNumber]
  );
  const setupDisabledReason =
    trainingMode === "finger"
      ? fingerDeckValidation.error
      : describeValidation(validation, settings.staffNotationMode);
  const needsConsecutiveGroups = !validation.ok && validation.reason === "need-two-groups";
  const hasOnlyOneAnswer = !validation.ok && validation.reason === "only-one-answer";
  const staffLabel =
    settings.staffNotationMode === "treble-only"
      ? "高音谱表"
      : settings.staffNotationMode === "bass-only"
        ? "低音谱表"
        : "大谱表";
  const lengthLabel =
    preferences.mode === "open-ended"
      ? "无限"
      : preferences.mode === "fixed-count"
        ? `${preferences.fixedCount}题`
        : `${Math.round(preferences.fixedDurationSeconds / 60)}分钟`;
  const isSessionActive = runSession !== null;

  useEffect(() => {
    if (!isActive || isStarting) return;
    const wasConnected = previousMidiConnectionRef.current;
    previousMidiConnectionRef.current = midi.isConnected;
    if (
      wasConnected ||
      !midi.isConnected ||
      isSessionActive ||
      summarySession !== null ||
      trainingMode === "look" ||
      preferences.inputMethod !== "microphone"
    ) {
      return;
    }

    setInputMethod("midi");
    const autoSwitchRevision = inputMethodSelectionRevisionRef.current;
    toast.message("已切换到你上次选择的 MIDI 设备", {
      action: {
        label: "撤销",
        onClick: () => {
          if (inputMethodSelectionRevisionRef.current === autoSwitchRevision) {
            setInputMethod("microphone");
          }
        },
      },
      duration: 5000,
    });
  }, [
    isActive,
    isSessionActive,
    isStarting,
    midi.isConnected,
    preferences.inputMethod,
    setInputMethod,
    summarySession,
    trainingMode,
  ]);

  useEffect(() => {
    if (distanceMode && preferences.trainingMode !== distanceMode) {
      setPreferences((current) => ({ ...current, trainingMode: distanceMode }));
    } else if (isActive && !distanceMode) {
      onDistanceModeChange(preferences.trainingMode, true);
    }
  }, [distanceMode, isActive, onDistanceModeChange, preferences.trainingMode, setPreferences]);

  useEffect(() => {
    onRunStageChange(isSessionActive || summarySession !== null);
    return () => onRunStageChange(false);
  }, [isSessionActive, onRunStageChange, summarySession]);

  useEffect(() => {
    onFullscreenAvailabilityChange(isSessionActive);
    return () => onFullscreenAvailabilityChange(false);
  }, [isSessionActive, onFullscreenAvailabilityChange]);

  useEffect(() => {
    if (
      !summarySession ||
      !navigationExitRequest ||
      handledSummaryNavigationRequestRef.current === navigationExitRequest.id
    ) {
      return;
    }
    handledSummaryNavigationRequestRef.current = navigationExitRequest.id;
    setSummarySession(null);
    onNavigationExit?.(navigationExitRequest.targetView);
  }, [navigationExitRequest, onNavigationExit, summarySession]);

  const startSessionAction = async (focus?: DistanceFocus): Promise<void> => {
    if (isStarting) return;
    if (setupDisabledReason) {
      const fingerSetupInvalid = trainingMode === "finger";
      const noSelectedNotes = selectedPitchIds.length === 0;
      setStartError(
        fingerSetupInvalid
          ? "请检查单指设置"
          : noSelectedNotes
            ? "请选择练习音组"
            : needsConsecutiveGroups
              ? "7 步需要连续音组"
              : hasOnlyOneAnswer
                ? "请调大音距或开启同音"
                : "请缩小音距或扩展音域"
      );
      guideSetupRequirement(
        fingerSetupInvalid
          ? '[data-setup-guide-target="distance-finger-setup"]'
          : noSelectedNotes
            ? '[data-setup-guide-target="distance-note-groups"]'
            : needsConsecutiveGroups
              ? '[data-setup-guide-target="distance-note-groups"]'
              : '[data-setup-guide-target="distance-max-interval"]'
      );
      return;
    }
    if (
      !isFingerNoAnswerSelected &&
      activeInputMethod === "virtual-keyboard" &&
      !keyboardFitsEitherOrientation
    ) {
      setStartError("钢琴键盘超出屏幕，请调小键盘尺寸");
      if (keyboardCalibrationRef.current) keyboardCalibrationRef.current.open = true;
      guideSetupRequirement('[data-setup-guide-target="distance-keyboard-calibration"]');
      return;
    }
    if (
      !isFingerNoAnswerSelected &&
      trainingMode !== "look" &&
      activeInputMethod === "midi" &&
      !midi.isConnected
    ) {
      const midiUnavailable = midi.status === "unsupported" || midi.status === "insecure-context";
      setStartError(
        midiUnavailable
          ? "当前环境不支持 MIDI，请改用麦克风"
          : midi.status === "requesting"
            ? "MIDI 正在连接，请稍候"
            : midi.status === "denied"
              ? "请检查 MIDI 权限"
              : midi.status === "error"
                ? "MIDI 连接失败，请重试"
                : midi.status === "ready" && midi.inputs.length > 0
                  ? "请选择 MIDI 设备"
                  : "请连接 MIDI 键盘"
      );
      guideSetupRequirement(
        midiUnavailable
          ? '[data-setup-guide-target="distance-input-mode"]'
          : '[data-setup-guide-target="distance-midi-device"]'
      );
      return;
    }
    setIsStarting(true);
    setStartError(null);
    let microphoneStarted = false;
    try {
      if (isFingerNoAnswerSelected && !hasSeenStaffDistanceFingerNoAnswerIntro()) {
        const confirmed = await confirm({
          title: "免答模式怎么玩",
          description:
            "先看谱面，在心里说出目标音和建议手指；点击“查看答案”后，琴键会高亮目标音并标出建议指法，再点“下一个”继续。免答模式不检测实际弹奏、不计时，也不记录正确率，手机竖屏可用。",
          confirmLabel: "知道了，开始",
          cancelLabel: "取消",
        });
        if (!confirmed) return;
      }
      const preflight = await onBeforePracticeStart();
      if (!preflight.proceed) return;
      const currentSettings = preflight.settings ?? settings;
      const sessionNotes =
        trainingMode === "finger" ? fingerNotes : getDistanceNotes(currentSettings);
      const nextValidationError =
        trainingMode === "finger"
          ? createStaffDistanceFingerCards(
              fingerNotes,
              preferences.fingerHand,
              preferences.fingerNumber,
              () => 0.5
            ).error
          : describeValidation(
              validateStaffDistancePractice(
                sessionNotes,
                getStaffSelectedPitchIds(
                  currentSettings.enabledGroupIds,
                  currentSettings.enabledPitchIds,
                  currentSettings.crossGroupPitchIds,
                  currentSettings.staffNotationMode
                ),
                intervalSettings
              ),
              currentSettings.staffNotationMode
            );
      if (nextValidationError) {
        setStartError("请调整音距设置");
        guideSetupRequirement(
          trainingMode === "finger"
            ? '[data-setup-guide-target="distance-finger-setup"]'
            : '[data-setup-guide-target="distance-max-interval"]'
        );
        return;
      }
      if (
        !isFingerNoAnswerSelected &&
        trainingMode !== "look" &&
        activeInputMethod === "microphone"
      ) {
        const microphoneReady = await microphone.start({ includeAccidentals: false });
        if (!microphoneReady) {
          setStartError("请检查麦克风权限或设备");
          guideSetupRequirement('[data-setup-guide-target="distance-microphone-retry"]');
          return;
        }
        microphoneStarted = true;
      }
      const nextSession = createDistanceSession(
        currentSettings,
        {
          ...preferences,
          inputMethod: activeInputMethod,
          trainingMode,
        },
        focus
      );
      await db.practiceSessions.put(nextSession);
      if (isFingerNoAnswerSelected) markStaffDistanceFingerNoAnswerIntroSeen();
      setRunSession(nextSession);
    } catch (error) {
      if (microphoneStarted) microphone.stop();
      setStartError(error instanceof Error ? error.message : "练习未能开始，请重试。");
      guideSetupRequirement(
        isFingerNoAnswerSelected
          ? '[data-setup-guide-target="distance-finger-setup"]'
          : trainingMode !== "look" && activeInputMethod === "microphone"
            ? '[data-setup-guide-target="distance-microphone-retry"]'
            : trainingMode !== "look" && activeInputMethod === "midi"
              ? '[data-setup-guide-target="distance-midi-device"]'
              : '[data-setup-guide-target="distance-input-mode"]'
      );
    } finally {
      setIsStarting(false);
    }
  };
  const startSession = useCallback(startSessionAction, [
    intervalSettings,
    activeInputMethod,
    confirm,
    keyboardFitsEitherOrientation,
    fingerNotes,
    isStarting,
    microphone,
    midi.isConnected,
    midi.inputs.length,
    midi.status,
    onBeforePracticeStart,
    isFingerNoAnswerSelected,
    preferences,
    selectedPitchIds,
    needsConsecutiveGroups,
    hasOnlyOneAnswer,
    settings,
    setupDisabledReason,
    trainingMode,
  ]);

  useEffect(() => {
    setStartError(null);
  }, [
    midi.isConnected,
    midi.inputs.length,
    midi.status,
    preferences.inputMethod,
    setupDisabledReason,
  ]);

  useEffect(() => {
    if (!isActive || runSession || summarySession) return undefined;
    function onEnter(event: KeyboardEvent): void {
      if (!shouldHandleGlobalEnter(event, isInteractiveShortcutTarget(event.target))) return;
      event.preventDefault();
      void startSession();
    }
    window.addEventListener("keydown", onEnter);
    return () => window.removeEventListener("keydown", onEnter);
  }, [isActive, runSession, startSession, summarySession]);

  const finishSession = async (
    finalSession: PracticeSessionRecord,
    showSummary: boolean
  ): Promise<void> => {
    const answerEvents = await db.answerEvents.where("sessionId").equals(finalSession.id).toArray();
    const isFingerMode = finalSession.staffDistance?.trainingMode === "finger";
    const questionResults = isFingerMode
      ? (finalSession.staffDistance?.questionResults ?? [])
      : answerEvents.flatMap((event) =>
          event.staffDistance
            ? [
                {
                  distance: event.staffDistance.distance,
                  direction: event.staffDistance.direction,
                  firstTryCorrect: event.isCorrectFirstTry === true,
                  responseMs: event.rawResponseTimeMs ?? 0,
                  wrongAttempts: event.wrongAttempts,
                  usedHint: event.staffDistance.usedHint ?? false,
                  targetPitchId: event.targetNoteId?.split("-")[0] as PitchId | undefined,
                },
              ]
            : []
        );
    const hasResults = questionResults.length > 0;
    const storedSession = finalSession.staffDistance
      ? {
          ...finalSession,
          staffDistance: {
            ...finalSession.staffDistance,
            questionResults: isFingerMode ? questionResults : [],
          },
        }
      : finalSession;
    const summary = finalSession.staffDistance
      ? { ...finalSession, staffDistance: { ...finalSession.staffDistance, questionResults } }
      : finalSession;
    try {
      if (hasResults) {
        await db.practiceSessions.put(storedSession);
        await writeBackupNow().catch(() => undefined);
        await onDataChanged();
      } else {
        await db.practiceSessions.delete(finalSession.id);
      }
    } catch (error) {
      toast.error(
        `保存音距速推记录失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
    setRunSession(null);
    setSummarySession(showSummary && hasResults ? summary : null);
    if (showSummary && hasResults) onPracticeFinished();
    onRunningChange(false);
    microphone.stop();
  };

  const restartSession = async (
    fingerInteractionMode?: StaffDistanceFingerInteractionMode
  ): Promise<void> => {
    if (!runSession) return;
    const nextFingerInteractionMode =
      fingerInteractionMode ?? runSession.staffDistance?.fingerInteractionMode ?? "play";
    if (
      runSession.staffDistance?.trainingMode === "finger" &&
      nextFingerInteractionMode === "play" &&
      runSession.staffDistance.inputMethod === "microphone"
    ) {
      const microphoneReady = await microphone.start({ includeAccidentals: false });
      if (!microphoneReady) {
        throw new Error(microphone.error ?? "麦克风未能重新连接，请检查权限和输入设备。");
      }
    }
    const nextSession: PracticeSessionRecord = {
      ...runSession,
      id: createUuid(),
      startedAt: new Date().toISOString(),
      completedCount: 0,
      interruptedCount: 0,
      staffDistance: {
        ...runSession.staffDistance!,
        questionResults: [],
        ...(runSession.staffDistance?.trainingMode === "finger"
          ? {
              fingerInteractionMode: nextFingerInteractionMode,
            }
          : {}),
      },
    };
    await replacePracticeSessionDiscardingAnswerEvents(runSession.id, nextSession);
    if (runSession.staffDistance?.trainingMode === "finger") {
      setPreferences((current) => ({
        ...current,
        fingerInteractionMode: nextFingerInteractionMode,
      }));
    }
    setRunSession(nextSession);
  };

  const toggleUnison = (includeUnison: boolean): void =>
    setPreferences((current) => ({ ...current, includeUnison }));

  if (runSession?.staffDistance) {
    const runTrainingMode = runSession.staffDistance.trainingMode ?? "look";
    const savedRunInputMethod = runSession.staffDistance.inputMethod ?? activeInputMethod;
    const runInputMethod =
      runTrainingMode !== "finger" && savedRunInputMethod === "virtual-keyboard"
        ? "midi"
        : savedRunInputMethod;
    const sessionSettings = {
      includeUnison: runSession.staffDistance.includeUnison,
      maxDistance: runSession.staffDistance.maxDistance,
      ...(runSession.staffDistance.focusDistance !== undefined
        ? { focusDistance: runSession.staffDistance.focusDistance }
        : {}),
    };
    const sessionNotes =
      runSession.staffDistance.trainingMode === "finger"
        ? getNotesForSelection(
            [...runSession.staffDistance.enabledGroupIds],
            undefined,
            [],
            false,
            runSession.staffDistance.staffNotationMode
          )
        : getDistanceNotes(runSession.staffDistance);
    return (
      <StaffDistanceRun
        key={runSession.id}
        chaseSettings={{
          enabled: preferences.chaseEnabled,
          handMode: preferences.chaseHandMode,
          speedMultiplier: preferences.chaseSpeedMultiplier,
          startCount: preferences.chaseStartCount,
        }}
        fixedCount={runSession.fixedCount ?? preferences.fixedCount}
        fixedDurationSeconds={runSession.fixedDurationSeconds ?? preferences.fixedDurationSeconds}
        mode={runSession.mode}
        trainingMode={runTrainingMode}
        inputMethod={runInputMethod}
        keyboardScale={preferences.keyboardScale}
        midi={midi}
        microphone={microphone}
        onMicrophoneAnswerHandlerChange={onMicrophoneAnswerHandlerChange}
        navigationExitRequest={navigationExitRequest}
        notes={sessionNotes}
        onRestart={showRestartControl ? restartSession : undefined}
        onFinish={finishSession}
        onSaveChaseSettings={(chaseSettings: PracticeChaseSettings) =>
          setPreferences((current) => ({
            ...current,
            chaseEnabled: chaseSettings.enabled,
            chaseHandMode: chaseSettings.handMode,
            chaseSpeedMultiplier: chaseSettings.speedMultiplier,
            chaseStartCount: chaseSettings.startCount,
          }))
        }
        onNavigationExit={onNavigationExit}
        onRunningChange={onRunningChange}
        session={runSession}
        settings={sessionSettings}
        noteDurations={
          runSession.staffDistance.noteDurations ?? [
            runSession.staffDistance.noteDuration ?? "quarter",
          ]
        }
        staffNotationMode={runSession.staffDistance.staffNotationMode}
        useLedgerGap={
          runSession.staffDistance.trainingMode === "finger"
            ? false
            : sessionNotes.some((note) => note.isInterStaffLedgerSpelling)
        }
      />
    );
  }

  if (summarySession?.staffDistance) {
    const details = summarySession.staffDistance;
    const results = details.questionResults;
    const correctCount = results.filter((result) => result.firstTryCorrect).length;
    const isFingerMode = details.trainingMode === "finger";
    const weakPoints = isFingerMode
      ? details.fingerInteractionMode === "no-answer"
        ? []
        : (["line", "space"] as const)
            .map((batch) => {
              const batchResults = results.filter((result) => result.fingerBatch === batch);
              const errors = batchResults.filter(
                (result) =>
                  !result.firstTryCorrect ||
                  result.referenceFirstTryCorrect === false ||
                  result.targetFirstTryCorrect === false ||
                  result.timedOut === true
              ).length;
              return {
                label: batch === "line" ? "线上目标" : "间上目标",
                batch,
                errors,
                total: batchResults.length,
              };
            })
            .filter((point) => point.errors > 0)
            .sort((left, right) => right.errors - left.errors)
      : [...new Set(results.map((result) => result.distance))]
          .map((distance) => {
            const distanceResults = results.filter((result) => result.distance === distance);
            return {
              label: `${distance} 步音距`,
              distance,
              errors: distanceResults.filter((result) => !result.firstTryCorrect).length,
              total: distanceResults.length,
            };
          })
          .filter((point) => point.errors > 0)
          .sort((left, right) => right.errors - left.errors)
          .slice(0, 3);
    const primaryWeakPoint = weakPoints[0];
    const referenceCorrectCount = results.filter(
      (result) => result.referenceFirstTryCorrect === true
    ).length;
    const targetCorrectCount = results.filter(
      (result) => result.targetFirstTryCorrect === true
    ).length;
    const timeoutCount = results.filter((result) => result.timedOut === true).length;
    return (
      <section className="staff-distance-summary-shell">
        <div className="panel staff-distance-summary-panel">
          <header className="staff-distance-summary-heading">
            <span aria-hidden="true" className="staff-distance-summary-mark">
              ✓
            </span>
            <div>
              <h1>音距速推完成</h1>
              <p>
                {isFingerMode
                  ? `${details.fingerHand === "left" ? "左手" : "右手"}${details.fingerNumber ?? 1} 指：先弹参考音，再弹目标音。`
                  : details.trainingMode === "play"
                    ? "你根据当前音弹奏了谱面上的下一个音。"
                    : "这次练习帮助你更快看出两个音之间的音距。"}
              </p>
            </div>
          </header>
          {isFingerMode ? (
            <>
              <div className="staff-distance-summary-metrics">
                <div>
                  <strong>{results.length}</strong>
                  <span>完成卡片</span>
                </div>
                <div>
                  <strong>{percentage(referenceCorrectCount, results.length)}</strong>
                  <span>参考音首次弹对</span>
                </div>
                <div>
                  <strong>{percentage(targetCorrectCount, results.length)}</strong>
                  <span>目标音首次弹对</span>
                </div>
                <div>
                  <strong>{timeoutCount}</strong>
                  <span>超时卡片</span>
                </div>
              </div>
              <div className="staff-distance-summary-table-wrap">
                <table className="staff-distance-summary-table">
                  <thead>
                    <tr>
                      <th>参考音位置</th>
                      <th>卡片</th>
                      <th>参考音首次弹对</th>
                      <th>目标音首次弹对</th>
                      <th>超时</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["line", "space"] as const).map((batch) => {
                      const batchResults = results.filter((result) => result.fingerBatch === batch);
                      return (
                        <tr key={batch}>
                          <th scope="row">{batch === "line" ? "线上" : "间上"}</th>
                          <td>{batchResults.length}</td>
                          <td>
                            {percentage(
                              batchResults.filter(
                                (result) => result.referenceFirstTryCorrect === true
                              ).length,
                              batchResults.length
                            )}
                          </td>
                          <td>
                            {percentage(
                              batchResults.filter((result) => result.targetFirstTryCorrect === true)
                                .length,
                              batchResults.length
                            )}
                          </td>
                          <td>{batchResults.filter((result) => result.timedOut).length}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div className="staff-distance-summary-metrics">
                <div>
                  <strong>{results.length}</strong>
                  <span>题</span>
                </div>
                <div>
                  <strong>{percentage(correctCount, results.length)}</strong>
                  <span>{details.trainingMode === "play" ? "首次弹对" : "首次答对"}</span>
                </div>
                <div>
                  <strong>{formatMedianResponse(summarySession)}</strong>
                  <span>首次答对反应时间中位数</span>
                </div>
              </div>
              <div className="staff-distance-summary-table-wrap">
                <table className="staff-distance-summary-table">
                  <thead>
                    <tr>
                      <th>音距</th>
                      <th>题数</th>
                      <th>{details.trainingMode === "play" ? "首次弹对" : "首次答对"}</th>
                      <th>反应时间中位数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: details.maxDistance + 1 }, (_, index) => index)
                      .filter((distance) => distance > 0 || details.includeUnison)
                      .map((distance) => {
                        const distanceResults = results.filter(
                          (result) => result.distance === distance
                        );
                        return (
                          <tr key={distance}>
                            <th scope="row">{distance} 步</th>
                            <td>{distanceResults.length}</td>
                            <td>
                              {percentage(
                                distanceResults.filter((result) => result.firstTryCorrect).length,
                                distanceResults.length
                              )}
                            </td>
                            <td>
                              {formatMedianResponse({
                                ...summarySession,
                                staffDistance: { ...details, questionResults: distanceResults },
                              })}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {weakPoints.length > 0 ? (
            <section aria-label="本次薄弱点" className="learning-weakness-panel">
              <h2>本次薄弱点</h2>
              <ul>
                {weakPoints.map((point) => (
                  <li key={point.label}>
                    <span>{point.label}</span>
                    <strong>
                      {point.errors}/{point.total} 题首次未答对
                    </strong>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <div className="staff-distance-summary-actions">
            <button onClick={() => setSummarySession(null)} type="button">
              <Settings2 size={16} />
              返回配置
            </button>
            <button
              className="primary"
              onClick={() => {
                setSummarySession(null);
                void startSession(
                  primaryWeakPoint && "batch" in primaryWeakPoint
                    ? { fingerBatch: primaryWeakPoint.batch }
                    : primaryWeakPoint && "distance" in primaryWeakPoint
                      ? { distance: primaryWeakPoint.distance }
                      : undefined
                );
              }}
              type="button"
            >
              <RotateCcw size={16} />
              {primaryWeakPoint ? "针对薄弱项再练一局" : "再来一次"}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="practice-free-page practice-setup-framed-page staff-distance-page">
      <header className="practice-free-page-header">
        <div className="practice-free-heading-copy">
          <h1 id="staff-distance-title">音距速推</h1>
          <div className="practice-setup-description-row">
            <p className="practice-panel-description staff-distance-description">
              {trainingMode === "finger"
                ? isFingerNoAnswerSelected
                  ? "看谱判断目标音与建议指法，再查看答案核对。"
                  : "选择练习方式、左右手和手指，先按参考音定位，再弹奏目标音。"
                : trainingMode === "play"
                  ? "根据谱面依次弹奏音符，练习从读谱到找到琴键。"
                  : "看清当前音与下一个音的音距，练习快速判断并找到下一个琴键。"}
            </p>
            {trainingMode !== "look" && activeInputMethod === "midi" ? (
              <div className="practice-setup-heading-meta">
                <div className="practice-midi-heading-status staff-distance-midi-status">
                  <MidiInputControl
                    ariaLabel="音距速推 MIDI 输入设备"
                    className={isMidiConnectionAttentionActive ? "needs-attention" : undefined}
                    midi={midi}
                    setupGuideTarget="distance-midi-device"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div
        aria-label="音距速推训练方式"
        aria-orientation="horizontal"
        className="segmented staff-distance-mode-tabs"
        role="tablist"
      >
        {STAFF_DISTANCE_MODE_TABS.map((tab) => (
          <button
            aria-controls="staff-distance-mode-panel"
            aria-selected={trainingMode === tab.value}
            className={trainingMode === tab.value ? "active" : ""}
            data-distance-mode={tab.value}
            id={`staff-distance-tab-${tab.value}`}
            key={tab.value}
            onClick={() => selectTrainingMode(tab.value)}
            onKeyDown={handleTrainingModeTabKeyDown}
            role="tab"
            tabIndex={trainingMode === tab.value ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`staff-distance-tab-${trainingMode}`}
        className="staff-distance-mode-panel"
        id="staff-distance-mode-panel"
        role="tabpanel"
        tabIndex={0}
      >
        {trainingMode !== "finger" ? (
          <section
            className="practice-free-range-section staff-distance-range-base"
            data-setup-guide-target="distance-note-groups"
          >
            <GlobalRangeControls
              allowInterStaffLedgerChoice={false}
              compactSummary
              rangeControlPart="base"
              settings={settings}
              onSettingsSaved={onSettingsSaved}
            />
          </section>
        ) : null}

        <section
          aria-label="基础练习设置"
          className={`practice-free-basics-grid staff-distance-basic-settings is-${trainingMode}-mode`}
          data-setup-guide-target={trainingMode === "finger" ? "distance-finger-setup" : undefined}
        >
          {trainingMode !== "look" ? (
            <div className="practice-free-field staff-distance-setting-block staff-distance-training-block">
              <span className="control-label">
                {trainingMode === "finger" ? "单指专项设置" : "弹奏设置"}
              </span>
              <div className="staff-distance-setting-content staff-distance-training-content">
                {trainingMode === "finger" ? (
                  <div className="staff-distance-finger-setup">
                    <div className="staff-distance-finger-choice is-mode-choice">
                      <span className="control-label">练习方式</span>
                      <div aria-label="单指专项练习方式" className="segmented" role="group">
                        {(
                          [
                            { label: "弹奏作答", value: "play" },
                            { label: "免答模式", value: "no-answer" },
                          ] as const
                        ).map((option) => (
                          <button
                            aria-pressed={preferences.fingerInteractionMode === option.value}
                            className={
                              preferences.fingerInteractionMode === option.value ? "active" : ""
                            }
                            key={option.value}
                            onClick={() => {
                              setStartError(null);
                              setPreferences((current) => ({
                                ...current,
                                fingerInteractionMode: option.value,
                              }));
                            }}
                            type="button"
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="staff-distance-finger-choice is-hand-choice">
                      <span className="control-label">左右手</span>
                      <div aria-label="左右手" className="segmented" role="group">
                        {(["right", "left"] as const).map((hand) => (
                          <button
                            aria-pressed={preferences.fingerHand === hand}
                            className={preferences.fingerHand === hand ? "active" : ""}
                            key={hand}
                            onClick={() => {
                              setStartError(null);
                              setPreferences((current) => ({ ...current, fingerHand: hand }));
                            }}
                            type="button"
                          >
                            {hand === "right" ? "右手" : "左手"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                {trainingMode === "finger" ? (
                  <div className="staff-distance-finger-setup">
                    <div className="staff-distance-finger-choice">
                      <span className="control-label">练习手指</span>
                      <div aria-label="练习手指" className="segmented" role="group">
                        {([1, 2, 3, 4, 5] as const).map((finger) => (
                          <button
                            aria-pressed={preferences.fingerNumber === finger}
                            className={preferences.fingerNumber === finger ? "active" : ""}
                            key={finger}
                            onClick={() => {
                              setStartError(null);
                              setPreferences((current) => ({ ...current, fingerNumber: finger }));
                            }}
                            type="button"
                          >
                            {finger} 指
                          </button>
                        ))}
                      </div>
                    </div>
                    <p>
                      固定音域：{preferences.fingerHand === "left" ? "C2、C3 组" : "C4、C5 组"}；
                      参考音下方 {fingerProfile.lower} 个谱位、上方 {fingerProfile.upper}{" "}
                      个谱位；线上参考音
                      {fingerProfile.lineAnchorPitchId}，间上参考音{" "}
                      {fingerProfile.spaceAnchorPitchId}。
                      {preferences.fingerInteractionMode === "no-answer"
                        ? "免答模式每轮 28 张卡片；点击查看答案核对琴键和建议指法，再手动进入下一张。"
                        : "每轮 28 张卡片，每张限时 5 秒；先弹参考音，再弹目标音。"}
                    </p>
                  </div>
                ) : null}
                {!isFingerNoAnswerSelected ? (
                  <>
                    <div className="staff-distance-input-switch">
                      <span>输入方式</span>
                      <div
                        aria-label="弹奏输入方式"
                        className={`segmented staff-distance-input-methods${trainingMode === "finger" && canOfferVirtualKeyboard ? " has-virtual-keyboard" : ""}`}
                        data-setup-guide-target="distance-input-mode"
                        role="group"
                      >
                        <button
                          aria-pressed={activeInputMethod === "microphone"}
                          className={activeInputMethod === "microphone" ? "active" : ""}
                          onClick={() => {
                            setStartError(null);
                            setInputMethod("microphone");
                          }}
                          type="button"
                        >
                          <Mic aria-hidden="true" size={14} /> 麦克风
                        </button>
                        <button
                          aria-pressed={activeInputMethod === "midi"}
                          className={activeInputMethod === "midi" ? "active" : ""}
                          disabled={
                            !midi.isConnected &&
                            (midi.status === "unsupported" || midi.status === "insecure-context")
                          }
                          onClick={() => {
                            setStartError(null);
                            setInputMethod("midi");
                            if (canRequestMidiConnection) showMidiConnectionAttention();
                          }}
                          type="button"
                          title={!midi.isConnected ? "连接 MIDI 后可用" : undefined}
                        >
                          <Cable aria-hidden="true" size={14} /> MIDI
                        </button>
                        {trainingMode === "finger" && canOfferVirtualKeyboard ? (
                          <button
                            aria-pressed={preferences.inputMethod === "virtual-keyboard"}
                            className={
                              preferences.inputMethod === "virtual-keyboard" ? "active" : ""
                            }
                            onClick={() => {
                              setStartError(null);
                              setInputMethod("virtual-keyboard");
                            }}
                            type="button"
                          >
                            <Music2 aria-hidden="true" size={14} /> 钢琴键盘
                          </button>
                        ) : null}
                      </div>
                      {trainingMode === "finger" &&
                      preferences.inputMethod === "virtual-keyboard" &&
                      !keyboardFitsCurrentOrientation ? (
                        <span className="staff-distance-keyboard-orientation-hint">
                          {canFitPracticePianoKeyboard(
                            { width: viewportSize.height, height: viewportSize.width },
                            preferences.keyboardScale
                          )
                            ? viewportSize.height > viewportSize.width
                              ? "旋转到横向后可使用当前键盘尺寸"
                              : "旋转屏幕后可使用当前键盘尺寸"
                            : "当前屏幕宽度不足，请调小键盘尺寸"}
                        </span>
                      ) : null}
                    </div>
                    {trainingMode === "finger" && preferences.inputMethod === "virtual-keyboard" ? (
                      <details
                        className="staff-distance-keyboard-calibration"
                        ref={keyboardCalibrationRef}
                      >
                        <summary>校准钢琴键宽</summary>
                        <p>
                          将标准银行卡或身份证的长边贴在参考框旁，拖动滑块让两端对齐。校准保存在本浏览器；显示缩放改变后需重新校准。
                        </p>
                        <div
                          aria-hidden="true"
                          className="staff-distance-keyboard-calibration-guide"
                          style={{
                            width: `${PRACTICE_PIANO_CALIBRATION_CARD_WIDTH_MM * preferences.keyboardScale}mm`,
                          }}
                        >
                          标准卡宽 85.6 mm
                        </div>
                        <label
                          className="staff-distance-keyboard-calibration-control"
                          data-setup-guide-target="distance-keyboard-calibration"
                        >
                          <span>键盘尺寸 · {Math.round(preferences.keyboardScale * 100)}%</span>
                          <input
                            aria-label="校准钢琴键盘实际宽度"
                            max={PRACTICE_PIANO_SCALE_MAX}
                            min={PRACTICE_PIANO_SCALE_MIN}
                            onChange={(event) => {
                              setStartError(null);
                              setPreferences((current) => ({
                                ...current,
                                keyboardScale: Number(event.currentTarget.value),
                              }));
                            }}
                            step={PRACTICE_PIANO_SCALE_STEP}
                            type="range"
                            value={preferences.keyboardScale}
                          />
                        </label>
                        <button
                          className="staff-distance-keyboard-calibration-reset"
                          onClick={() => {
                            setStartError(null);
                            setPreferences((current) => ({ ...current, keyboardScale: 1 }));
                          }}
                          type="button"
                        >
                          恢复默认尺寸
                        </button>
                      </details>
                    ) : null}
                  </>
                ) : (
                  <div className="staff-distance-no-answer-input">
                    <span className="control-label">输入方式</span>
                    <p className="staff-distance-no-answer-setup-copy">
                      无需输入设备；琴键图只供查看音高位置，不能触键作答。免答模式不计时、不统计正确率，手机竖屏也能使用。
                    </p>
                  </div>
                )}
                {!isFingerNoAnswerSelected &&
                activeInputMethod === "microphone" &&
                (microphone.error ||
                  microphone.status === "error" ||
                  microphone.status === "requesting" ||
                  microphone.isPreparingSwiftF0) ? (
                  <div
                    className="practice-microphone-error-actions staff-distance-microphone-error"
                    aria-live="polite"
                  >
                    <span>
                      {microphone.status === "requesting" ? (
                        <LoadingActivityText kind="dots">
                          {microphone.isPreparingSwiftF0 ? "正在准备识别模型" : "正在连接麦克风"}
                        </LoadingActivityText>
                      ) : (
                        (microphone.error ?? "麦克风连接失败，请检查权限和输入设备后重试。")
                      )}
                    </span>
                    <PracticeMicrophoneRetryButton
                      isConnecting={microphone.status === "requesting"}
                      isPreparingModel={microphone.isPreparingSwiftF0}
                      setupGuideTarget="distance-microphone-retry"
                      onRetry={async () => {
                        const connected = await microphone.start({ includeAccidentals: false });
                        if (connected) setStartError(null);
                        return connected;
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {trainingMode !== "finger" ? (
            <div className="practice-free-field staff-distance-setting-block staff-distance-interval-block">
              <div className="staff-distance-setting-heading">
                <span className="control-label">最大音距</span>
                <div aria-label="步数说明" className="staff-distance-rule-summary">
                  <span>C→E = 2 步 · 音距就像手指要移动的格数 · 同音 = 0</span>
                  <details className="staff-distance-rule-help">
                    <summary aria-label="查看步数规则">
                      <CircleHelp aria-hidden="true" size={16} />
                    </summary>
                    <span role="tooltip">
                      每跨一个相邻线位或间位算 1 步；方向只决定上行或下行，音距步数相同；同音重复算
                      0 步。
                    </span>
                  </details>
                </div>
              </div>
              <div className="staff-distance-setting-content">
                <div
                  aria-label="最大音距"
                  className="staff-distance-range-options"
                  data-setup-guide-target="distance-max-interval"
                  role="group"
                >
                  {Array.from({ length: 7 }, (_, index) => index + 1).map((distance) => (
                    <button
                      aria-pressed={preferences.maxDistance === distance}
                      className={preferences.maxDistance === distance ? "is-selected" : ""}
                      key={distance}
                      onClick={() =>
                        setPreferences((current) => ({ ...current, maxDistance: distance }))
                      }
                      type="button"
                    >
                      <span className="staff-distance-step-number">{distance}</span>
                      <span>步</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {trainingMode !== "finger" ? (
            <div className="practice-free-field staff-distance-setting-block staff-distance-length-block">
              <span className="control-label">练习长度</span>
              <div className="staff-distance-setting-content staff-distance-length-content">
                <div
                  aria-label="练习长度"
                  className="segmented staff-distance-length-options"
                  role="group"
                >
                  {(
                    [
                      ["open-ended", "无限"],
                      ["fixed-count", "固定题数"],
                      ["fixed-duration", "固定时长"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      aria-pressed={preferences.mode === mode}
                      className={preferences.mode === mode ? "active" : ""}
                      key={mode}
                      onClick={() => setPreferences((current) => ({ ...current, mode }))}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {preferences.mode === "fixed-count" ? (
                  <div
                    aria-label="练习题数"
                    className="practice-free-value-options staff-distance-count-presets"
                    role="group"
                  >
                    {PRACTICE_FIXED_COUNT_PRESETS.map((count) => (
                      <button
                        aria-pressed={!isCustomCountSelected && preferences.fixedCount === count}
                        className={
                          !isCustomCountSelected && preferences.fixedCount === count ? "active" : ""
                        }
                        key={count}
                        onClick={() => {
                          setIsCustomCountSelected(false);
                          setPreferences((current) => ({ ...current, fixedCount: count }));
                        }}
                        type="button"
                      >
                        {count}题
                      </button>
                    ))}
                    {isCustomCountSelected ? (
                      <label
                        className="practice-free-custom-count-control is-active"
                        htmlFor="staff-distance-custom-count"
                      >
                        <BoundedNumberInput
                          aria-label="自定义题数"
                          id="staff-distance-custom-count"
                          inputRef={customFixedCountInputRef}
                          max={500}
                          min={1}
                          value={preferences.fixedCount}
                          onCommit={(fixedCount) => {
                            setCustomFixedCount(fixedCount);
                            setPreferences((current) => ({ ...current, fixedCount }));
                          }}
                        />
                        <span aria-hidden="true">题</span>
                      </label>
                    ) : (
                      <button
                        aria-pressed={false}
                        onClick={() => {
                          setIsCustomCountSelected(true);
                          setPreferences((current) => ({
                            ...current,
                            fixedCount: customFixedCount,
                          }));
                          window.requestAnimationFrame(() =>
                            customFixedCountInputRef.current?.focus()
                          );
                        }}
                        type="button"
                      >
                        自定义
                      </button>
                    )}
                  </div>
                ) : null}
                {preferences.mode === "fixed-duration" ? (
                  <label
                    className="staff-distance-duration-input"
                    htmlFor="staff-distance-duration"
                  >
                    <span>时长</span>
                    <BoundedNumberInput
                      aria-label="时长，分钟"
                      id="staff-distance-duration"
                      max={120}
                      min={1}
                      step={1}
                      value={Math.round(preferences.fixedDurationSeconds / 60)}
                      onCommit={(minutes) =>
                        setPreferences((current) => ({
                          ...current,
                          fixedDurationSeconds: minutes * 60,
                        }))
                      }
                    />
                    <span>分钟</span>
                  </label>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        {trainingMode !== "finger" ? (
          <details className="staff-distance-advanced">
            <summary className="practice-free-advanced-toggle staff-distance-advanced-toggle">
              <Settings2 aria-hidden="true" size={16} />
              <span>更多设置</span>
              <span className="practice-free-advanced-count">4组</span>
              <ChevronDown
                aria-hidden="true"
                className="staff-distance-advanced-chevron"
                size={16}
              />
            </summary>
            <div className="staff-distance-advanced-content">
              <div className="staff-distance-advanced-inner">
                <section className="staff-distance-advanced-section">
                  <GlobalRangeControls
                    allowInterStaffLedgerChoice={false}
                    rangeControlPart="extensions"
                    settings={settings}
                    onSettingsSaved={onSettingsSaved}
                  />
                  <p className="staff-distance-field-hint">
                    加练音会低权重穿插；大谱表按 C4/B3 分界分别记入对应谱表，不会产生跨谱表音对。
                  </p>
                </section>

                <section className="staff-distance-advanced-section">
                  <h2>谱面音符时值</h2>
                  <div
                    aria-label="谱面音符时值"
                    className="segmented staff-distance-duration-options"
                    role="group"
                  >
                    {NOTE_DURATION_OPTIONS.map((option) => (
                      <button
                        aria-pressed={preferences.noteDurations.includes(option.value)}
                        className={preferences.noteDurations.includes(option.value) ? "active" : ""}
                        disabled={
                          preferences.noteDurations.length === 1 &&
                          preferences.noteDurations.includes(option.value)
                        }
                        key={option.value}
                        onClick={() =>
                          setPreferences((current) => {
                            const isSelected = current.noteDurations.includes(option.value);
                            if (isSelected && current.noteDurations.length === 1) return current;
                            const selected = new Set(current.noteDurations);
                            if (isSelected) selected.delete(option.value);
                            else selected.add(option.value);
                            return {
                              ...current,
                              noteDurations: NOTE_DURATION_OPTIONS.filter((item) =>
                                selected.has(item.value)
                              ).map((item) => item.value),
                            };
                          })
                        }
                        type="button"
                      >
                        <span>{option.label}</span>
                        <span aria-hidden="true">{option.symbol}</span>
                      </button>
                    ))}
                  </div>
                  <p className="staff-distance-field-hint">
                    可多选；按 4/4 拍组合，不生成休止符或空拍。至少保留一种。
                  </p>
                </section>

                <section className="staff-distance-advanced-section staff-distance-advanced-inline">
                  <label className="practice-checkbox-option">
                    <input
                      checked={preferences.includeUnison}
                      type="checkbox"
                      onChange={(event) => toggleUnison(event.target.checked)}
                    />
                    <span>练同音重复（0 步）</span>
                  </label>
                </section>
              </div>
            </div>
          </details>
        ) : null}

        <footer
          aria-label={
            trainingMode === "finger"
              ? "开始单指专项练习"
              : trainingMode === "play"
                ? "开始弹音距练习"
                : "开始音距速推练习"
          }
          className="practice-free-action-dock"
        >
          <div aria-label="当前配置摘要" className="practice-free-config-summary">
            <span className="practice-free-summary-label">当前配置</span>
            {trainingMode === "finger" ? (
              <>
                <span className="practice-free-summary-chip">
                  {preferences.fingerHand === "right" ? "右手" : "左手"}
                  {preferences.fingerNumber}指
                </span>
                <span className="practice-free-summary-chip">
                  {preferences.fingerInteractionMode === "no-answer" ? "28张" : "28张 · 每张5秒"}
                </span>
              </>
            ) : (
              <>
                <span className="practice-free-summary-chip">{staffLabel}</span>
                <span className="practice-free-summary-chip">{preferences.maxDistance}步</span>
                <span className="practice-free-summary-chip">{lengthLabel}</span>
              </>
            )}
            {trainingMode === "finger" && preferences.fingerInteractionMode === "no-answer" ? (
              <span className="practice-free-summary-chip">免答模式</span>
            ) : trainingMode !== "look" ? (
              <span className="practice-free-summary-chip">
                {activeInputMethod === "microphone"
                  ? "麦克风"
                  : activeInputMethod === "virtual-keyboard"
                    ? "钢琴键盘"
                    : "MIDI"}
              </span>
            ) : null}
          </div>
          <div className="practice-free-action-buttons staff-distance-action-controls">
            {startError ? (
              <p className="practice-midi-start-warning" data-setup-guide-warning="" role="alert">
                {startError}
              </p>
            ) : null}
            <span className="practice-start-action staff-distance-start-wrap">
              <button
                aria-keyshortcuts="Enter"
                className="primary practice-free-start-button staff-distance-start-button"
                disabled={isStarting}
                onClick={() => void startSession()}
                type="button"
              >
                {isStarting ? null : trainingMode === "look" || isFingerNoAnswerSelected ? (
                  <Eye
                    aria-hidden="true"
                    className="staff-distance-start-icon"
                    key="look-icon"
                    size={18}
                  />
                ) : (
                  <Music2
                    aria-hidden="true"
                    className="staff-distance-start-icon"
                    key="play-icon"
                    size={18}
                  />
                )}
                <span
                  className="staff-distance-start-label"
                  key={`${trainingMode}-${isFingerNoAnswerSelected ? "no-answer" : "play"}`}
                >
                  {isStarting ? (
                    <LoadingActivityText kind="dots">正在准备</LoadingActivityText>
                  ) : isFingerNoAnswerSelected ? (
                    "开始免答"
                  ) : (
                    "开始"
                  )}
                </span>
                <kbd>Enter</kbd>
              </button>
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
