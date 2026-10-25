import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Mic, Music2, Pause, Play, RotateCcw, Square } from "lucide-react";
import { toast } from "sonner";
import { getPianoAudioTime, playPianoNote } from "../../../audio/piano";
import { answerDeviceInfo, currentMicrophoneContext } from "../../../data/answerEvents";
import { saveAnswerEvents } from "../../../data/db";
import { createUuid } from "../../../domain/id";
import type {
  AnswerAttempt,
  AnswerEvent,
  AnswerInputMode,
  NoteName,
  Octave,
  PianoKeyName,
  PracticeMode,
} from "../../../domain/types";
import type { PracticeAnswerInput } from "../../../domain/answerInput";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { MidiInputControl } from "../../../midi/MidiInputControl";
import { BoundedNumberInput } from "../../../shared/components/BoundedNumberInput";
import {
  VirtualPianoKeyboard,
  VIRTUAL_PIANO_WHITE_KEYS,
} from "../../../shared/components/VirtualPianoKeyboard";
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";
import {
  isInteractiveShortcutTarget,
  shouldHandleGlobalEnter,
} from "../../../shared/keyboard/keyboardShortcuts";
import type { PracticeMicrophoneStatus } from "../../vocal-pitch/logic/usePracticeMicrophoneInput";
import { NameToKeyKeyboard } from "./NameToKeyKeyboard";
import {
  chooseNameToKeyTarget,
  createNameToKeyTargetPool,
  formatMidiName,
  getNameToKeyTarget,
  midiToKeyName,
  midiToOctave,
  type NameToKeyConfig,
  type NameToKeyTarget,
} from "./nameToKeyPractice";
import { PRACTICE_FIXED_COUNT_PRESETS } from "../logic/practiceLengthOptions";

const NAME_TO_KEY_PREFERENCES_KEY = "anki-note.nameToKeyPreferences.v1";
const WRONG_FEEDBACK_MS = 720;
const NAME_KEY_REFERENCE_WHITE_KEYS = new Set<PianoKeyName>(VIRTUAL_PIANO_WHITE_KEYS);

type NameToKeyInputMode = "virtual-keyboard" | "midi" | "microphone";
type NameToKeyStage = "setup" | "running" | "summary";

interface NameToKeyPreferences extends NameToKeyConfig {
  fixedCount: number;
  fixedDurationSeconds: number;
  inputMode: NameToKeyInputMode;
  mode: PracticeMode;
}

interface NameToKeyMicrophone {
  error: string | null;
  inputLevel: number;
  isListening: boolean;
  start: (options?: { includeAccidentals?: boolean }) => Promise<boolean>;
  status: PracticeMicrophoneStatus;
  stop: () => void;
  suppressRecognizedNotes: (
    midiNotes: readonly number[],
    startAtMs: number,
    endAtMs: number
  ) => void;
}

interface NameToKeyPracticeViewProps {
  isActive: boolean;
  midi: MidiInputController;
  microphone: NameToKeyMicrophone;
  onBeforePracticeStart: () => Promise<{ proceed: boolean }>;
  onDataChanged: () => Promise<void>;
  onPracticeFinished: () => void;
  onRegisterMicrophoneAnswer: (handler: ((answer: PracticeAnswerInput) => void) | null) => void;
  onRunningChange: (running: boolean) => void;
  onStageChange: (active: boolean) => void;
}

const DEFAULT_PREFERENCES: NameToKeyPreferences = {
  includeOctaveNumbers: false,
  includeBlackKeys: false,
  randomEnharmonics: false,
  fixedCount: 30,
  fixedDurationSeconds: 60,
  inputMode: "virtual-keyboard",
  mode: "fixed-count",
};

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function parsePreferences(value: unknown): NameToKeyPreferences {
  if (!value || typeof value !== "object") return DEFAULT_PREFERENCES;
  const candidate = value as Partial<NameToKeyPreferences>;
  return {
    includeOctaveNumbers: candidate.includeOctaveNumbers === true,
    includeBlackKeys: candidate.includeBlackKeys === true,
    randomEnharmonics: candidate.randomEnharmonics === true,
    fixedCount: numberInRange(candidate.fixedCount, DEFAULT_PREFERENCES.fixedCount, 1, 500),
    fixedDurationSeconds: numberInRange(
      candidate.fixedDurationSeconds,
      DEFAULT_PREFERENCES.fixedDurationSeconds,
      60,
      7200
    ),
    inputMode:
      candidate.inputMode === "midi" || candidate.inputMode === "microphone"
        ? candidate.inputMode
        : "virtual-keyboard",
    mode:
      candidate.mode === "open-ended" || candidate.mode === "fixed-duration"
        ? candidate.mode
        : "fixed-count",
  };
}

function formatRemainingTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function eventTargetNoteName(midi: number): NoteName | undefined {
  const name = midiToKeyName(midi);
  return name && !name.includes("#") ? (name as NoteName) : undefined;
}

function eventInputMode(mode: NameToKeyInputMode): AnswerInputMode {
  return mode === "virtual-keyboard" ? "virtual-keyboard" : mode;
}

