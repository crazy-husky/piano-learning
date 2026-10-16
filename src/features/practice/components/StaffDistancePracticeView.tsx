import { Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { writeBackupNow } from "../../../data/backup";
import { db } from "../../../data/db";
import { createUuid } from "../../../domain/id";
import { getNotesForSelection, getStaffSelectedPitchIds } from "../../../domain/notes";
import { validateStaffDistancePractice } from "../../../domain/staffDistancePractice";
import type {
  AppSettings,
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
import { GlobalRangeControls } from "../../../shared/components/GlobalRangeControls";
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";
import {
  isInteractiveShortcutTarget,
  shouldHandleGlobalEnter,
} from "../../../shared/keyboard/keyboardShortcuts";
import { StaffDistanceRun, type StaffDistanceMicrophoneInput } from "./StaffDistanceRun";
import type { PracticeDistanceMode } from "../../../routing/appRoutes";

interface PracticeNavigationExitRequest {
  id: number;
  returnToSetup?: boolean;
  targetView: "home" | "practice" | "stats" | "settings" | "study" | "vocal";
}

interface StaffDistancePreferences extends StaffDistancePracticeSettings {
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
  onNavigationExit?: (targetView: PracticeNavigationExitRequest["targetView"]) => void;
  onPracticeFinished: () => void;
  onPracticeSingleNote: () => void;
  onRunStageChange: (active: boolean) => void;
  onRunningChange: (running: boolean) => void;
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
  sessions: PracticeSessionRecord[];
  settings: AppSettings;
}

const STAFF_DISTANCE_PREFERENCES_KEY = "anki-note.staffDistancePracticePreferences";
const DEFAULT_PREFERENCES: StaffDistancePreferences = {
  includeUnison: true,
  inputMethod: "midi",
  maxDistance: 2,
  fixedCount: 20,
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
  return {
    includeUnison: typeof record.includeUnison === "boolean" ? record.includeUnison : true,
    maxDistance: numberInRange(record.maxDistance, 2, 1, 7),
    fixedCount: numberInRange(record.fixedCount, 20, 1, 500),
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

function isStaffDistanceSession(
  session: PracticeSessionRecord
): session is PracticeSessionRecord & { practiceType: "staff-distance" } {
  return session.practiceType === "staff-distance" && Boolean(session.staffDistance);
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
    return "当前只会出现数字 1。请开启同音 0，或把最大间距调到 2 步以上。";
  }
  const missingDistances = validation.missing?.join("、") ?? "所选";
  if (staffNotationMode === "grand" && validation.missing?.includes(7)) {
    return "当前选择的连续组不符合生成条件，请在高音区（中央 C 右边）选择连续多组音符，或者在低音区（中央 C 左边）选择连续多组音符。";
  }
  return `当前音域在同一谱表内无法生成 ${missingDistances} 步的音对；跨谱表的音不组成一道题。请在当前谱表扩展音域，或缩小最大间距。`;
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
  onNavigationExit,
  onPracticeFinished,
  onPracticeSingleNote,
  onRunStageChange,
  onRunningChange,
  onSettingsSaved,
  sessions,
  settings,
}: StaffDistancePracticeViewProps): JSX.Element {
  const [preferences, setPreferences] = useLocalStorageState(
    STAFF_DISTANCE_PREFERENCES_KEY,
    DEFAULT_PREFERENCES,
    { parse: normalizePreferences }
  );
  const trainingMode = distanceMode ?? preferences.trainingMode;
  const [runSession, setRunSession] = useState<PracticeSessionRecord | null>(null);
  const [summarySession, setSummarySession] = useState<PracticeSessionRecord | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const handledSummaryNavigationRequestRef = useRef<number | null>(null);
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
  const recentSessions = sessions
    .filter(isStaffDistanceSession)
    .filter((session) => Boolean(session.endedAt && session.staffDistance?.questionResults.length))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, 5);
  const isSessionActive = runSession !== null;

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
        setStartError("尚未连接 MIDI 键盘。请先点击“连接 MIDI”，或切换为麦克风输入。");
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
    onBeforePracticeStart,
    preferences,
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
    const hasResults = Boolean(finalSession.staffDistance?.questionResults.length);
    try {
      if (hasResults) {
        await db.practiceSessions.put(finalSession);
        await writeBackupNow().catch(() => undefined);
        await onDataChanged();
      } else {
        await db.practiceSessions.delete(finalSession.id);
      }
    } catch (error) {
      toast.error(
        `保存间距练习记录失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
    setRunSession(null);
    setSummarySession(showSummary && hasResults ? finalSession : null);
    if (showSummary && hasResults) onPracticeFinished();
    onRunningChange(false);
    microphone.stop();
  };

  const toggleUnison = (includeUnison: boolean): void =>
    setPreferences((current) => ({ ...current, includeUnison }));

  const connectMidi = async (): Promise<void> => {
    setStartError(null);
    try {
      await midi.connect();
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "MIDI 连接失败，请重试。");
    }
  };

  if (runSession?.staffDistance) {
    const sessionSettings = {
      includeUnison: runSession.staffDistance.includeUnison,
      maxDistance: runSession.staffDistance.maxDistance,
    };
    const sessionNotes = getDistanceNotes(runSession.staffDistance);
    return (
      <StaffDistanceRun
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
              <h1>{details.trainingMode === "play" ? "弹奏练习完成" : "间距推导完成"}</h1>
              <p>
                {details.trainingMode === "play"
                  ? "你根据当前音弹奏了谱面上的下一个音。"
                  : "这次练习帮助你更快看出谱位移动距离。"}
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
                  <th>距离</th>
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
          {details.trainingMode !== "play" ? (
            <p className="staff-distance-summary-next-step">
              想把看谱反应带到弹奏中？可切换到「弹奏下一个音」继续练习。
            </p>
          ) : null}
          <div className="staff-distance-summary-actions">
            <button
              className="primary"
              onClick={() => {
                setSummarySession(null);
                onPracticeSingleNote();
              }}
              type="button"
            >
              <Play size={16} />
              {details.trainingMode === "play" ? "继续自由练习" : "练习单音弹奏"}
            </button>
            <button onClick={() => setSummarySession(null)} type="button">
              <RotateCcw size={16} />
              再练一局
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="setup-grid staff-distance-setup-grid">
      <section className="panel setup-panel staff-distance-setup-panel">
        <div className="panel-heading">
          <div>
            <h1>间距推导</h1>
            <p className="staff-distance-description">
              看清当前音与下一个音的距离，练习快速判断并找到下一个琴键。
            </p>
          </div>
        </div>

        <GlobalRangeControls
          allowInterStaffLedgerChoice={false}
          settings={settings}
          onSettingsSaved={onSettingsSaved}
        />
        <p className="staff-distance-field-hint">
          加练音会低权重穿插；大谱表按 C4/B3
          分界分别记入高、低音谱，每道间距题仍只比较同一谱表的两个音。
        </p>

        <div className="control-block">
          <span className="control-label">训练方式</span>
          <div aria-label="训练方式" className="staff-distance-training-options" role="group">
            <button
              aria-pressed={trainingMode === "look"}
              className={trainingMode === "look" ? "is-selected" : ""}
              onClick={() => {
                setStartError(null);
                setPreferences((current) => ({ ...current, trainingMode: "look" }));
                onDistanceModeChange("look");
              }}
              type="button"
            >
              <strong>看间距</strong>
              <span>看相邻两音，选择相隔几步</span>
            </button>
            <button
              aria-pressed={trainingMode === "play"}
              className={trainingMode === "play" ? "is-selected" : ""}
              onClick={() => {
                setStartError(null);
                setPreferences((current) => ({ ...current, trainingMode: "play" }));
                onDistanceModeChange("play");
              }}
              type="button"
            >
              <strong>弹奏下一个音</strong>
              <span>根据当前音，弹奏谱面上的下一个音</span>
            </button>
          </div>
        </div>

        {trainingMode === "play" ? (
          <div className="control-block staff-distance-input-method-block">
            <span className="control-label">弹奏输入</span>
            <div aria-label="弹奏输入方式" className="staff-distance-input-methods" role="group">
              {(
                [
                  ["midi", "MIDI 键盘"],
                  ["microphone", "麦克风"],
                ] as const
              ).map(([inputMethod, label]) => (
                <button
                  aria-pressed={preferences.inputMethod === inputMethod}
                  className={preferences.inputMethod === inputMethod ? "is-selected" : ""}
                  key={inputMethod}
                  onClick={() => {
                    setStartError(null);
                    setPreferences((current) => ({ ...current, inputMethod }));
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            {preferences.inputMethod === "midi" ? (
              midi.isConnected ? (
                <p className="staff-distance-field-hint">
                  已连接 {midi.selectedInput?.name ?? "MIDI 键盘"}；按实际音高和八度判定。
                </p>
              ) : (
                <div className="staff-distance-input-status" role="status">
                  <span>{midi.errorMessage ?? "连接 MIDI 键盘后即可开始弹奏。"}</span>
                  <button onClick={() => void connectMidi()} type="button">
                    连接 MIDI
                  </button>
                </div>
              )
            ) : (
              <p className="staff-distance-field-hint">
                开始时请求麦克风权限；按识别到的音高和八度判定。
              </p>
            )}
          </div>
        ) : null}

        <div className="control-block">
          <span className="control-label">练习长度</span>
          <div className="segmented">
            {(
              [
                ["open-ended", "无限"],
                ["fixed-count", "固定题数"],
                ["fixed-duration", "固定时长"],
              ] as const
            ).map(([mode, label]) => (
              <button
                className={preferences.mode === mode ? "active" : ""}
                key={mode}
                onClick={() => setPreferences((current) => ({ ...current, mode }))}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {preferences.mode === "fixed-count" ? (
          <div className="control-block">
            <span className="control-label">题数</span>
            <div className="number-row">
              {[10, 20, 50, 100].map((count) => (
                <button
                  className={preferences.fixedCount === count ? "active" : ""}
                  key={count}
                  onClick={() => setPreferences((current) => ({ ...current, fixedCount: count }))}
                  type="button"
                >
                  {count}
                </button>
              ))}
              <label className="staff-distance-count-input">
                <span>自定义</span>
                <input
                  max={500}
                  min={1}
                  type="number"
                  value={preferences.fixedCount}
                  onChange={(event) =>
                    setPreferences((current) => ({
                      ...current,
                      fixedCount: Math.min(500, Math.max(1, Number(event.target.value) || 1)),
                    }))
                  }
                />
              </label>
            </div>
          </div>
        ) : null}
        {preferences.mode === "fixed-duration" ? (
          <div className="control-block">
            <label className="control-label" htmlFor="staff-distance-duration">
              时长（分钟）
            </label>
            <input
              id="staff-distance-duration"
              max={120}
              min={1}
              step={1}
              type="number"
              value={Math.round(preferences.fixedDurationSeconds / 60)}
              onChange={(event) =>
                setPreferences((current) => ({
                  ...current,
                  fixedDurationSeconds: Math.min(
                    7200,
                    Math.max(60, Number(event.target.value) * 60 || 60)
                  ),
                }))
              }
            />
          </div>
        ) : null}

        <div className="control-block">
          <span className="control-label">谱面音符时值</span>
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
            可多选；按 4/4 拍组合节奏，八分、十六分按拍连梁，不出现休止或空拍。至少保留一种。
          </p>
        </div>

        <div className="control-block">
          <span className="control-label">最大间距</span>
          <div aria-label="最大间距" className="staff-distance-range-options" role="group">
            {Array.from({ length: 7 }, (_, index) => index + 1).map((distance) => (
              <button
                aria-pressed={preferences.maxDistance === distance}
                className={preferences.maxDistance === distance ? "is-selected" : ""}
                key={distance}
                onClick={() => setPreferences((current) => ({ ...current, maxDistance: distance }))}
                type="button"
              >
                {distance} 步
              </button>
            ))}
          </div>
          <p className="staff-distance-field-hint">
            每跨一个相邻的线位或间位，算 1 步。C 到上方 C 是 7 步。
          </p>
        </div>

        <div className="control-block">
          <label className="practice-checkbox-option">
            <input
              checked={preferences.includeUnison}
              type="checkbox"
              onChange={(event) => toggleUnison(event.target.checked)}
            />
            <span>练同音重复（0 步）</span>
          </label>
          {preferences.maxDistance === 7 ? (
            <p className="staff-distance-field-hint">
              7 步题至少需要两个连续音组；大谱表还需在同一谱表内找到相隔 7
              步的音对，分属高、低音谱的音不能组成一题。
            </p>
          ) : null}
        </div>

        <div className="staff-distance-definition">
          <strong>怎么看步数</strong>
          <span>do → mi 输入 2；fa → 上方 do 输入 4；下行只看距离，同音重复输入 0。</span>
        </div>

        {setupDisabledReason ? (
          <p className="staff-distance-setup-error" role="status">
            {startError ?? setupDisabledReason}
          </p>
        ) : null}
        {startError && !setupDisabledReason ? (
          <p className="staff-distance-setup-error" role="alert">
            {startError}
          </p>
        ) : null}

        <div className="action-row">
          <button
            className="primary"
            disabled={Boolean(setupDisabledReason) || isStarting}
            onClick={() => void startSession()}
            type="button"
          >
            <Play size={17} />
            {isStarting ? "正在准备…" : trainingMode === "look" ? "开始看间距" : "开始弹奏"}
            <kbd>Enter</kbd>
          </button>
        </div>
      </section>

      {recentSessions.length > 0 ? (
        <section aria-label="最近的间距练习" className="panel staff-distance-history-panel">
          <h2>最近练习</h2>
          <ul>
            {recentSessions.map((session) => {
              const results = session.staffDistance!.questionResults;
              const correct = results.filter((result) => result.firstTryCorrect).length;
              return (
                <li key={session.id}>
                  <span>{new Date(session.startedAt).toLocaleDateString()}</span>
                  <span>≤{session.staffDistance!.maxDistance} 步</span>
                  <strong>{percentage(correct, results.length)}</strong>
                  <span>{formatMedianResponse(session)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
