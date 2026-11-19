import { SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnswerEvent } from "../../../domain/types";
import { createUuid } from "../../../domain/id";
import { answerDeviceInfo } from "../../../data/answerEvents";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { PauseOverlay } from "../../../shared/components/PauseOverlay";
import { PracticeFullscreenToggle } from "../../practice/components/PracticeFullscreenFrame";
import {
  formatPracticeQuestionProgress,
  PracticeSessionHeader,
} from "../../practice/components/PracticeSessionFrame";
import {
  chordNotesMatch,
  CHORD_INVERSION_OPTIONS,
  CHORD_DEGREE_OPTIONS,
  generateChordPrompt,
  getChordMajorKey,
  getChordDegreeLabel,
  getChordInversionLabel,
  getChordQualityLabel,
  getDiatonicChords,
  getChordPromptMidiNotes,
  type ChordPrompt,
  type ChordQuality,
  type ChordTrainingAnswerEventData,
  type ChordTrainingConfig,
} from "../logic/chordTraining";
import { ChordStaffPrompt } from "./ChordStaffPrompt";

const CHORD_INPUT_WINDOW_MS = 280;
const ANSWER_FEEDBACK_MS = 850;
const CHORD_QUALITY_ORDER: readonly ChordQuality[] = [
  "major-triad",
  "minor-triad",
  "diminished-triad",
  "major-seventh",
  "minor-seventh",
  "dominant-seventh",
  "half-diminished-seventh",
];
const CHORD_QUALITY_SYMBOLS: Record<ChordQuality, string> = {
  "major-triad": "maj",
  "minor-triad": "m",
  "diminished-triad": "dim",
  "major-seventh": "maj7",
  "minor-seventh": "m7",
  "dominant-seventh": "7",
  "half-diminished-seventh": "m7♭5",
};
const CHORD_QUALITY_KIND: Record<ChordQuality, "triad" | "seventh"> = {
  "major-triad": "triad",
  "minor-triad": "triad",
  "diminished-triad": "triad",
  "major-seventh": "seventh",
  "minor-seventh": "seventh",
  "dominant-seventh": "seventh",
  "half-diminished-seventh": "seventh",
};

type ChordRecognitionStep = "root" | "quality" | "inversion";

interface ChordAnswerFeedback {
  correct: boolean;
  expectedName: string;
}

interface ChordRootFeedback {
  selectedRootName: string;
}