function summarizeMostMissed(
  events: readonly AnswerEvent[]
): Array<{ count: number; name: string }> {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.wrongAttempts <= 0 && !event.isMissed) continue;
    const name = event.targetDisplayName ?? formatMidiName(event.targetMidi ?? -1);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ count, name }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 3);
}

interface NameKeyReferenceDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function NameKeyReferenceDialog({ isOpen, onClose }: NameKeyReferenceDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && dialog && !dialog.open) {
      dialog.showModal();
      titleRef.current?.focus({ preventScroll: true });
    } else if (!isOpen && dialog?.open) {
      dialog.close();
    }

    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [isOpen]);

  return (
    <dialog
      aria-labelledby="name-key-reference-title"
      className="name-key-reference-dialog"
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="name-key-reference-content">
        <header className="name-key-reference-header">
          <div>
            <h2 id="name-key-reference-title" ref={titleRef} tabIndex={-1}>
              白键音名位置
            </h2>
            <p>从左到右记住这七个音名：C、D、E、F、G、A、B。</p>
          </div>
          <button
            aria-label="关闭音名键位"
            className="name-key-reference-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <VirtualPianoKeyboard
          ariaLabel="七个白键对应的音名"
          className="name-key-reference-keyboard"
          disabled
          enabledKeys={NAME_KEY_REFERENCE_WHITE_KEYS}
          getKeyAriaLabel={(keyName) => `${keyName} 白键`}
          getKeyLabel={(keyName) => keyName}
          onKeyPress={() => undefined}
          showBlackKeys={false}
        />
      </div>
    </dialog>
  );
}

