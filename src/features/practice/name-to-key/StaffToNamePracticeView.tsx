import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Square } from "lucide-react";
import { toast } from "sonner";
import { answerDeviceInfo } from "../../../data/answerEvents";
import { deletePracticeSessionWithReviews, saveAnswerEvents } from "../../../data/db";
import { createUuid } from "../../../domain/id";
import { getNotesForGroups, NOTE_NAMES, PRACTICE_GROUPS } from "../../../domain/notes";
import type {
  AnswerAttempt,
  AnswerEvent,
  CurrentPracticeGroupId,
  NoteName,
  PracticeMode,
  TargetNote,
} from "../../../domain/types";
import { MAX_PRACTICE_QUESTIONS } from "../../../domain/practiceLimits";
import { BoundedNumberInput } from "../../../shared/components/BoundedNumberInput";
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";
import { StaffPrompt } from "../components/StaffPrompt";
import { PRACTICE_FIXED_COUNT_PRESETS } from "../logic/practiceLengthOptions";
import staffReadingTipsOverview from "./assets/staff-reading-tips/staff-reading-tips-overview.png";
import staffSpacesFace from "./assets/staff-reading-tips/staff-spaces-face.png";
import staffLinesEgbdf from "./assets/staff-reading-tips/staff-lines-egbdf.png";

const STAFF_TO_NAME_PREFERENCES_KEY = "anki-note.staffToNamePreferences.v1";
const DEFAULT_STAFF_TO_NAME_PREFERENCES: StaffToNamePreferences = {
  enabledGroupIds: ["C4-B4"],
  fixedCount: 30,
  fixedDurationSeconds: 60,
  mode: "fixed-count",
};
const GROUP_LABELS: Record<CurrentPracticeGroupId, string> = {
  "C2-B2": "大字组",
  "C3-B3": "小字组",
  "C4-B4": "小字一组",
  "C5-B5": "小字二组",
  "C6-B6": "小字三组",
};

type StaffToNameStage = "setup" | "running" | "summary";

interface StaffToNamePreferences {
  enabledGroupIds: CurrentPracticeGroupId[];
  fixedCount: number;
  fixedDurationSeconds: number;
  mode: PracticeMode;
}

interface StaffToNamePracticeViewProps {
  isActive: boolean;
  showRestartControl?: boolean;
  navigationExitRequest?: {
    id: number;
    targetView: "home" | "practice" | "stats" | "settings" | "study" | "vocal" | "metronome";
  } | null;
  onBeforePracticeStart: () => Promise<{ proceed: boolean }>;
  onDataChanged: () => Promise<void>;
  onNavigationExit?: (
    targetView: NonNullable<StaffToNamePracticeViewProps["navigationExitRequest"]>["targetView"]
  ) => void;
  onPracticeFinished: () => void;
  onRunningChange: (running: boolean) => void;
  onStageChange: (active: boolean) => void;
}

interface StaffToNameFeedback {
  correctNoteName: NoteName;
  selectedNoteName: NoteName;
  state: "correct" | "wrong";
}

