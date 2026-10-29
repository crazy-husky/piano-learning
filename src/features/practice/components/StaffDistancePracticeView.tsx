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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { writeBackupNow } from "../../../data/backup";
import { db } from "../../../data/db";
import { createUuid } from "../../../domain/id";
import { getNotesForSelection, getStaffSelectedPitchIds } from "../../../domain/notes";
import { validateStaffDistancePractice } from "../../../domain/staffDistancePractice";
import type {
  AppSettings,
  PitchId,
  PracticeMode,
  PracticeSessionRecord,
  PromptNoteDuration,
  StaffDistanceInputMethod,
  StaffDistancePracticeSettings,
  StaffDistanceTrainingMode,
  StaffNotationMode,
} from "../../../domain/types";
import type { PracticeAnswerInput } from "../../../domain/answerInput";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { getMidiUnavailableNotice } from "../../../midi/midiUnavailableNotice";
import type { PracticeChaseSettings } from "./PracticeChaseSettingsDialog";
import { MidiInputControl } from "../../../midi/MidiInputControl";
import { GlobalRangeControls } from "../../../shared/components/GlobalRangeControls";
import { BoundedNumberInput } from "../../../shared/components/BoundedNumberInput";
import { PracticeMicrophoneRetryButton } from "../../../shared/components/PracticeMicrophoneRetryButton";
import { useConfirmDialog } from "../../../shared/components/ui/ConfirmDialog";
import { useMidiConnectionAttention } from "../../../shared/hooks/useMidiConnectionAttention";
import { LoadingActivityText } from "../../../shared/components/LoadingActivity";
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";
import {
  isInteractiveShortcutTarget,
  shouldHandleGlobalEnter,
} from "../../../shared/keyboard/keyboardShortcuts";
import { StaffDistanceRun, type StaffDistanceMicrophoneInput } from "./StaffDistanceRun";
import type { PracticeDistanceMode } from "../../../routing/appRoutes";
import { PRACTICE_FIXED_COUNT_PRESETS } from "../logic/practiceLengthOptions";
import {
  DEFAULT_SCORE_CHASE_PREFERENCES,
  SCORE_CHASE_SPEED_OPTIONS,
  type ChaseHandMode,
} from "../logic/scoreChase";

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
  inputMethod: StaffDistanceInputMethod;
  mode: PracticeMode;
  noteDurations: PromptNoteDuration[];
  trainingMode: StaffDistanceTrainingMode;
}