export function ChordTrainingRun({
  config,
  dataSetId,
  midi,
  onExit,
  onFinish,
  onPauseChange,
  onRestart,
}: {
  config: ChordTrainingConfig;
  dataSetId: string;
  midi: MidiInputController;
  onExit: () => void;
  onFinish: (result: { completed: boolean; elapsedMs: number; events: AnswerEvent[] }) => void;
  onPauseChange: (paused: boolean) => void;
  onRestart: () => void;
}): JSX.Element {
  const [prompt, setPrompt] = useState<ChordPrompt>(() => generateChordPrompt(config));
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [events, setEvents] = useState<AnswerEvent[]>([]);
  const [feedback, setFeedback] = useState<ChordAnswerFeedback | null>(null);
  const [enteredMidiNotes, setEnteredMidiNotes] = useState<number[]>([]);
  const [recognitionStep, setRecognitionStep] = useState<ChordRecognitionStep>("root");
  const [selectedRootName, setSelectedRootName] = useState<string | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<ChordQuality | null>(null);
  const [selectedInversion, setSelectedInversion] = useState<number | null>(null);
  const [isPromptHintVisible, setIsPromptHintVisible] = useState(false);
  const [rootFeedback, setRootFeedback] = useState<ChordRootFeedback | null>(null);

  const keyChords = useMemo(
    () =>
      getDiatonicChords(
        config.keyId,
        CHORD_DEGREE_OPTIONS.map(({ degree }) => degree),
        config.qualities
      ),
    [config.keyId, config.qualities]
  );
  const rootOptions = useMemo(
    () => [...new Set(keyChords.map(({ rootName }) => rootName))],
    [keyChords]
  );
  const qualityOptions = useMemo(
    () =>
      CHORD_QUALITY_ORDER.filter((quality) =>
        config.qualities.includes(CHORD_QUALITY_KIND[quality])
      ),
    [config.qualities]
  );
  const inversionOptions = useMemo(
    () =>
      CHORD_INVERSION_OPTIONS.filter(
        ({ value }) => value < (prompt.chord.kind === "triad" ? 3 : 4)
      ).map(({ value }) => value),
    [prompt.chord.kind]
  );

  const promptRef = useRef(prompt);
  const eventsRef = useRef<AnswerEvent[]>([]);
  const runIdRef = useRef(createUuid());
  const currentDataSetIdRef = useRef(dataSetId);
  const elapsedRef = useRef(0);
  const pausedElapsedRef = useRef(0);
  const startedAtRef = useRef(performance.now());
  const isPausedRef = useRef(false);
  const isFinishedRef = useRef(false);
  const questionResolvedRef = useRef(false);
  const questionWrongAttemptsRef = useRef(0);
  const promptStartedAtRef = useRef(Date.now());
  const arpeggioIndexRef = useRef(0);
  const enteredMidiNotesRef = useRef<number[]>([]);
  const pendingBlockNotesRef = useRef(new Set<number>());
  const blockTimerRef = useRef<number | null>(null);
  const advanceTimerRef = useRef<number | null>(null);
  const advanceTimerStartedAtRef = useRef(0);
  const advanceRemainingMsRef = useRef(ANSWER_FEEDBACK_MS);
  const onFinishRef = useRef(onFinish);
  const onPauseChangeRef = useRef(onPauseChange);

  promptRef.current = prompt;
  currentDataSetIdRef.current = dataSetId;
  onFinishRef.current = onFinish;
  onPauseChangeRef.current = onPauseChange;

  const measureElapsed = useCallback((): number => {
    const elapsed = isPausedRef.current
      ? pausedElapsedRef.current
      : pausedElapsedRef.current + performance.now() - startedAtRef.current;
    elapsedRef.current = elapsed;
    return elapsed;
  }, []);

  const finishRun = useCallback(
    (completed: boolean): void => {
      if (isFinishedRef.current) return;
      isFinishedRef.current = true;
      if (blockTimerRef.current !== null) window.clearTimeout(blockTimerRef.current);
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
      onPauseChangeRef.current(false);
      onFinishRef.current({
        completed,
        elapsedMs: measureElapsed(),
        events: [...eventsRef.current],
      });
    },
    [measureElapsed]
  );

  useEffect(
    () => () => {
      if (blockTimerRef.current !== null) window.clearTimeout(blockTimerRef.current);
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (!rootFeedback) return undefined;
    const timer = window.setTimeout(() => setRootFeedback(null), 800);
    return () => window.clearTimeout(timer);
  }, [rootFeedback]);

  const beginNextQuestion = useCallback((): void => {
    const next = generateChordPrompt(config);
    promptRef.current = next;
    setPrompt(next);
    setFeedback(null);
    setRecognitionStep("root");
    setSelectedRootName(null);
    setSelectedQuality(null);
    setSelectedInversion(null);
    setRootFeedback(null);
    setIsPromptHintVisible(false);
    arpeggioIndexRef.current = 0;
    setEnteredMidiNotes([]);
    enteredMidiNotesRef.current = [];
    advanceRemainingMsRef.current = ANSWER_FEEDBACK_MS;
    pendingBlockNotesRef.current.clear();
    questionResolvedRef.current = false;
    questionWrongAttemptsRef.current = 0;
    promptStartedAtRef.current = Date.now();
  }, [config]);

  const scheduleAdvance = useCallback((): void => {
    if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    advanceTimerStartedAtRef.current = performance.now();
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      advanceRemainingMsRef.current = ANSWER_FEEDBACK_MS;
      const completedCount = eventsRef.current.length;
      if (config.lengthMode === "fixed-count" && completedCount >= config.fixedCount) {
        finishRun(true);
      } else {
        beginNextQuestion();
      }
    }, advanceRemainingMsRef.current);
  }, [beginNextQuestion, config.fixedCount, config.lengthMode, finishRun]);

  const resolveQuestion = useCallback(
    ({
      correct,
      entered = [],
      selectedChordId,
      recognitionAnswer,
      missed = false,
    }: {
      correct: boolean;
      entered?: number[];
      selectedChordId?: string;
      recognitionAnswer?: {
        rootName?: string;
        quality?: ChordQuality;
        inversion?: number;
      };
      missed?: boolean;
    }): void => {
      if (questionResolvedRef.current || isPausedRef.current || isFinishedRef.current) return;
      questionResolvedRef.current = true;
      const currentPrompt = promptRef.current;
      const chordData: ChordTrainingAnswerEventData = {
        task: config.task,
        keyId: config.keyId,
        chordId: currentPrompt.chord.id,
        chordName: currentPrompt.chord.name,
        degree: currentPrompt.chord.degree,
        quality: currentPrompt.chord.quality,
        inversion: currentPrompt.inversion,
        noteDuration: currentPrompt.noteDuration,
        targetMidiNotes: getChordPromptMidiNotes(currentPrompt),
        ...(entered.length ? { enteredMidiNotes: entered } : {}),
        ...(selectedChordId ? { selectedChordId } : {}),
        ...(recognitionAnswer?.rootName ? { selectedRootName: recognitionAnswer.rootName } : {}),
        ...(recognitionAnswer?.quality ? { selectedQuality: recognitionAnswer.quality } : {}),
        ...(recognitionAnswer?.inversion !== undefined
          ? { selectedInversion: recognitionAnswer.inversion }
          : {}),
      };
      const wrongAttempts = questionWrongAttemptsRef.current + Number(!correct);
      const event: AnswerEvent = {
        id: createUuid(),
        dataSetId: currentDataSetIdRef.current,
        sessionId: runIdRef.current,
        eventIndex: eventsRef.current.length,
        occurredAt: new Date().toISOString(),
        promptStartedAt: new Date(promptStartedAtRef.current).toISOString(),
        promptEndedAt: new Date().toISOString(),
        mode: "chord-training",
        learningLevelId: 8,
        inputMode: config.task === "recognize" ? "computer-keyboard" : "midi",
        deviceInfo: answerDeviceInfo(),
        chordTraining: chordData,
        targetDisplayName: currentPrompt.chord.name,
        attempts: [],
        isCorrectFirstTry: correct && wrongAttempts === 0,
        isCorrectFinal: correct,
        rawResponseTimeMs: Math.max(0, Date.now() - promptStartedAtRef.current),
        responseTimeMs: Math.max(0, Date.now() - promptStartedAtRef.current),
        activeMs: Math.max(0, Date.now() - promptStartedAtRef.current),
        wrongAttempts,
        isExtraNote: false,
        isMissed: missed,
      };
      eventsRef.current = [...eventsRef.current, event];
      setEvents(eventsRef.current);
      setFeedback({
        correct,
        expectedName: `${getChordDegreeLabel(currentPrompt.chord.degree)} · ${currentPrompt.chord.name} · ${getChordInversionLabel(currentPrompt.inversion)}`,
      });

      if (correct) {
        advanceRemainingMsRef.current = ANSWER_FEEDBACK_MS;
        scheduleAdvance();
      }
    },
    [config, scheduleAdvance]
  );

  useEffect(() => {
    if (isPaused) return undefined;
    const timer = window.setInterval(() => {
      const elapsed = measureElapsed();
      setElapsedMs(elapsed);
      if (config.lengthMode === "fixed-duration" && elapsed >= config.fixedDurationSeconds * 1000) {
        finishRun(true);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [config.fixedDurationSeconds, config.lengthMode, finishRun, isPaused, measureElapsed]);

  useEffect(() => {
    if (isPaused || !midi.isConnected || config.task === "recognize") return undefined;
    const unsubscribe = midi.subscribe((event) => {
      if (event.type !== "press" || questionResolvedRef.current || isFinishedRef.current) return;
      const note = event.note.midiNoteNumber;
      if (config.task === "block") {
        pendingBlockNotesRef.current.add(note);
        setEnteredMidiNotes([...pendingBlockNotesRef.current]);
        if (blockTimerRef.current !== null) window.clearTimeout(blockTimerRef.current);
        blockTimerRef.current = window.setTimeout(() => {
          blockTimerRef.current = null;
          const entered = [...pendingBlockNotesRef.current];
          resolveQuestion({
            correct: chordNotesMatch(getChordPromptMidiNotes(promptRef.current), entered),
            entered,
          });
        }, CHORD_INPUT_WINDOW_MS);
        return;
      }

      const expectedNotes = getChordPromptMidiNotes(promptRef.current);
      const nextIndex = arpeggioIndexRef.current;
      const nextEntered = [...enteredMidiNotesRef.current, note];
      enteredMidiNotesRef.current = nextEntered;
      setEnteredMidiNotes(nextEntered);
      if (expectedNotes[nextIndex] !== note) {
        resolveQuestion({ correct: false, entered: nextEntered });
        return;
      }
      const newIndex = nextIndex + 1;
      arpeggioIndexRef.current = newIndex;
      if (newIndex === expectedNotes.length) {
        resolveQuestion({ correct: true, entered: nextEntered });
      }
    });
    return () => unsubscribe();
  }, [config.task, isPaused, midi, resolveQuestion]);

  enteredMidiNotesRef.current = enteredMidiNotes;

  const togglePause = (): void => {
    if (isFinishedRef.current) return;
    if (isPausedRef.current) {
      startedAtRef.current = performance.now();
      isPausedRef.current = false;
      setIsPaused(false);
      onPauseChangeRef.current(false);
      if (feedback?.correct) scheduleAdvance();
      return;
    }
    pausedElapsedRef.current = measureElapsed();
    isPausedRef.current = true;
    if (advanceTimerRef.current !== null) {
      advanceRemainingMsRef.current = Math.max(
        0,
        advanceRemainingMsRef.current - (performance.now() - advanceTimerStartedAtRef.current)
      );
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    pendingBlockNotesRef.current.clear();
    arpeggioIndexRef.current = 0;
    if (blockTimerRef.current !== null) {
      window.clearTimeout(blockTimerRef.current);
      blockTimerRef.current = null;
    }
    setEnteredMidiNotes([]);
    enteredMidiNotesRef.current = [];
    setIsPaused(true);
    onPauseChangeRef.current(true);
  };

  const elapsedSeconds = Math.max(0, Math.ceil(elapsedMs / 1000));
  const remainingSeconds = Math.max(0, config.fixedDurationSeconds - elapsedSeconds);
  const selectRecognitionRoot = (rootName: string): void => {
    if (feedback || isPaused) return;
    setSelectedRootName(rootName);
    if (rootName !== prompt.chord.rootName) {
      questionWrongAttemptsRef.current += 1;
      setRootFeedback({ selectedRootName: rootName });
      return;
    }
    setRootFeedback(null);
    setSelectedQuality(null);
    setSelectedInversion(null);
    setRecognitionStep("quality");
  };

  const selectRecognitionQuality = (quality: ChordQuality): void => {
    if (!selectedRootName) return;
    setSelectedQuality(quality);
    setSelectedInversion(null);
    const selectedChord = keyChords.find(
      (candidate) => candidate.rootName === selectedRootName && candidate.quality === quality
    );
    if (selectedChord?.id !== prompt.chord.id) {
      resolveQuestion({
        correct: false,
        ...(selectedChord ? { selectedChordId: selectedChord.id } : {}),
        recognitionAnswer: { rootName: selectedRootName, quality },
      });
      return;
    }
    if (config.requireInversionAnswer) {
      setRecognitionStep("inversion");
      return;
    }
    resolveQuestion({
      correct: selectedChord?.id === prompt.chord.id,
      ...(selectedChord ? { selectedChordId: selectedChord.id } : {}),
      recognitionAnswer: { rootName: selectedRootName, quality },
    });
  };
  const selectRecognitionInversion = (inversion: number): void => {
    if (!selectedRootName || !selectedQuality) return;
    setSelectedInversion(inversion);
    const selectedChord = keyChords.find(
      (candidate) =>
        candidate.rootName === selectedRootName && candidate.quality === selectedQuality
    );
    resolveQuestion({
      correct: selectedChord?.id === prompt.chord.id && inversion === prompt.inversion,
      ...(selectedChord ? { selectedChordId: selectedChord.id } : {}),
      recognitionAnswer: { rootName: selectedRootName, quality: selectedQuality, inversion },
    });
  };
  const progressLabel =
    config.lengthMode === "fixed-count"
      ? formatPracticeQuestionProgress(events.length, config.fixedCount)
      : config.lengthMode === "fixed-duration"
        ? `${formatPracticeQuestionProgress(events.length)} · ${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")} 剩余`
        : formatPracticeQuestionProgress(events.length);
  const advanceToNextQuestion = (): void => {
    const completedCount = eventsRef.current.length;
    if (config.lengthMode === "fixed-count" && completedCount >= config.fixedCount) {
      finishRun(true);
    } else {
      beginNextQuestion();
    }
  };

  return (
    <section aria-labelledby="chord-training-run-title" className="chord-training-run">
      <PracticeSessionHeader
        exitAriaLabel={
          config.lengthMode === "open-ended" ? "结束练习并查看结果" : "结束练习并返回配置"
        }
        exitLabel="结束返回"
        isPaused={isPaused}
        onExit={() => {
          if (config.lengthMode === "open-ended") {
            finishRun(true);
            return;
          }
          onExit();
        }}
        onPauseToggle={togglePause}
        onRestart={onRestart}
        progress={progressLabel}
        title={<span id="chord-training-run-title">和弦训练</span>}
      >
        <PracticeFullscreenToggle />
      </PracticeSessionHeader>

      <div className="chord-training-prompt-panel">
        <div className="chord-training-prompt-toolbar">
          <button
            aria-expanded={isPromptHintVisible}
            aria-controls="chord-training-prompt-hint"
            className="chord-training-prompt-hint-toggle"
            onClick={() => setIsPromptHintVisible((visible) => !visible)}
            type="button"
          >
            {isPromptHintVisible ? "隐藏本题提示" : "显示本题提示"}
          </button>
          {config.task !== "recognize" ? (
            <span className={midi.isConnected ? "is-midi-ready" : "is-midi-missing"}>
              {midi.isConnected ? "MIDI 已连接" : "MIDI 已断开"}
            </span>
          ) : null}
          <div
            className="chord-training-prompt-meta"
            hidden={!isPromptHintVisible}
            id="chord-training-prompt-hint"
          >
            <span>{getChordMajorKey(config.keyId).label}</span>
            <span>{getChordDegreeLabel(prompt.chord.degree)} 级</span>
            <span>{getChordInversionLabel(prompt.inversion)}</span>
          </div>
        </div>
        <ChordStaffPrompt prompt={prompt} />

        {config.task === "recognize" ? (
          <div aria-label="分步选择和弦" className="chord-training-recognition">
            {recognitionStep !== "root" && selectedRootName ? (
              <button
                aria-label={`重选根音，当前为 ${selectedRootName}`}
                className={`chord-training-recognition-edit${feedback ? (selectedRootName === prompt.chord.rootName ? " is-correct" : " is-wrong") : ""}`}
                disabled={Boolean(feedback) || isPaused}
                onClick={() => {
                  setRecognitionStep("root");
                  setSelectedRootName(null);
                  setSelectedQuality(null);
                  setSelectedInversion(null);
                }}
                type="button"
              >
                根音：{selectedRootName} · 修改
              </button>
            ) : null}
            {recognitionStep === "inversion" && selectedQuality ? (
              <button
                aria-label={`重选和弦性质，当前为 ${CHORD_QUALITY_SYMBOLS[selectedQuality]}`}
                className={`chord-training-recognition-edit${feedback ? (selectedQuality === prompt.chord.quality ? " is-correct" : " is-wrong") : ""}`}
                disabled={Boolean(feedback) || isPaused}
                onClick={() => {
                  setRecognitionStep("quality");
                  setSelectedQuality(null);
                  setSelectedInversion(null);
                }}
                type="button"
              >
                性质：{CHORD_QUALITY_SYMBOLS[selectedQuality]} · 修改
              </button>
            ) : null}

            {recognitionStep === "root" ? (
              <section aria-label="第一步，选择根音" className="chord-training-answer-step">
                <h2>第一步 · 选根音</h2>
                <div className="chord-training-answer-options" role="group">
                  {rootOptions.map((rootName) => (
                    <button
                      className={rootFeedback?.selectedRootName === rootName ? "is-wrong" : ""}
                      disabled={Boolean(feedback) || isPaused}
                      key={rootName}
                      onClick={() => selectRecognitionRoot(rootName)}
                      type="button"
                    >
                      {rootName}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {recognitionStep === "quality" ? (
              <section aria-label="第二步，选择和弦性质" className="chord-training-answer-step">
                <h2>第二步 · 选和弦性质</h2>
                <div className="chord-training-answer-options" role="group">
                  {qualityOptions.map((quality) => (
                    <button
                      className={
                        feedback
                          ? quality === prompt.chord.quality
                            ? "is-correct"
                            : quality === selectedQuality
                              ? "is-wrong"
                              : ""
                          : ""
                      }
                      disabled={Boolean(feedback) || isPaused}
                      key={quality}
                      onClick={() => selectRecognitionQuality(quality)}
                      type="button"
                    >
                      <span>{CHORD_QUALITY_SYMBOLS[quality]}</span>
                      <small>{getChordQualityLabel(quality)}</small>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {recognitionStep === "inversion" ? (
              <section aria-label="第三步，选择转位" className="chord-training-answer-step">
                <h2>第三步 · 选转位</h2>
                <div className="chord-training-answer-options" role="group">
                  {CHORD_INVERSION_OPTIONS.filter(({ value }) =>
                    inversionOptions.includes(value)
                  ).map(({ value, label }) => (
                    <button
                      className={
                        feedback
                          ? value === prompt.inversion
                            ? "is-correct"
                            : value === selectedInversion
                              ? "is-wrong"
                              : ""
                          : ""
                      }
                      disabled={Boolean(feedback) || isPaused}
                      key={value}
                      onClick={() => selectRecognitionInversion(value)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <div aria-live="polite" className="chord-training-performance-hint">
            {config.task === "block"
              ? enteredMidiNotes.length > 0
                ? `已收到 ${enteredMidiNotes.length} 个音，继续按下同一组和弦音。`
                : "同时按下谱面中的全部和弦音。"
              : enteredMidiNotes.length > 0
                ? `已弹 ${enteredMidiNotes.length} / ${prompt.notes.length} 个音`
                : "按谱面和弦音从低到高依次弹奏。"}
          </div>
        )}

        {feedback || config.task !== "recognize" ? (
          <div
            aria-live="polite"
            className={`chord-training-feedback${feedback ? (feedback.correct ? " is-correct" : " is-wrong") : ""}`}
          >
            {feedback ? (
              <strong>{feedback.correct ? "正确" : `正确答案：${feedback.expectedName}`}</strong>
            ) : (
              <span>等待 MIDI 输入</span>
            )}
          </div>
        ) : null}
        {feedback?.correct ? null : (
          <button
            className="chord-training-skip"
            disabled={isPaused}
            onClick={() => {
              if (rootFeedback && !feedback) {
                resolveQuestion({
                  correct: false,
                  recognitionAnswer: { rootName: rootFeedback.selectedRootName },
                });
                advanceToNextQuestion();
                return;
              }

              if (feedback) {
                advanceToNextQuestion();
                return;
              }

              resolveQuestion({
                correct: false,
                missed: true,
                entered: enteredMidiNotes,
                ...(config.task === "recognize"
                  ? {
                      recognitionAnswer: {
                        ...(selectedRootName ? { rootName: selectedRootName } : {}),
                        ...(selectedQuality ? { quality: selectedQuality } : {}),
                        ...(selectedInversion !== null ? { inversion: selectedInversion } : {}),
                      },
                    }
                  : {}),
              });
            }}
            type="button"
          >
            <SkipForward aria-hidden="true" size={16} />
            {feedback || rootFeedback ? "下一题" : "跳过本题"}
          </button>
        )}
      </div>

      {isPaused ? <PauseOverlay onResume={togglePause} showKeyboardShortcuts={false} /> : null}
    </section>
  );
}