function StaffReadingTips(): JSX.Element {
  return (
    <details className="staff-to-name-tips">
      <summary>
        <span>
          <strong>看谱技巧</strong>
          <small>展开查看五线谱音名记忆口诀</small>
        </span>
      </summary>
      <div className="staff-to-name-tips-gallery">
        <figure>
          <img
            alt="巧记五线谱：间上的音名 FACE，线上的音名 E、G、B、D、F"
            decoding="async"
            loading="lazy"
            src={staffReadingTipsOverview}
          />
        </figure>
        <figure>
          <img
            alt="高音谱表间上的音名从下到上是 F、A、C、E，可记作 FACE"
            decoding="async"
            loading="lazy"
            src={staffSpacesFace}
          />
        </figure>
        <figure>
          <img
            alt="高音谱表线上的音名从下到上是 E、G、B、D、F，可记作二哥贝多芬"
            decoding="async"
            loading="lazy"
            src={staffLinesEgbdf}
          />
        </figure>
      </div>
    </details>
  );
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function parsePreferences(
  value: unknown,
  fallback: StaffToNamePreferences
): StaffToNamePreferences {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<StaffToNamePreferences>;
  const validGroupIds = new Set(PRACTICE_GROUPS.map((group) => group.id));
  const enabledGroupIds = Array.isArray(candidate.enabledGroupIds)
    ? candidate.enabledGroupIds.filter(
        (id): id is CurrentPracticeGroupId =>
          typeof id === "string" && validGroupIds.has(id as CurrentPracticeGroupId)
      )
    : fallback.enabledGroupIds;
  return {
    enabledGroupIds,
    fixedCount: numberInRange(candidate.fixedCount, fallback.fixedCount, 1, MAX_PRACTICE_QUESTIONS),
    fixedDurationSeconds: numberInRange(
      candidate.fixedDurationSeconds,
      fallback.fixedDurationSeconds,
      60,
      7200
    ),
    mode:
      candidate.mode === "open-ended" || candidate.mode === "fixed-duration"
        ? candidate.mode
        : "fixed-count",
  };
}

function formatRemainingTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  return milliseconds < 1000
    ? `${Math.round(milliseconds)} 毫秒`
    : `${(milliseconds / 1000).toFixed(1)} 秒`;
}