export function NameToKeyPracticeView({
  isActive,
  midi,
  microphone,
  onBeforePracticeStart,
  onDataChanged,
  onPracticeFinished,
  onRegisterMicrophoneAnswer,
  onRunningChange,
  onStageChange,
}: NameToKeyPracticeViewProps): JSX.Element {
  const {
    error: microphoneError,
    inputLevel: microphoneInputLevel,
    status: microphoneStatus,
    start: startMicrophone,
    stop: stopMicrophone,
    suppressRecognizedNotes,
  } = microphone;
  const [preferences, setPreferences] = useLocalStorageState(
    NAME_TO_KEY_PREFERENCES_KEY,
    DEFAULT_PREFERENCES,
    { parse: parsePreferences }
  );
  const [stage, setStage] = useState<NameToKeyStage>("setup");
  const [isPaused, setIsPaused] = useState(false);
  const [isNoteKeyGuideOpen, setIsNoteKeyGuideOpen] = useState(false);
  const isPausedRef = useRef(false);
  isPausedRef.current = isPaused;
  const roundDurationMs =
    preferences.mode === "fixed-duration" ? preferences.fixedDurationSeconds * 1000 : 0;
  const [remainingMs, setRemainingMs] = useState(roundDurationMs);
  const [target, setTarget] = useState<NameToKeyTarget | null>(null);
  const [selectedOctave, setSelectedOctave] = useState(4);
  const [feedback, setFeedback] = useState<{ correctMidi: number; wrongMidi?: number } | null>(
    null
  );
  const [roundEvents, setRoundEvents] = useState<AnswerEvent[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const targetMidiRef = useRef<number | null>(null);
  const targetRef = useRef<NameToKeyTarget | null>(null);
  const promptStartedAtRef = useRef(0);
  const promptStartedAtIsoRef = useRef("");
  const targetResolvedRef = useRef(false);
  const lastTargetMidiRef = useRef<number | undefined>();
  const sessionIdRef = useRef("");
  const eventIndexRef = useRef(0);
  const roundEventsRef = useRef<AnswerEvent[]>([]);
  const remainingMsRef = useRef(roundDurationMs);
  const activeStartedAtRef = useRef(0);
  const activeElapsedRef = useRef(0);
  const intervalRef = useRef<number | undefined>();
  const advanceTimerRef = useRef<number | undefined>();
  const microphoneStartedRef = useRef(false);
  const startRoundRef = useRef<() => Promise<void>>(async () => undefined);
  const customCountInputRef = useRef<HTMLInputElement>(null);
  const [isCustomCountSelected, setIsCustomCountSelected] = useState(
    !PRACTICE_FIXED_COUNT_PRESETS.includes(
      preferences.fixedCount as (typeof PRACTICE_FIXED_COUNT_PRESETS)[number]
    )
  );
  const [customFixedCount, setCustomFixedCount] = useState(preferences.fixedCount);
  const finishRoundRef = useRef<() => void>(() => undefined);
  const handlePracticeAnswerRef = useRef<(answer: PracticeAnswerInput) => void>(() => undefined);

  const targetPool = useMemo(() => createNameToKeyTargetPool(preferences), [preferences]);

  useEffect(() => {
    if (stage !== "running") setIsNoteKeyGuideOpen(false);
  }, [stage]);

  const commitEvent = useCallback((event: AnswerEvent): void => {
    const nextEvents = [...roundEventsRef.current, event];
    roundEventsRef.current = nextEvents;
    setRoundEvents(nextEvents);
    eventIndexRef.current += 1;
    void saveAnswerEvents([event]).catch(() => {
      toast.error("这道题的练习记录暂时保存失败。", { duration: 3500 });
    });
  }, []);

  const setNextTarget = useCallback((): void => {
    const nextMidi = chooseNameToKeyTarget(targetPool, lastTargetMidiRef.current);
    if (nextMidi === null) return;
    const nextTarget = getNameToKeyTarget(
      nextMidi,
      preferences.randomEnharmonics,
      preferences.includeOctaveNumbers
    );
    lastTargetMidiRef.current = nextMidi;
    targetMidiRef.current = nextMidi;
    targetRef.current = nextTarget;
    promptStartedAtRef.current = performance.now();
    promptStartedAtIsoRef.current = new Date().toISOString();
    targetResolvedRef.current = false;
    setTarget(nextTarget);
    setFeedback(null);
  }, [preferences.includeOctaveNumbers, preferences.randomEnharmonics, targetPool]);

  const makeAnswerEvent = useCallback(
    (args: {
      answer?: PracticeAnswerInput;
      isCorrect: boolean | null;
      isMissed?: boolean;
      responseMs: number | null;
      targetMidiValue: number;
    }): AnswerEvent => {
      const note =
        targetRef.current ??
        getNameToKeyTarget(
          args.targetMidiValue,
          preferences.randomEnharmonics,
          preferences.includeOctaveNumbers
        );
      const inputMode = eventInputMode(preferences.inputMode);
      const answer = args.answer;
      const answerNoteName =
        answer?.midiNoteNumber === undefined
          ? answer?.noteName
          : eventTargetNoteName(answer.midiNoteNumber);
      const attempt: AnswerAttempt | undefined = answer
        ? {
            atMs: args.responseMs ?? 0,
            confidence: answer.confidence,
            inputMode,
            isCorrect: args.isCorrect === true,
            microphoneAlgorithm: answer.microphoneAlgorithm,
            midi: answer.midiNoteNumber,
            ...(answerNoteName ? { noteName: answerNoteName } : {}),
            ...(answer.clipping === undefined ? {} : { clipping: answer.clipping }),
          }
        : undefined;
      const occurredAt = new Date().toISOString();
      const event: AnswerEvent = {
        id: `${sessionIdRef.current}:name-to-key:${eventIndexRef.current}`,
        dataSetId: "",
        sessionId: sessionIdRef.current,
        eventIndex: eventIndexRef.current,
        occurredAt,
        promptStartedAt: promptStartedAtIsoRef.current,
        promptEndedAt: occurredAt,
        mode: "name-to-key",
        inputMode,
        deviceInfo: answerDeviceInfo(),
        ...(inputMode === "microphone"
          ? { ...currentMicrophoneContext(), microphoneAlgorithm: answer?.microphoneAlgorithm }
          : {}),
        targetMidi: args.targetMidiValue,
        targetNoteName: eventTargetNoteName(args.targetMidiValue),
        targetOctave: note.octave,
        targetDisplayName: note.displayName,
        nameToKeyConfig: {
          includeOctaveNumbers: preferences.includeOctaveNumbers,
          includeBlackKeys: preferences.includeBlackKeys,
          randomEnharmonics: preferences.randomEnharmonics,
          inputMode,
          range: preferences.includeOctaveNumbers ? "F1-B6" : "C4-B4",
        },
        ...(answer?.midiNoteNumber === undefined ? {} : { recognizedMidi: answer.midiNoteNumber }),
        confidence: answer?.confidence,
        attempts: attempt ? [attempt] : [],
        isCorrectFirstTry: args.isCorrect,
        isCorrectFinal: args.isCorrect,
        rawResponseTimeMs: args.responseMs,
        responseTimeMs: args.responseMs,
        activeMs: args.responseMs ?? 0,
        wrongAttempts: args.isCorrect === false ? 1 : 0,
        isExtraNote: false,
        isMissed: args.isMissed === true,
      };
      return event;
    },
    [preferences]
  );

  const finishRound = useCallback((): void => {
    if (stage !== "running") return;
    if (intervalRef.current !== undefined) window.clearInterval(intervalRef.current);
    if (advanceTimerRef.current !== undefined) window.clearTimeout(advanceTimerRef.current);
    intervalRef.current = undefined;
    advanceTimerRef.current = undefined;
    activeStartedAtRef.current = 0;
    const unansweredTarget = targetMidiRef.current;
    const pendingEvents: AnswerEvent[] = [];
    if (unansweredTarget !== null && !targetResolvedRef.current) {
      pendingEvents.push(
        makeAnswerEvent({
          isCorrect: null,
          isMissed: true,
          responseMs: null,
          targetMidiValue: unansweredTarget,
        })
      );
    }
    targetResolvedRef.current = true;
    targetMidiRef.current = null;
    targetRef.current = null;
    if (pendingEvents.length > 0) {
      roundEventsRef.current = [...roundEventsRef.current, ...pendingEvents];
      setRoundEvents(roundEventsRef.current);
      void saveAnswerEvents(pendingEvents).catch(() => {
        toast.error("部分练习记录暂时保存失败。", { duration: 3500 });
      });
    }
    setTarget(null);
    setFeedback(null);
    setRemainingMs(0);
    remainingMsRef.current = 0;
    setIsPaused(false);
    setStage("summary");
    onRegisterMicrophoneAnswer(null);
    if (microphoneStartedRef.current) {
      microphoneStartedRef.current = false;
      stopMicrophone();
    }
    onStageChange(false);
    onPracticeFinished();
    void onDataChanged();
  }, [
    makeAnswerEvent,
    onDataChanged,
    onPracticeFinished,
    onRegisterMicrophoneAnswer,
    onStageChange,
    stage,
    stopMicrophone,
  ]);
  finishRoundRef.current = finishRound;

  const handlePracticeAnswer = useCallback(
    (answer: PracticeAnswerInput, explicitMode?: NameToKeyInputMode): void => {
      const currentTarget = targetMidiRef.current;
      if (stage !== "running" || isPaused || targetResolvedRef.current || currentTarget === null) {
        return;
      }
      const answeredMidi = answer.midiNoteNumber;
      if (!Number.isInteger(answeredMidi) || answeredMidi === undefined) return;

      const isCorrect = answeredMidi === currentTarget;
      const responseMs = Math.max(0, performance.now() - promptStartedAtRef.current);
      const answerMode = explicitMode ?? preferences.inputMode;
      const normalizedAnswer: PracticeAnswerInput = {
        ...answer,
        source: answerMode === "virtual-keyboard" ? "screen-keyboard" : answerMode,
      };
      const target =
        targetRef.current ??
        getNameToKeyTarget(
          currentTarget,
          preferences.randomEnharmonics,
          preferences.includeOctaveNumbers
        );
      targetResolvedRef.current = true;
      commitEvent(
        makeAnswerEvent({
          answer: normalizedAnswer,
          isCorrect,
          responseMs,
          targetMidiValue: currentTarget,
        })
      );
      targetMidiRef.current = null;

      const isLastCountedPrompt =
        preferences.mode === "fixed-count" &&
        roundEventsRef.current.length >= preferences.fixedCount;

      if (isCorrect) {
        setFeedback(null);
        if (answerMode === "virtual-keyboard") {
          void playPianoNote(target.keyName, target.octave).catch(() => undefined);
        }
        if (isLastCountedPrompt) {
          finishRoundRef.current();
          return;
        }
        setNextTarget();
        return;
      }

      const wrongOctave = midiToOctave(answeredMidi);
      if (wrongOctave !== null && wrongOctave >= 1 && wrongOctave <= 6) {
        setSelectedOctave(wrongOctave);
      }
      setTarget(target);
      setFeedback({ correctMidi: currentTarget, wrongMidi: answeredMidi });
      const audioTimeMs = getPianoAudioTime() * 1000;
      suppressRecognizedNotes([currentTarget], audioTimeMs, audioTimeMs + 1000);
      void playPianoNote(target.keyName, target.octave).catch(() => undefined);
      advanceTimerRef.current = window.setTimeout(() => {
        advanceTimerRef.current = undefined;
        if (stage !== "running" || isPausedRef.current) return;
        if (preferences.mode === "fixed-duration" && remainingMsRef.current <= 0) return;
        if (isLastCountedPrompt) {
          finishRoundRef.current();
          return;
        }
        setNextTarget();
      }, WRONG_FEEDBACK_MS);
    },
    [
      commitEvent,
      isPaused,
      makeAnswerEvent,
      preferences.inputMode,
      preferences.fixedCount,
      preferences.mode,
      preferences.includeOctaveNumbers,
      preferences.randomEnharmonics,
      suppressRecognizedNotes,
      setNextTarget,
      stage,
    ]
  );
  handlePracticeAnswerRef.current = (answer) => handlePracticeAnswer(answer);

  useEffect(() => {
    if (stage !== "running" || isPaused || preferences.inputMode !== "midi") return undefined;
    return midi.subscribe((event) => {
      if (event.type !== "press") return;
      const { midiNoteNumber, keyName, octave } = event.note;
      handlePracticeAnswer(
        { midiNoteNumber, noteName: keyName.replace(/#$/, "") as NoteName, octave, source: "midi" },
        "midi"
      );
    });
  }, [handlePracticeAnswer, isPaused, midi, preferences.inputMode, stage]);

  useEffect(() => {
    if (stage !== "running" || isPaused || preferences.inputMode !== "microphone") {
      onRegisterMicrophoneAnswer(null);
      return undefined;
    }
    onRegisterMicrophoneAnswer((answer) => handlePracticeAnswerRef.current(answer));
    return () => onRegisterMicrophoneAnswer(null);
  }, [isPaused, onRegisterMicrophoneAnswer, preferences.inputMode, stage]);

  useEffect(() => {
    onRunningChange(stage === "running" && !isPaused);
    return () => onRunningChange(false);
  }, [isPaused, onRunningChange, stage]);

  useEffect(() => {
    if (stage !== "running" || isPaused || preferences.mode !== "fixed-duration") return undefined;
    intervalRef.current = window.setInterval(() => {
      const elapsed = activeElapsedRef.current + performance.now() - activeStartedAtRef.current;
      const nextRemaining = Math.max(0, roundDurationMs - elapsed);
      remainingMsRef.current = nextRemaining;
      setRemainingMs(nextRemaining);
      if (nextRemaining <= 0) finishRoundRef.current();
    }, 100);
    return () => {
      if (intervalRef.current !== undefined) window.clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    };
  }, [isPaused, preferences.mode, roundDurationMs, stage]);

  useEffect(
    () => () => {
      if (intervalRef.current !== undefined) window.clearInterval(intervalRef.current);
      if (advanceTimerRef.current !== undefined) window.clearTimeout(advanceTimerRef.current);
      onRegisterMicrophoneAnswer(null);
      if (microphoneStartedRef.current) stopMicrophone();
      onRunningChange(false);
      onStageChange(false);
    },
    [onRegisterMicrophoneAnswer, onRunningChange, onStageChange, stopMicrophone]
  );

  const startRound = async (): Promise<void> => {
    if (!isActive || isStarting) return;
    setIsStarting(true);
    setStatusMessage("");
    try {
      const preflight = await onBeforePracticeStart();
      if (!preflight.proceed) return;
      if (preferences.inputMode === "midi" && !midi.isConnected) {
        setStatusMessage("先连接 MIDI 键盘，再开始这一局。下方可以选择设备。 ");
        return;
      }
      if (preferences.inputMode === "microphone") {
        const microphoneReady = await startMicrophone({ includeAccidentals: true });
        if (!microphoneReady) {
          setStatusMessage(microphoneError ?? "麦克风没有启动成功，请检查权限后重试。");
          return;
        }
        microphoneStartedRef.current = true;
      } else {
        stopMicrophone();
      }

      if (targetPool.length === 0) {
        setStatusMessage("当前设置下没有可练习的音，请调整音名选项。");
        return;
      }
      sessionIdRef.current = createUuid();
      eventIndexRef.current = 0;
      roundEventsRef.current = [];
      lastTargetMidiRef.current = undefined;
      setRoundEvents([]);
      setFeedback(null);
      setRemainingMs(roundDurationMs);
      remainingMsRef.current = roundDurationMs;
      activeElapsedRef.current = 0;
      activeStartedAtRef.current = performance.now();
      targetMidiRef.current = null;
      targetRef.current = null;
      setStage("running");
      setIsPaused(false);
      onStageChange(true);
      setNextTarget();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "准备练习时发生错误，请重试。");
      if (microphoneStartedRef.current) {
        microphoneStartedRef.current = false;
        stopMicrophone();
      }
    } finally {
      setIsStarting(false);
    }
  };
  startRoundRef.current = startRound;

  useEffect(() => {
    if (!isActive || stage !== "setup") return undefined;
    function handleEnter(event: KeyboardEvent): void {
      if (
        !shouldHandleGlobalEnter(event, isInteractiveShortcutTarget(event.target)) ||
        isStarting
      ) {
        return;
      }
      event.preventDefault();
      void startRoundRef.current();
    }
    window.addEventListener("keydown", handleEnter);
    return () => window.removeEventListener("keydown", handleEnter);
  }, [isActive, isStarting, stage]);

  const togglePause = async (): Promise<void> => {
    if (stage !== "running") return;
    if (!isPaused) {
      activeElapsedRef.current += Math.max(0, performance.now() - activeStartedAtRef.current);
      activeStartedAtRef.current = 0;
      setIsPaused(true);
      if (microphoneStartedRef.current) {
        microphoneStartedRef.current = false;
        stopMicrophone();
      }
      return;
    }
    if (preferences.inputMode === "microphone") {
      const microphoneReady = await startMicrophone({ includeAccidentals: true });
      if (!microphoneReady) {
        setStatusMessage(microphoneError ?? "麦克风恢复失败，请检查设备后重试。");
        return;
      }
      microphoneStartedRef.current = true;
    }
    if (advanceTimerRef.current !== undefined) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = undefined;
    }
    if (targetMidiRef.current === null && feedback !== null) {
      if (preferences.mode === "fixed-duration" && remainingMsRef.current <= 0) {
        finishRoundRef.current();
        return;
      }
      if (
        preferences.mode === "fixed-count" &&
        roundEventsRef.current.length >= preferences.fixedCount
      ) {
        finishRoundRef.current();
        return;
      }
      setNextTarget();
    }
    activeStartedAtRef.current = performance.now();
    setIsPaused(false);
    setStatusMessage("");
  };

  const endRound = (): void => finishRoundRef.current();
  const lengthSummary =
    preferences.mode === "open-ended"
      ? "不限"
      : preferences.mode === "fixed-count"
        ? `${preferences.fixedCount}题`
        : `${Math.round(preferences.fixedDurationSeconds / 60)}分钟`;
  const rangeSummary = preferences.includeOctaveNumbers ? "F1–B6" : "C4–B4";
  const keyTypeSummary = preferences.includeBlackKeys ? "含黑键" : "白键";
  const inputModeSummary =
    preferences.inputMode === "virtual-keyboard"
      ? "虚拟键盘"
      : preferences.inputMode === "midi"
        ? "MIDI"
        : "麦克风";
  const visibleOctaves = (() => {
    const octaves = [preferences.includeOctaveNumbers ? selectedOctave : 4];
    if (feedback) {
      const correctOctave = midiToOctave(feedback.correctMidi);
      const wrongOctave =
        feedback.wrongMidi === undefined ? null : midiToOctave(feedback.wrongMidi);
      if (
        correctOctave !== null &&
        correctOctave >= 1 &&
        correctOctave <= 6 &&
        !octaves.includes(correctOctave)
      ) {
        octaves.push(correctOctave);
      }
      if (
        wrongOctave !== null &&
        wrongOctave >= 1 &&
        wrongOctave <= 6 &&
        !octaves.includes(wrongOctave)
      ) {
        octaves.push(wrongOctave);
      }
    }
    return octaves.sort((left, right) => left - right);
  })();
  const mostMissed = summarizeMostMissed(roundEvents);

  return (
    <section className="name-key-practice" aria-label="音名找键专项训练">
      {stage === "setup" ? (
        <>
          <div className="name-key-setup-card">
            <header className="name-key-header">
              <div>
                <h1>音名找键</h1>
                <p>看到音名，直接找到琴键，练到一眼就知道该按哪里。</p>
              </div>
              {preferences.inputMode === "midi" ? (
                <div className="practice-midi-heading-status">
                  <MidiInputControl ariaLabel="音名找键 MIDI 输入设备" midi={midi} />
                </div>
              ) : null}
            </header>

            <div className="name-key-settings-grid">
              <section className="name-key-setting-block name-key-answer-block">
                <h2>作答方式</h2>
                <div className="name-key-setting-content">
                  <fieldset className="name-key-input-options">
                    <legend className="visually-hidden">选择作答方式</legend>
                    <button
                      aria-pressed={preferences.inputMode === "virtual-keyboard"}
                      className={preferences.inputMode === "virtual-keyboard" ? "is-selected" : ""}
                      onClick={() =>
                        setPreferences((current) => ({ ...current, inputMode: "virtual-keyboard" }))
                      }
                      type="button"
                    >
                      <Play aria-hidden="true" size={17} />
                      虚拟键盘
                    </button>
                    <button
                      aria-pressed={preferences.inputMode === "midi"}
                      className={preferences.inputMode === "midi" ? "is-selected" : ""}
                      onClick={() =>
                        setPreferences((current) => ({ ...current, inputMode: "midi" }))
                      }
                      type="button"
                    >
                      <Music2 aria-hidden="true" size={17} />
                      MIDI 键盘
                    </button>
                    <button
                      aria-pressed={preferences.inputMode === "microphone"}
                      className={preferences.inputMode === "microphone" ? "is-selected" : ""}
                      onClick={() =>
                        setPreferences((current) => ({ ...current, inputMode: "microphone" }))
                      }
                      type="button"
                    >
                      <Mic aria-hidden="true" size={17} />
                      麦克风
                    </button>
                  </fieldset>
                  <p className="name-key-setting-hint">
                    {preferences.inputMode === "microphone"
                      ? "麦克风识别 F1–B6 音域；开始时会请求麦克风权限。"
                      : preferences.inputMode === "midi"
                        ? "连接 MIDI 键盘后，按下琴键作答。"
                        : "点击页面下方的虚拟键盘作答。"}
                  </p>
                </div>
              </section>

              <section className="name-key-setting-block name-key-length-block">
                <h2>练习长度</h2>
                <div className="name-key-setting-content name-key-length-content">
                  <div
                    aria-label="练习长度"
                    className="segmented name-key-length-modes"
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
                    <div aria-label="练习题数" className="name-key-length-values" role="group">
                      {PRACTICE_FIXED_COUNT_PRESETS.map((count) => (
                        <button
                          aria-pressed={!isCustomCountSelected && preferences.fixedCount === count}
                          className={
                            !isCustomCountSelected && preferences.fixedCount === count
                              ? "active"
                              : ""
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
                          className="name-key-custom-count is-active"
                          htmlFor="name-key-custom-count"
                        >
                          <BoundedNumberInput
                            aria-label="自定义题数"
                            id="name-key-custom-count"
                            inputRef={customCountInputRef}
                            max={500}
                            min={1}
                            value={preferences.fixedCount}
                            onCommit={(fixedCount) => {
                              setCustomFixedCount(fixedCount);
                              setPreferences((current) => ({ ...current, fixedCount }));
                            }}
                          />
                          <span>题</span>
                        </label>
                      ) : (
                        <button
                          onClick={() => {
                            setIsCustomCountSelected(true);
                            setPreferences((current) => ({
                              ...current,
                              fixedCount: customFixedCount,
                            }));
                            window.requestAnimationFrame(() =>
                              customCountInputRef.current?.focus()
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
                    <div className="name-key-length-values" aria-label="练习时长">
                      {[60, 120, 180, 300].map((seconds) => (
                        <button
                          aria-pressed={preferences.fixedDurationSeconds === seconds}
                          className={preferences.fixedDurationSeconds === seconds ? "active" : ""}
                          key={seconds}
                          onClick={() =>
                            setPreferences((current) => ({
                              ...current,
                              fixedDurationSeconds: seconds,
                            }))
                          }
                          type="button"
                        >
                          {seconds / 60}分钟
                        </button>
                      ))}
                      <label
                        className="name-key-duration-input"
                        htmlFor="name-key-duration-minutes"
                      >
                        <BoundedNumberInput
                          aria-label="自定义时长，分钟"
                          id="name-key-duration-minutes"
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
                    <p className="name-key-setting-hint">不限题数和时长，随时结束这一局。</p>
                  ) : null}
                </div>
              </section>
              <section className="name-key-setting-block name-key-range-block">
                <h2>音名范围</h2>
                <div className="name-key-setting-content name-key-range-content">
                  <label aria-label="包含八度数字" className="name-key-option">
                    <input
                      checked={preferences.includeOctaveNumbers}
                      onChange={(event) =>
                        setPreferences((current) => ({
                          ...current,
                          includeOctaveNumbers: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>包含八度数字</strong>
                      <small>开启后在 F1–B6 全音域出题，键盘按八度切换。</small>
                    </span>
                  </label>
                  <label aria-label="包含黑键" className="name-key-option">
                    <input
                      checked={preferences.includeBlackKeys}
                      onChange={(event) =>
                        setPreferences((current) => ({
                          ...current,
                          includeBlackKeys: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>包含黑键</strong>
                      <small>开启后加入升号音名。</small>
                    </span>
                  </label>
                  <label aria-label="随机展示等音" className="name-key-option">
                    <input
                      checked={preferences.randomEnharmonics}
                      disabled={!preferences.includeBlackKeys}
                      onChange={(event) =>
                        setPreferences((current) => ({
                          ...current,
                          randomEnharmonics: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>随机展示等音（如 C# 和 Db 混合出题）</strong>
                      <small>关闭时，黑键统一用升号显示。</small>
                    </span>
                  </label>
                  <p className="name-key-setting-hint">
                    当前音域：{preferences.includeOctaveNumbers ? "F1–B6" : "C4–B4"} ·{" "}
                    {preferences.includeBlackKeys ? "包含黑键" : "仅白键"}
                  </p>
                </div>
              </section>
            </div>

            {statusMessage ? (
              <p className="name-key-status-message" role="alert">
                {statusMessage}
              </p>
            ) : null}
          </div>
          <footer
            aria-label="开始音名找键练习"
            className="practice-free-action-dock name-key-action-dock"
          >
            <div aria-label="当前配置摘要" className="practice-free-config-summary">
              <span className="practice-free-summary-label">当前配置</span>
              <span className="practice-free-summary-chip">
                {rangeSummary} · {keyTypeSummary}
              </span>
              <span className="practice-free-summary-chip">{lengthSummary}</span>
              <span className="practice-free-summary-chip">{inputModeSummary}</span>
              {preferences.includeBlackKeys && preferences.randomEnharmonics ? (
                <span className="practice-free-summary-chip">等音随机</span>
              ) : null}
            </div>
            <div className="practice-free-action-buttons name-key-action-buttons">
              <span className="practice-start-action">
                <button
                  aria-keyshortcuts="Enter"
                  className="primary practice-free-start-button name-key-start-button"
                  disabled={!isActive || isStarting}
                  onClick={() => void startRound()}
                  type="button"
                >
                  {isStarting ? (
                    "正在准备"
                  ) : (
                    <>
                      <Music2 aria-hidden="true" size={19} />
                      开始练习
                      <kbd>Enter</kbd>
                    </>
                  )}
                </button>
              </span>
            </div>
          </footer>
        </>
      ) : null}

      {stage === "running" ? (
        <div className="name-key-run-card">
          <header className="name-key-run-header">
            <div>
              <h1>音名找键</h1>
              {preferences.inputMode === "microphone" ? (
                <div className="practice-microphone-status name-key-run-microphone">
                  <span
                    aria-hidden="true"
                    className={`practice-microphone-indicator ${microphoneError ? "error" : microphoneStatus}`}
                  />
                  {microphoneStatus === "listening" ? (
                    <>
                      <span role="status">正在监听麦克风</span>
                      <div
                        aria-label="麦克风输入音量"
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={Math.round(microphoneInputLevel * 100)}
                        aria-valuetext={`${Math.round(microphoneInputLevel * 100)}%`}
                        className="practice-microphone-level"
                        role="meter"
                      >
                        <span
                          className="practice-microphone-level-fill"
                          style={{ width: `${Math.round(microphoneInputLevel * 100)}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <span role="status">
                      {microphoneStatus === "requesting"
                        ? "正在连接麦克风…"
                        : (microphoneError ?? (isPaused ? "已暂停，麦克风已释放" : "麦克风未连接"))}
                    </span>
                  )}
                </div>
              ) : (
                <p>
                  {preferences.inputMode === "midi"
                    ? (midi.selectedInput?.name ?? "MIDI 键盘")
                    : "点击下方琴键作答"}
                </p>
              )}
            </div>
            <div className="name-key-run-actions">
              {preferences.mode === "fixed-duration" ? (
                <strong
                  className="name-key-countdown"
                  aria-label={`剩余 ${formatRemainingTime(remainingMs)}`}
                >
                  {formatRemainingTime(remainingMs)}
                </strong>
              ) : preferences.mode === "fixed-count" ? (
                <strong
                  className="name-key-countdown"
                  aria-label={`已完成 ${roundEvents.length} 题，共 ${preferences.fixedCount} 题`}
                >
                  {roundEvents.length}/{preferences.fixedCount}
                </strong>
              ) : null}
              <button onClick={() => void togglePause()} type="button">
                {isPaused ? <Play size={17} /> : <Pause size={17} />}
                {isPaused ? "继续" : "暂停"}
              </button>
              <button onClick={endRound} type="button">
                <Square size={16} />
                结束
              </button>
              <button
                aria-label="查看音名键位"
                className="name-key-reference-button"
                onClick={() => setIsNoteKeyGuideOpen(true)}
                title="查看音名键位"
                type="button"
              >
                <Music2 aria-hidden="true" size={16} />
                音名键位
              </button>
            </div>
          </header>

          {preferences.mode === "fixed-duration" ? (
            <div
              aria-label={`${Math.round(preferences.fixedDurationSeconds / 60)} 分钟倒计时`}
              className="name-key-timer-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={preferences.fixedDurationSeconds}
              aria-valuenow={Math.ceil(remainingMs / 1000)}
            >
              <span
                style={{
                  width: `${Math.max(0, Math.min(100, (remainingMs / roundDurationMs) * 100))}%`,
                }}
              />
            </div>
          ) : null}

          {target ? (
            <div
              className={`name-key-prompt${feedback ? " has-feedback" : ""}${preferences.inputMode === "microphone" ? " is-microphone" : ""}`}
              aria-live="polite"
            >
              <span className="name-key-prompt-caption">找到这个音名</span>
              <strong>
                {preferences.includeOctaveNumbers
                  ? target.displayName
                  : target.displayName.replace(/\d+$/, "")}
              </strong>
            </div>
          ) : (
            <div className="name-key-prompt name-key-prompt-pending" role="status">
              下一题马上来…
            </div>
          )}

          {preferences.inputMode === "virtual-keyboard" && preferences.includeOctaveNumbers ? (
            <div aria-label="选择键盘八度" className="name-key-octave-switcher" role="group">
              {[1, 2, 3, 4, 5, 6].map((octave) => (
                <button
                  aria-pressed={selectedOctave === octave}
                  className={selectedOctave === octave ? "is-selected" : ""}
                  key={octave}
                  onClick={() => setSelectedOctave(octave)}
                  type="button"
                >
                  Oct {octave}
                </button>
              ))}
            </div>
          ) : null}

          {preferences.inputMode === "virtual-keyboard" ? (
            <NameToKeyKeyboard
              feedback={feedback ?? undefined}
              includeOctaveNumbers={preferences.includeOctaveNumbers || visibleOctaves.length > 1}
              octaves={visibleOctaves}
              showOctaveLabels={preferences.includeOctaveNumbers || visibleOctaves.length > 1}
              onKeyPress={(midiNoteNumber) => {
                const keyName = midiToKeyName(midiNoteNumber) as PianoKeyName;
                const octave = midiToOctave(midiNoteNumber) as Octave;
                handlePracticeAnswer(
                  {
                    midiNoteNumber,
                    noteName: keyName.replace(/#$/, "") as NoteName,
                    octave,
                    source: "screen-keyboard",
                  },
                  "virtual-keyboard"
                );
              }}
            />
          ) : null}

          {isPaused ? (
            <div className="name-key-paused-overlay">
              <strong>已暂停</strong>
              <span>
                {preferences.mode === "fixed-duration" ? "倒计时也暂停了" : "练习进度已暂停"}
              </span>
              <button className="primary" onClick={() => void togglePause()} type="button">
                <Play size={17} />
                继续
              </button>
            </div>
          ) : null}
          {statusMessage ? (
            <p className="name-key-status-message" role="alert">
              {statusMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      {stage === "summary" ? (
        <div className="name-key-summary-card">
          <div className="name-key-summary-icon">
            <Check aria-hidden="true" size={26} />
          </div>
          <h1>本局答题结果</h1>
          <div className="name-key-summary-score">
            <strong>{roundEvents.filter((event) => event.isCorrectFinal).length}</strong>
            <span>答对</span>
            <strong>
              {roundEvents.filter((event) => event.wrongAttempts > 0 || event.isMissed).length}
            </strong>
            <span>需要再认认</span>
          </div>
          {mostMissed.length > 0 ? (
            <section className="name-key-most-missed" aria-label="最容易按错的音名">
              <h2>下次可以多留意</h2>
              <ol>
                {mostMissed.map(({ count, name }) => (
                  <li key={name}>
                    <strong>{name}</strong>
                    <span>{count} 次</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : (
            <p className="name-key-summary-perfect">太稳了！这一局没有答错。</p>
          )}
          <div className="name-key-summary-actions">
            <button
              onClick={() => {
                setStage("setup");
                setStatusMessage("");
              }}
              type="button"
            >
              返回设置
            </button>
            <button className="primary" onClick={() => void startRound()} type="button">
              <RotateCcw size={17} />
              再来一局
            </button>
          </div>
        </div>
      ) : null}

      <NameKeyReferenceDialog
        isOpen={stage === "running" && isNoteKeyGuideOpen}
        onClose={() => setIsNoteKeyGuideOpen(false)}
      />
    </section>
  );
}