interface StaffDistancePracticeViewProps {
  isActive: boolean;
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
  onInputModeChange: (mode: "midi" | "microphone") => void;
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
  maxDistance: 2,
  fixedCount: 30,
  fixedDurationSeconds: 60,
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
    inputMethod: record.inputMethod === "microphone" ? "microphone" : "midi",
    mode:
      record.mode === "open-ended" ||
      record.mode === "fixed-count" ||
      record.mode === "fixed-duration"
        ? record.mode
        : "fixed-count",
    noteDurations: selectedDurations.length > 0 ? selectedDurations : ["quarter"],
    trainingMode: record.trainingMode === "play" ? "play" : "look",
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
  preferences: StaffDistancePreferences
): PracticeSessionRecord {
  const startedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: createUuid(),
    practiceType: "staff-distance",
    mode: preferences.mode,
    enabledGroupIds: [],
    fixedCount: preferences.mode === "fixed-count" ? preferences.fixedCount : undefined,
    fixedDurationSeconds:
      preferences.mode === "fixed-duration" ? preferences.fixedDurationSeconds : undefined,
    startedAt,
    completedCount: 0,
    interruptedCount: 0,
    staffDistance: {
      enabledGroupIds: [...settings.enabledGroupIds],
      enabledPitchIds: settings.enabledPitchIds ? [...settings.enabledPitchIds] : undefined,
      crossGroupPitchIds: [...(settings.crossGroupPitchIds ?? [])],
      includeInterStaffLedgerSpellings:
        settings.staffNotationMode === "grand" ? false : settings.includeInterStaffLedgerSpellings,
      includeUnison: preferences.includeUnison,
      inputMethod: preferences.trainingMode === "play" ? preferences.inputMethod : undefined,
      maxDistance: preferences.maxDistance,
      noteDuration:
        preferences.noteDurations.length === 1 ? preferences.noteDurations[0] : undefined,
      noteDurations: [...preferences.noteDurations],
      questionResults: [],
      staffNotationMode: settings.staffNotationMode,
      trainingMode: preferences.trainingMode,
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
  const confirmDialog = useConfirmDialog();
  const {
    canRequestConnection: canRequestMidiConnection,
    isActive: isMidiConnectionAttentionActive,
    show: showMidiConnectionAttention,
  } = useMidiConnectionAttention(midi);
  const [midiAttentionSource, setMidiAttentionSource] = useState<"input-mode" | "start" | null>(
    null
  );
  const showMidiAttention = useCallback(
    (source: "input-mode" | "start"): void => {
      setMidiAttentionSource(source);
      showMidiConnectionAttention();
    },
    [showMidiConnectionAttention]
  );
  const [preferences, setPreferences] = useLocalStorageState(
    STAFF_DISTANCE_PREFERENCES_KEY,
    DEFAULT_PREFERENCES,
    { parse: normalizePreferences }
  );
  const previousMidiConnectionRef = useRef(midi.isConnected);
  const inputMethodSelectionRevisionRef = useRef(0);
  const setInputMethod = useCallback(
    (inputMethod: StaffDistanceInputMethod): void => {
      inputMethodSelectionRevisionRef.current += 1;
      setPreferences((current) => ({ ...current, inputMethod }));
    },
    [setPreferences]
  );
  useLayoutEffect(() => {
    if (isActive) onInputModeChange(preferences.inputMethod);
  }, [isActive, onInputModeChange, preferences.inputMethod]);
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
  const trainingMode = distanceMode ?? preferences.trainingMode;
  const [runSession, setRunSession] = useState<PracticeSessionRecord | null>(null);
  const [summarySession, setSummarySession] = useState<PracticeSessionRecord | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const handledSummaryNavigationRequestRef = useRef<number | null>(null);
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
  const setupDisabledReason = describeValidation(validation, settings.staffNotationMode);
  const isSevenStepRangeInvalid = preferences.maxDistance === 7 && Boolean(setupDisabledReason);
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
      trainingMode !== "play" ||
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

  const startSession = useCallback(async (): Promise<void> => {
    if (isStarting || setupDisabledReason) return;
    setIsStarting(true);
    setStartError(null);
    let microphoneStarted = false;
    try {
      if (trainingMode === "play" && preferences.inputMethod === "midi" && !midi.isConnected) {
        const notice = getMidiUnavailableNotice(midi.status);
        if (notice) {
          setStartError(null);
          void confirmDialog({ ...notice, confirmLabel: "确认", confirmOnly: true });
        } else {
          showMidiAttention("start");
          setStartError("尚未连接 MIDI 键盘。请先点击“连接 MIDI”，或切换为麦克风输入。");
        }
        return;
      }
      const preflight = await onBeforePracticeStart();
      if (!preflight.proceed) return;
      const currentSettings = preflight.settings ?? settings;
      const sessionNotes = getDistanceNotes(currentSettings);
      const nextValidation = validateStaffDistancePractice(
        sessionNotes,
        getStaffSelectedPitchIds(
          currentSettings.enabledGroupIds,
          currentSettings.enabledPitchIds,
          currentSettings.crossGroupPitchIds,
          currentSettings.staffNotationMode
        ),
        intervalSettings
      );
      const nextValidationError = describeValidation(
        nextValidation,
        currentSettings.staffNotationMode
      );
      if (nextValidationError) {
        setStartError(nextValidationError);
        return;
      }
      if (trainingMode === "play" && preferences.inputMethod === "microphone") {
        const microphoneReady = await microphone.start({ includeAccidentals: false });
        if (!microphoneReady) {
          setStartError(microphone.error ?? "麦克风未能启动，请检查权限和输入设备后重试。");
          return;
        }
        microphoneStarted = true;
      }
      const nextSession = createDistanceSession(currentSettings, {
        ...preferences,
        trainingMode,
      });
      await db.practiceSessions.put(nextSession);
      setRunSession(nextSession);
    } catch (error) {
      if (microphoneStarted) microphone.stop();
      setStartError(error instanceof Error ? error.message : "练习未能开始，请重试。");
    } finally {
      setIsStarting(false);
    }
  }, [
    intervalSettings,
    isStarting,
    microphone,
    midi.isConnected,
    midi.status,
    onBeforePracticeStart,
    preferences,
    confirmDialog,
    showMidiAttention,
    settings,
    setupDisabledReason,
    trainingMode,
  ]);

  useEffect(() => {
    if (!isActive || runSession || summarySession) return undefined;
    function onEnter(event: KeyboardEvent): void {
      if (!shouldHandleGlobalEnter(event, isInteractiveShortcutTarget(event.target))) return;
      if (setupDisabledReason) return;
      event.preventDefault();
      void startSession();
    }
    window.addEventListener("keydown", onEnter);
    return () => window.removeEventListener("keydown", onEnter);
  }, [isActive, runSession, setupDisabledReason, startSession, summarySession]);

  const finishSession = async (
    finalSession: PracticeSessionRecord,
    showSummary: boolean
  ): Promise<void> => {
    const answerEvents = await db.answerEvents.where("sessionId").equals(finalSession.id).toArray();
    const questionResults = answerEvents.flatMap((event) =>
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
      ? { ...finalSession, staffDistance: { ...finalSession.staffDistance, questionResults: [] } }
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

  const toggleUnison = (includeUnison: boolean): void =>
    setPreferences((current) => ({ ...current, includeUnison }));

  if (runSession?.staffDistance) {
    const sessionSettings = {
      includeUnison: runSession.staffDistance.includeUnison,
      maxDistance: runSession.staffDistance.maxDistance,
    };
    const sessionNotes = getDistanceNotes(runSession.staffDistance);
    return (
      <StaffDistanceRun
        chaseSettings={{
          enabled: preferences.chaseEnabled,
          handMode: preferences.chaseHandMode,
          speedMultiplier: preferences.chaseSpeedMultiplier,
          startCount: preferences.chaseStartCount,
        }}
        fixedCount={runSession.fixedCount ?? preferences.fixedCount}
        fixedDurationSeconds={runSession.fixedDurationSeconds ?? preferences.fixedDurationSeconds}
        mode={runSession.mode}
        trainingMode={runSession.staffDistance.trainingMode ?? "look"}
        inputMethod={runSession.staffDistance.inputMethod ?? preferences.inputMethod}
        midi={midi}
        microphone={microphone}
        onMicrophoneAnswerHandlerChange={onMicrophoneAnswerHandlerChange}
        navigationExitRequest={navigationExitRequest}
        notes={sessionNotes}
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
        useLedgerGap={sessionNotes.some((note) => note.isInterStaffLedgerSpelling)}
      />
    );
  }

  if (summarySession?.staffDistance) {
    const details = summarySession.staffDistance;
    const results = details.questionResults;
    const correctCount = results.filter((result) => result.firstTryCorrect).length;
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
                {details.trainingMode === "play"
                  ? "你根据当前音弹奏了谱面上的下一个音。"
                  : "这次练习帮助你更快看出两个音之间的音距。"}
              </p>
            </div>
          </header>
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
          <div className="staff-distance-summary-actions">
            <button onClick={() => setSummarySession(null)} type="button">
              <Settings2 size={16} />
              返回配置
            </button>
            <button
              className="primary"
              onClick={() => {
                setSummarySession(null);
                void startSession();
              }}
              type="button"
            >
              <RotateCcw size={16} />
              再来一次
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="practice-free-page practice-setup-framed-page staff-distance-page">
      <header className="practice-free-page-header">
        <div>
          <h1 id="staff-distance-title">音距速推</h1>
          <p className="practice-panel-description staff-distance-description">
            看清当前音与下一个音的音距，练习快速判断并找到下一个琴键。
          </p>
        </div>
        {trainingMode === "play" && preferences.inputMethod === "midi" ? (
          <div className="practice-setup-heading-meta">
            <div className="practice-midi-heading-status staff-distance-midi-status">
              <MidiInputControl
                ariaLabel="音距速推 MIDI 输入设备"
                className={isMidiConnectionAttentionActive ? "needs-attention" : undefined}
                midi={midi}
              />
            </div>
          </div>
        ) : null}
      </header>

      <section className="practice-free-range-section staff-distance-range-base">
        <GlobalRangeControls
          allowInterStaffLedgerChoice={false}
          compactSummary
          rangeControlPart="base"
          settings={settings}
          onSettingsSaved={onSettingsSaved}
        />
      </section>

      <section
        aria-label="基础练习设置"
        className="practice-free-basics-grid staff-distance-basic-settings"
      >
        <div className="practice-free-field staff-distance-setting-block staff-distance-training-block">
          <span className="control-label">训练方式</span>
          <div className="staff-distance-setting-content staff-distance-training-content">
            <div
              aria-label="训练方式"
              className="segmented staff-distance-training-options"
              role="group"
            >
              <button
                aria-pressed={trainingMode === "look"}
                className={trainingMode === "look" ? "active" : ""}
                onClick={() => {
                  setStartError(null);
                  setPreferences((current) => ({ ...current, trainingMode: "look" }));
                  onDistanceModeChange("look");
                }}
                type="button"
              >
                看音距
              </button>
              <button
                aria-pressed={trainingMode === "play"}
                className={trainingMode === "play" ? "active" : ""}
                onClick={() => {
                  setStartError(null);
                  setPreferences((current) => ({ ...current, trainingMode: "play" }));
                  onDistanceModeChange("play");
                }}
                type="button"
              >
                弹奏下一个音
              </button>
            </div>
            {trainingMode === "play" ? (
              <div className="staff-distance-input-switch">
                <span>输入</span>
                <div
                  aria-label="弹奏输入方式"
                  className="segmented staff-distance-input-methods"
                  role="group"
                >
                  <button
                    aria-pressed={preferences.inputMethod === "microphone"}
                    className={preferences.inputMethod === "microphone" ? "active" : ""}
                    onClick={() => {
                      setStartError(null);
                      setInputMethod("microphone");
                    }}
                    type="button"
                  >
                    <Mic aria-hidden="true" size={14} /> 麦克风
                  </button>
                  <button
                    aria-pressed={preferences.inputMethod === "midi"}
                    className={preferences.inputMethod === "midi" ? "active" : ""}
                    disabled={
                      !midi.isConnected &&
                      (midi.status === "unsupported" || midi.status === "insecure-context")
                    }
                    onClick={() => {
                      setStartError(null);
                      setInputMethod("midi");
                      if (canRequestMidiConnection) showMidiAttention("input-mode");
                    }}
                    type="button"
                    title={!midi.isConnected ? "连接 MIDI 后可用" : undefined}
                  >
                    <Cable aria-hidden="true" size={14} /> MIDI
                  </button>
                </div>
              </div>
            ) : null}
            {trainingMode === "play" && preferences.inputMethod === "midi" && !midi.isConnected ? (
              <p
                className={`practice-free-warning${isMidiConnectionAttentionActive && midiAttentionSource === "input-mode" ? " is-midi-attention" : ""}`}
                role="status"
              >
                请连接并选择 MIDI 设备，再开始练习。
              </p>
            ) : null}
            {trainingMode === "play" &&
            preferences.inputMethod === "microphone" &&
            (microphone.error ||
              microphone.status === "error" ||
              microphone.status === "requesting" ||
              microphone.isPreparingSwiftF0) ? (
              <div
                className="practice-microphone-error-actions staff-distance-microphone-error"
                aria-live="polite"
              >
                <span>
                  {microphone.status === "requesting"
                    ? microphone.isPreparingSwiftF0
                      ? "正在准备识别模型…"
                      : "正在连接麦克风…"
                    : (microphone.error ?? "麦克风连接失败，请检查权限和输入设备后重试。")}
                </span>
                <PracticeMicrophoneRetryButton
                  isConnecting={microphone.status === "requesting"}
                  isPreparingModel={microphone.isPreparingSwiftF0}
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
                  每跨一个相邻线位或间位算 1 步；方向只决定上行或下行，音距步数相同；同音重复算 0
                  步。
                </span>
              </details>
            </div>
          </div>
          <div className="staff-distance-setting-content">
            <div aria-label="最大音距" className="staff-distance-range-options" role="group">
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
            {isSevenStepRangeInvalid ? (
              <p className="staff-distance-setup-error" role="status">
                {setupDisabledReason}
              </p>
            ) : null}
          </div>
        </div>

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
                      setPreferences((current) => ({ ...current, fixedCount: customFixedCount }));
                      window.requestAnimationFrame(() => customFixedCountInputRef.current?.focus());
                    }}
                    type="button"
                  >
                    自定义
                  </button>
                )}
              </div>
            ) : null}
            {preferences.mode === "fixed-duration" ? (
              <label className="staff-distance-duration-input" htmlFor="staff-distance-duration">
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
      </section>

      <details className="staff-distance-advanced">
        <summary className="practice-free-advanced-toggle staff-distance-advanced-toggle">
          <Settings2 aria-hidden="true" size={16} />
          <span>更多设置</span>
          <span className="practice-free-advanced-count">4组</span>
          <ChevronDown aria-hidden="true" className="staff-distance-advanced-chevron" size={16} />
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

      <footer aria-label="开始音距速推练习" className="practice-free-action-dock">
        <div aria-label="当前配置摘要" className="practice-free-config-summary">
          <span className="practice-free-summary-label">当前配置</span>
          <span className="practice-free-summary-chip">{staffLabel}</span>
          <span className="practice-free-summary-chip">{preferences.maxDistance}步</span>
          <span className="practice-free-summary-chip">{lengthLabel}</span>
          {trainingMode === "play" ? (
            <span className="practice-free-summary-chip">
              {preferences.inputMethod === "microphone" ? "麦克风" : "MIDI"}
            </span>
          ) : null}
        </div>
        <div className="practice-free-action-buttons staff-distance-action-controls">
          {startError &&
          !(
            trainingMode === "play" &&
            preferences.inputMethod === "microphone" &&
            (microphone.error ||
              microphone.status === "error" ||
              microphone.status === "requesting")
          ) ? (
            <p className="staff-distance-start-error" role="alert">
              {startError}
            </p>
          ) : null}
          <span
            className="practice-start-action staff-distance-start-wrap"
            tabIndex={setupDisabledReason && !isSevenStepRangeInvalid ? 0 : undefined}
            title={
              setupDisabledReason && !isSevenStepRangeInvalid ? setupDisabledReason : undefined
            }
          >
            <button
              aria-keyshortcuts="Enter"
              className="primary practice-free-start-button staff-distance-start-button"
              disabled={Boolean(setupDisabledReason) || isStarting}
              onClick={() => void startSession()}
              type="button"
            >
              {isStarting ? null : trainingMode === "look" ? (
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
              <span className="staff-distance-start-label" key={trainingMode}>
                {isStarting ? (
                  <LoadingActivityText kind="dots">正在准备</LoadingActivityText>
                ) : trainingMode === "look" ? (
                  "开始音距速推"
                ) : (
                  "开始弹奏"
                )}
              </span>
              <kbd>Enter</kbd>
            </button>
          </span>
        </div>
      </footer>
    </div>
  );
}