export function StaffToNamePracticeView({
  isActive,
  showRestartControl = false,
  navigationExitRequest,
  onBeforePracticeStart,
  onDataChanged,
  onNavigationExit,
  onPracticeFinished,
  onRunningChange,
  onStageChange,
}: StaffToNamePracticeViewProps): JSX.Element {
  const [preferences, setPreferences] = useLocalStorageState(
    STAFF_TO_NAME_PREFERENCES_KEY,
    DEFAULT_STAFF_TO_NAME_PREFERENCES,
    { parse: parsePreferences }
  );
  const [stage, setStage] = useState<StaffToNameStage>("setup");
  const [target, setTarget] = useState<TargetNote | null>(null);
  const [roundEvents, setRoundEvents] = useState<AnswerEvent[]>([]);
  const [feedback, setFeedback] = useState<StaffToNameFeedback | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [customCount, setCustomCount] = useState(preferences.fixedCount);
  const [customCountSelected, setCustomCountSelected] = useState(
    () =>
      !PRACTICE_FIXED_COUNT_PRESETS.includes(
        preferences.fixedCount as (typeof PRACTICE_FIXED_COUNT_PRESETS)[number]
      )
  );
  const [statusMessage, setStatusMessage] = useState("");
  const targetRef = useRef<TargetNote | null>(null);
  const lastTargetIdRef = useRef<TargetNote["id"] | null>(null);
  const targetResolvedRef = useRef(true);
  const attemptsRef = useRef<AnswerAttempt[]>([]);
  const eventsRef = useRef<AnswerEvent[]>([]);
  const sessionIdRef = useRef("");
  const eventIndexRef = useRef(0);
  const promptStartedAtRef = useRef(0);
  const promptStartedAtIsoRef = useRef(new Date().toISOString());
  const pauseStartedAtRef = useRef(0);
  const pausedPromptMsRef = useRef(0);
  const endAtRef = useRef(0);
  const remainingMsRef = useRef(0);
  const advanceTimerRef = useRef<number | undefined>(undefined);
  const eventSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const handledNavigationExitRequestRef = useRef<number | null>(null);
  const finishRoundRef = useRef<(showSummary?: boolean) => void>(() => undefined);
  const startRequestGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const targetPool = useMemo(
    () => getNotesForGroups(preferences.enabledGroupIds, false),
    [preferences.enabledGroupIds]
  );
  const availableGroupCount = preferences.enabledGroupIds.length;
  const rangeSummary = preferences.enabledGroupIds
    .map((id) => `${GROUP_LABELS[id]} ${id.replace("-", "–")}`)
    .join("、");
  const durationMs = preferences.fixedDurationSeconds * 1000;
  const responseTimes = roundEvents
    .map((event) => event.responseTimeMs)
    .filter((value): value is number => value !== undefined && value !== null && value > 0);
  const averageResponseMs = responseTimes.length
    ? responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length
    : null;
  const answeredEvents = roundEvents.filter((event) => event.isCorrectFinal !== null);
  const correctCount = answeredEvents.filter((event) => event.isCorrectFinal === true).length;
  const accuracy = answeredEvents.length
    ? Math.round((correctCount / answeredEvents.length) * 100)
    : null;

  useEffect(() => {
    if (!isActive) startRequestGenerationRef.current += 1;
  }, [isActive]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startRequestGenerationRef.current += 1;
    };
  }, []);

  const setNextTarget = useCallback((): void => {
    if (targetPool.length === 0) return;
    const candidates = targetPool.filter((note) => note.id !== lastTargetIdRef.current);
    const next = (candidates.length > 0 ? candidates : targetPool)[
      Math.floor(Math.random() * (candidates.length > 0 ? candidates : targetPool).length)
    ];
    if (!next) return;
    lastTargetIdRef.current = next.id;
    attemptsRef.current = [];
    pausedPromptMsRef.current = 0;
    promptStartedAtRef.current = performance.now();
    promptStartedAtIsoRef.current = new Date().toISOString();
    targetResolvedRef.current = false;
    targetRef.current = next;
    setTarget(next);
    setFeedback(null);
  }, [targetPool]);

  const persistEvent = useCallback((event: AnswerEvent): void => {
    eventsRef.current = [...eventsRef.current, event];
    setRoundEvents(eventsRef.current);
    eventSaveQueueRef.current = eventSaveQueueRef.current
      .then(() => saveAnswerEvents([event]))
      .catch(() => {
        toast.error("部分练习记录暂时保存失败。", { duration: 3500 });
      });
  }, []);

  const finishRound = useCallback(
    (showSummary = true): void => {
      if (stage !== "running") return;
      if (advanceTimerRef.current !== undefined) window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = undefined;
      const currentTarget = targetRef.current;
      if (currentTarget && !targetResolvedRef.current) {
        const attempts = attemptsRef.current;
        const now = new Date();
        const totalPausedMs =
          pausedPromptMsRef.current +
          (isPaused && pauseStartedAtRef.current > 0
            ? performance.now() - pauseStartedAtRef.current
            : 0);
        const responseMs = attempts.length
          ? Math.max(0, performance.now() - promptStartedAtRef.current - totalPausedMs)
          : null;
        const missed = attempts.length === 0;
        persistEvent({
          id: `${sessionIdRef.current}:staff-to-name:${eventIndexRef.current}`,
          dataSetId: "",
          sessionId: sessionIdRef.current,
          eventIndex: eventIndexRef.current,
          occurredAt: now.toISOString(),
          promptStartedAt: promptStartedAtIsoRef.current,
          promptEndedAt: now.toISOString(),
          mode: "staff-to-name",
          inputMode: attempts[0]?.inputMode ?? "virtual-keyboard",
          deviceInfo: answerDeviceInfo(),
          targetNoteName: currentTarget.noteName,
          targetOctave: currentTarget.octave,
          targetDisplayName: `${currentTarget.noteName}${currentTarget.octave}`,
          staffToNameConfig: { enabledGroupIds: [...preferences.enabledGroupIds] },
          attempts,
          isCorrectFirstTry: attempts[0]?.isCorrect ?? null,
          isCorrectFinal: missed ? null : false,
          rawResponseTimeMs: responseMs,
          responseTimeMs: responseMs,
          activeMs: responseMs ?? 0,
          wrongAttempts: attempts.filter((attempt) => !attempt.isCorrect).length,
          isExtraNote: false,
          isMissed: missed,
          ...(missed ? {} : { wasSkipped: true }),
        });
        eventIndexRef.current += 1;
        targetResolvedRef.current = true;
        targetRef.current = null;
      }
      setTarget(null);
      setFeedback(null);
      setIsPaused(false);
      setRemainingMs(0);
      remainingMsRef.current = 0;
      setStage(showSummary ? "summary" : "setup");
      onRunningChange(false);
      onStageChange(false);
      onPracticeFinished();
      void eventSaveQueueRef.current.then(() => onDataChanged());
    },
    [
      onDataChanged,
      onPracticeFinished,
      onRunningChange,
      onStageChange,
      persistEvent,
      preferences.enabledGroupIds,
      isPaused,
      stage,
    ]
  );
  finishRoundRef.current = finishRound;

  const finishPrompt = useCallback(
    (isCorrectFinal: boolean, wasSkipped = false): void => {
      const currentTarget = targetRef.current;
      if (!currentTarget || targetResolvedRef.current) return;
      targetResolvedRef.current = true;
      const attempts = attemptsRef.current;
      const now = new Date();
      const responseMs = Math.max(
        0,
        performance.now() - promptStartedAtRef.current - pausedPromptMsRef.current
      );
      persistEvent({
        id: `${sessionIdRef.current}:staff-to-name:${eventIndexRef.current}`,
        dataSetId: "",
        sessionId: sessionIdRef.current,
        eventIndex: eventIndexRef.current,
        occurredAt: now.toISOString(),
        promptStartedAt: promptStartedAtIsoRef.current,
        promptEndedAt: now.toISOString(),
        mode: "staff-to-name",
        inputMode: attempts[0]?.inputMode ?? "virtual-keyboard",
        deviceInfo: answerDeviceInfo(),
        targetNoteName: currentTarget.noteName,
        targetOctave: currentTarget.octave,
        targetDisplayName: `${currentTarget.noteName}${currentTarget.octave}`,
        staffToNameConfig: { enabledGroupIds: [...preferences.enabledGroupIds] },
        attempts,
        isCorrectFirstTry: attempts[0]?.isCorrect ?? null,
        isCorrectFinal,
        rawResponseTimeMs: responseMs,
        responseTimeMs: responseMs,
        activeMs: responseMs,
        wrongAttempts: attempts.filter((attempt) => !attempt.isCorrect).length,
        isExtraNote: false,
        isMissed: false,
        ...(wasSkipped ? { wasSkipped: true } : {}),
      });
      eventIndexRef.current += 1;
      setFeedback({
        correctNoteName: currentTarget.noteName,
        selectedNoteName: attempts.at(-1)?.noteName ?? currentTarget.noteName,
        state: isCorrectFinal ? "correct" : "wrong",
      });
      if (isCorrectFinal) targetRef.current = null;
      const completeCount = eventsRef.current.length;
      const reachesQuestionCount =
        preferences.mode === "fixed-count" && completeCount >= preferences.fixedCount;
      if (reachesQuestionCount) {
        advanceTimerRef.current = window.setTimeout(() => finishRoundRef.current(), 650);
        return;
      }
      if (isCorrectFinal || wasSkipped) {
        advanceTimerRef.current = window.setTimeout(() => {
          advanceTimerRef.current = undefined;
          setNextTarget();
        }, 650);
      }
    },
    [
      persistEvent,
      preferences.enabledGroupIds,
      preferences.fixedCount,
      preferences.mode,
      setNextTarget,
    ]
  );

  const handleNameAnswer = useCallback(
    (noteName: NoteName, inputMode: AnswerAttempt["inputMode"] = "virtual-keyboard"): void => {
      const currentTarget = targetRef.current;
      if (stage !== "running" || isPaused || !currentTarget || targetResolvedRef.current) return;
      const isCorrect = noteName === currentTarget.noteName;
      const atMs = Math.max(
        0,
        performance.now() - promptStartedAtRef.current - pausedPromptMsRef.current
      );
      attemptsRef.current = [...attemptsRef.current, { atMs, inputMode, isCorrect, noteName }];
      if (isCorrect) {
        finishPrompt(true);
      } else {
        setFeedback({
          correctNoteName: currentTarget.noteName,
          selectedNoteName: noteName,
          state: "wrong",
        });
      }
    },
    [finishPrompt, isPaused, stage]
  );

  const startRound = async (): Promise<void> => {
    if (!isActiveRef.current || isStarting) return;
    const requestGeneration = ++startRequestGenerationRef.current;
    setIsStarting(true);
    setStatusMessage("");
    try {
      if (targetPool.length === 0) {
        setStatusMessage("请至少选择一个音域，再开始练习。");
        return;
      }
      const preflight = await onBeforePracticeStart();
      if (
        !preflight.proceed ||
        requestGeneration !== startRequestGenerationRef.current ||
        !isActiveRef.current
      ) {
        return;
      }
      sessionIdRef.current = createUuid();
      eventIndexRef.current = 0;
      eventsRef.current = [];
      attemptsRef.current = [];
      setRoundEvents([]);
      setFeedback(null);
      const initialDuration = preferences.mode === "fixed-duration" ? durationMs : 0;
      setRemainingMs(initialDuration);
      remainingMsRef.current = initialDuration;
      endAtRef.current = initialDuration > 0 ? Date.now() + initialDuration : 0;
      setIsPaused(false);
      setStage("running");
      onStageChange(true);
      setNextTarget();
    } catch (error) {
      if (requestGeneration === startRequestGenerationRef.current && isActiveRef.current) {
        setStatusMessage(error instanceof Error ? error.message : "准备练习时发生错误，请重试。");
      }
    } finally {
      if (mountedRef.current) setIsStarting(false);
    }
  };

  const pauseOrResume = (): void => {
    if (stage !== "running") return;
    if (isPaused) {
      if (pauseStartedAtRef.current > 0) {
        pausedPromptMsRef.current += performance.now() - pauseStartedAtRef.current;
      }
      pauseStartedAtRef.current = 0;
      if (preferences.mode === "fixed-duration") {
        endAtRef.current = Date.now() + remainingMsRef.current;
      }
      setIsPaused(false);
    } else {
      if (preferences.mode === "fixed-duration") {
        remainingMsRef.current = Math.max(0, endAtRef.current - Date.now());
        setRemainingMs(remainingMsRef.current);
      }
      pauseStartedAtRef.current = performance.now();
      setIsPaused(true);
    }
  };

  const restartRound = async (): Promise<void> => {
    if (stage !== "running" || isStarting || isRestarting) return;
    const previousSessionId = sessionIdRef.current;
    const wasPaused = isPaused;
    setIsRestarting(true);
    try {
      if (!wasPaused) pauseOrResume();
      await eventSaveQueueRef.current;
      await deletePracticeSessionWithReviews(previousSessionId, []);
      await onDataChanged();
      if (advanceTimerRef.current !== undefined) window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = undefined;
      targetRef.current = null;
      targetResolvedRef.current = true;
      attemptsRef.current = [];
      eventsRef.current = [];
      setRoundEvents([]);
      setFeedback(null);
      setTarget(null);
      setIsPaused(false);
      setStage("setup");
      onRunningChange(false);
      onStageChange(false);
      await startRound();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "重置练习失败，请重试。");
    } finally {
      setIsRestarting(false);
    }
  };

  useEffect(() => {
    onRunningChange(stage === "running" && !isPaused);
  }, [isPaused, onRunningChange, stage]);

  useEffect(() => {
    if (!isActive || stage !== "running" || isPaused) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const targetElement = event.target;
      if (
        targetElement instanceof HTMLElement &&
        targetElement.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      const key = event.key.toUpperCase();
      if (!NOTE_NAMES.includes(key as NoteName)) return;
      event.preventDefault();
      handleNameAnswer(key as NoteName, "computer-keyboard");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNameAnswer, isActive, isPaused, stage]);

  useEffect(() => {
    if (stage !== "running" || isPaused || preferences.mode !== "fixed-duration") return undefined;
    const timer = window.setInterval(() => {
      const nextRemaining = Math.max(0, endAtRef.current - Date.now());
      remainingMsRef.current = nextRemaining;
      setRemainingMs(nextRemaining);
      if (nextRemaining <= 0) finishRoundRef.current();
    }, 200);
    return () => window.clearInterval(timer);
  }, [isPaused, preferences.mode, stage]);

  useEffect(() => {
    if (
      !navigationExitRequest ||
      handledNavigationExitRequestRef.current === navigationExitRequest.id ||
      stage === "setup"
    ) {
      return;
    }
    handledNavigationExitRequestRef.current = navigationExitRequest.id;
    if (stage === "running") finishRoundRef.current(false);
    else setStage("setup");
    onNavigationExit?.(navigationExitRequest.targetView);
  }, [navigationExitRequest, onNavigationExit, stage]);

  useEffect(
    () => () => {
      if (advanceTimerRef.current !== undefined) window.clearTimeout(advanceTimerRef.current);
      onRunningChange(false);
      onStageChange(false);
    },
    [onRunningChange, onStageChange]
  );

  const toggleGroup = (groupId: CurrentPracticeGroupId): void => {
    setPreferences((current) => ({
      ...current,
      enabledGroupIds: current.enabledGroupIds.includes(groupId)
        ? current.enabledGroupIds.filter((id) => id !== groupId)
        : [...current.enabledGroupIds, groupId],
    }));
  };

  const modeLabel =
    preferences.mode === "open-ended"
      ? "不限"
      : preferences.mode === "fixed-duration"
        ? `${Math.round(preferences.fixedDurationSeconds / 60)}分钟`
        : `${preferences.fixedCount}题`;

  return (
    <section aria-label="看谱认音练习" className="staff-to-name-practice">
      {stage === "setup" ? (
        <div className="staff-to-name-setup-card">
          <header>
            <div>
              <h1>看谱认音</h1>
              <p>看五线谱上的音符，按下对应的音名。</p>
            </div>
          </header>

          <StaffReadingTips />

          <section
            aria-labelledby="staff-to-name-range-title"
            className="staff-to-name-setup-section"
          >
            <div className="staff-to-name-section-heading">
              <div>
                <h2 id="staff-to-name-range-title">音域范围</h2>
                <p>可选择一个或多个音域；默认从小字一组开始。</p>
              </div>
              <span>已选 {availableGroupCount} 组</span>
            </div>
            <div className="staff-to-name-range-options">
              {PRACTICE_GROUPS.map((group) => {
                const checked = preferences.enabledGroupIds.includes(group.id);
                return (
                  <div className={checked ? "is-selected" : ""} key={group.id}>
                    <input
                      checked={checked}
                      id={`staff-to-name-range-${group.id}`}
                      onChange={() => toggleGroup(group.id)}
                      type="checkbox"
                    />
                    <label htmlFor={`staff-to-name-range-${group.id}`}>
                      <strong>{GROUP_LABELS[group.id]}</strong>
                      <small>{group.id.replace("-", "–")}</small>
                    </label>
                  </div>
                );
              })}
            </div>
            <p className="staff-to-name-range-summary">
              {rangeSummary ? `当前音域：${rangeSummary}` : "请至少选择一个音域。"}
            </p>
          </section>

          <section
            aria-labelledby="staff-to-name-length-title"
            className="staff-to-name-setup-section"
          >
            <div className="staff-to-name-section-heading">
              <div>
                <h2 id="staff-to-name-length-title">练习长度</h2>
                <p>选择题数或时长，随时可以结束练习。</p>
              </div>
            </div>
            <div aria-label="选择练习长度" className="staff-to-name-mode-options" role="group">
              {(
                [
                  ["fixed-count", "固定题数"],
                  ["fixed-duration", "固定时长"],
                  ["open-ended", "不限"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  aria-pressed={preferences.mode === mode}
                  className={preferences.mode === mode ? "is-selected" : ""}
                  key={mode}
                  onClick={() => setPreferences((current) => ({ ...current, mode }))}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            {preferences.mode === "fixed-count" ? (
              <div aria-label="练习题数" className="staff-to-name-length-values">
                {PRACTICE_FIXED_COUNT_PRESETS.map((count) => (
                  <button
                    aria-pressed={!customCountSelected && preferences.fixedCount === count}
                    className={
                      !customCountSelected && preferences.fixedCount === count ? "is-selected" : ""
                    }
                    key={count}
                    onClick={() => {
                      setCustomCountSelected(false);
                      setPreferences((current) => ({ ...current, fixedCount: count }));
                    }}
                    type="button"
                  >
                    {count}题
                  </button>
                ))}
                {customCountSelected ? (
                  <label
                    className="staff-to-name-number-input"
                    htmlFor="staff-to-name-custom-count"
                  >
                    <BoundedNumberInput
                      aria-label="自定义题数"
                      id="staff-to-name-custom-count"
                      max={MAX_PRACTICE_QUESTIONS}
                      min={1}
                      value={preferences.fixedCount}
                      onCommit={(fixedCount) => {
                        setCustomCount(fixedCount);
                        setPreferences((current) => ({ ...current, fixedCount }));
                      }}
                    />
                    <span>题</span>
                  </label>
                ) : (
                  <button
                    onClick={() => {
                      setCustomCountSelected(true);
                      setPreferences((current) => ({ ...current, fixedCount: customCount }));
                    }}
                    type="button"
                  >
                    自定义
                  </button>
                )}
              </div>
            ) : null}
            {preferences.mode === "fixed-duration" ? (
              <div aria-label="练习时长" className="staff-to-name-length-values">
                {[60, 120, 180, 300].map((seconds) => (
                  <button
                    aria-pressed={preferences.fixedDurationSeconds === seconds}
                    className={preferences.fixedDurationSeconds === seconds ? "is-selected" : ""}
                    key={seconds}
                    onClick={() =>
                      setPreferences((current) => ({ ...current, fixedDurationSeconds: seconds }))
                    }
                    type="button"
                  >
                    {seconds / 60}分钟
                  </button>
                ))}
                <label className="staff-to-name-number-input" htmlFor="staff-to-name-duration">
                  <BoundedNumberInput
                    aria-label="自定义时长，分钟"
                    id="staff-to-name-duration"
                    max={120}
                    min={1}
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
              </div>
            ) : null}
            {preferences.mode === "open-ended" ? (
              <p className="staff-to-name-range-summary">不限题数和时长，随时结束这一局。</p>
            ) : null}
          </section>

          {statusMessage ? (
            <p className="staff-to-name-status" role="alert">
              {statusMessage}
            </p>
          ) : null}
          <footer className="staff-to-name-setup-footer">
            <div>
              <span>{rangeSummary || "未选择音域"}</span>
              <span>{modeLabel}</span>
              <span>音名按键</span>
            </div>
            <button
              className="primary"
              disabled={!isActive || targetPool.length === 0 || isStarting}
              onClick={() => void startRound()}
              type="button"
            >
              <Play aria-hidden="true" size={18} />
              {isStarting ? "准备中…" : "开始看谱认音"}
            </button>
          </footer>
        </div>
      ) : null}

      {stage === "running" ? (
        <div className={`staff-to-name-run-card${isPaused ? " is-paused" : ""}`}>
          <header className="staff-to-name-run-header">
            <div>
              <span>看谱认音</span>
              <strong>
                {roundEvents.length}
                {preferences.mode === "fixed-count" ? ` / ${preferences.fixedCount}` : " 题"}
              </strong>
            </div>
            {preferences.mode === "fixed-duration" ? (
              <strong aria-live="off" className="staff-to-name-timer">
                {formatRemainingTime(remainingMs)}
              </strong>
            ) : null}
            <div className="staff-to-name-run-actions">
              <button
                aria-label={isPaused ? "继续练习" : "暂停练习"}
                disabled={feedback?.state === "correct"}
                onClick={pauseOrResume}
                type="button"
              >
                {isPaused ? (
                  <Play aria-hidden="true" size={18} />
                ) : (
                  <Pause aria-hidden="true" size={18} />
                )}
                {isPaused ? "继续" : "暂停"}
              </button>
              {showRestartControl ? (
                <button
                  aria-label="重新开始当前练习"
                  disabled={isRestarting}
                  onClick={() => void restartRound()}
                  title="重新开始当前练习"
                  type="button"
                >
                  <RotateCcw aria-hidden="true" size={17} />
                  重新开始
                </button>
              ) : null}
              <button aria-label="结束练习" onClick={() => finishRound()} type="button">
                <Square aria-hidden="true" size={17} />
                结束
              </button>
            </div>
          </header>
          <StaffReadingTips />
          {target ? (
            <>
              <p className="staff-to-name-prompt-label">这个音是什么音名？</p>
              <StaffPrompt
                accessibleLabel="五线谱音符，请选择对应的音名"
                effectiveTargetNoteIds={new Set([target.id])}
                highlight={feedback?.state === "correct"}
                note={target}
                noteDuration="quarter"
                staffNotationMode={target.staff === "treble" ? "treble-only" : "bass-only"}
                useLedgerGap={false}
                wrong={
                  feedback?.state === "wrong" &&
                  feedback.selectedNoteName !== feedback.correctNoteName
                }
              />
              <div aria-label="音名答案" className="staff-to-name-answer-grid">
                {NOTE_NAMES.map((noteName) => {
                  const selectedWrong =
                    feedback?.state === "wrong" && feedback.selectedNoteName === noteName;
                  const correctChoice = feedback?.correctNoteName === noteName;
                  return (
                    <button
                      aria-keyshortcuts={noteName.toLowerCase()}
                      className={`${selectedWrong ? "is-wrong" : ""}${correctChoice ? " is-correct-answer" : ""}`}
                      disabled={isPaused || feedback?.state === "correct"}
                      key={noteName}
                      onClick={() => handleNameAnswer(noteName)}
                      type="button"
                    >
                      {noteName}
                    </button>
                  );
                })}
              </div>
              <p className="staff-to-name-keyboard-hint">
                电脑端也可以按 C、D、E、F、G、A、B 快速作答
              </p>
              <div aria-live="polite" className="staff-to-name-feedback">
                {isPaused ? (
                  <span>练习已暂停</span>
                ) : feedback?.state === "correct" ? (
                  <span className="is-correct">正确</span>
                ) : feedback?.state === "wrong" ? (
                  <>
                    <span className="is-wrong">选错了，正确答案是 {feedback.correctNoteName}</span>
                    <button
                      disabled={isPaused}
                      onClick={() => finishPrompt(false, true)}
                      type="button"
                    >
                      下一题
                    </button>
                  </>
                ) : (
                  <span>选择一个音名</span>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {stage === "summary" ? (
        <div className="staff-to-name-summary-card">
          <span className="staff-to-name-summary-kicker">练习完成</span>
          <h1>看谱认音结果</h1>
          <p>
            {rangeSummary || "小字一组"} · {modeLabel}
          </p>
          <dl>
            <div>
              <dt>答题数</dt>
              <dd>{roundEvents.length}</dd>
            </div>
            <div>
              <dt>最终答对率</dt>
              <dd>{accuracy === null ? "—" : `${accuracy}%`}</dd>
            </div>
            <div>
              <dt>平均反应时间</dt>
              <dd>{formatDuration(averageResponseMs)}</dd>
            </div>
          </dl>
          {roundEvents.some((event) => event.wrongAttempts > 0 || event.isMissed) ? (
            <section className="staff-to-name-summary-misses">
              <h2>再熟悉一下这些音</h2>
              <ul>
                {roundEvents
                  .filter((event) => event.wrongAttempts > 0 || event.isMissed)
                  .slice(0, 8)
                  .map((event) => (
                    <li key={event.id}>
                      {event.targetDisplayName} ·
                      {event.isMissed ? " 未作答" : event.isCorrectFinal ? " 首次答错" : " 答错"}
                    </li>
                  ))}
              </ul>
            </section>
          ) : (
            <p className="staff-to-name-summary-perfect">这一局全答对了，继续保持。</p>
          )}
          <div className="staff-to-name-summary-actions">
            <button onClick={() => setStage("setup")} type="button">
              返回配置
            </button>
            <button className="primary" onClick={() => void startRound()} type="button">
              <RotateCcw aria-hidden="true" size={17} />
              再来一次
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
