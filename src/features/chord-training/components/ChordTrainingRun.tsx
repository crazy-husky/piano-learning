import { SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnswerEvent } from "../../../domain/types";
import { createUuid } from "../../../domain/id";
import { answerDeviceInfo } from "../../../data/answerEvents";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { MidiInputControl } from "../../../midi/MidiInputControl";
import { PauseOverlay } from "../../../shared/components/PauseOverlay";
import { PracticeFullscreenToggle } from "../../practice/components/PracticeFullscreenFrame";
import { PracticeSessionFrame } from "../../practice/components/PracticeSessionFrame";
import {
  formatPracticeQuestionProgress,
  PracticeSessionHeader,
} from "../../practice/components/PracticeSessionFrame";
import type { MetronomeController } from "../../metronome/useMetronomeController";
import {
  getPracticeAudioTimeAtBeat,
  getPracticeBeatDurationMs,
  getPracticeBeatAtAudioTime,
  getPracticeTimingGrade,
  getPracticeTimingWindowMs,
  type PracticeTempoAnchor,
  type PracticeTimingGrade,
} from "../../practice/logic/practiceMetronomeSync";
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
import { ChordStaffPage } from "./ChordStaffPage";
import { ChordStaffPrompt } from "./ChordStaffPrompt";

const CHORD_INPUT_WINDOW_MS = 280;
const ANSWER_FEEDBACK_MS = 850;
const CHORD_SCORE_BATCH_SIZE = 24;
const SYNC_MAX_OFFSET_BEATS = 0.5;
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
type ChordScoreEventFeedback = "correct" | "early" | "late" | "wrong" | "missed";

function chordDurationInBeats(duration: ChordPrompt["noteEvents"][number]["duration"]): number {
  return duration === "8" ? 0.5 : duration === "h" ? 2 : duration === "w" ? 4 : 1;
}

function chordEventBeatOffset(prompt: ChordPrompt, index: number): number {
  return prompt.noteEvents
    .slice(0, index)
    .reduce((total, event) => total + chordDurationInBeats(event.duration), 0);
}

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
  metronomeController,
  onMetronomeSyncToggleChange,
  onMetronomeSyncPauseChange,
  onExit,
  onFinish,
  onPauseChange,
  onRestart,
}: {
  config: ChordTrainingConfig;
  dataSetId: string;
  midi: MidiInputController;
  metronomeController: MetronomeController;
  onMetronomeSyncToggleChange?: (toggle: (() => void) | undefined) => void;
  onMetronomeSyncPauseChange?: (pause: (() => void) | undefined) => void;
  onExit: () => void;
  onFinish: (result: { completed: boolean; elapsedMs: number; events: AnswerEvent[] }) => void;
  onPauseChange: (paused: boolean) => void;
  onRestart: () => void;
}): JSX.Element {
  const initialPromptCount =
    config.lengthMode === "fixed-count"
      ? Math.max(1, Math.min(config.fixedCount, CHORD_SCORE_BATCH_SIZE))
      : CHORD_SCORE_BATCH_SIZE;
  const [promptSequence, setPromptSequence] = useState<ChordPrompt[]>(() =>
    Array.from({ length: initialPromptCount }, () => generateChordPrompt(config))
  );
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [prompt, setPrompt] = useState<ChordPrompt>(() => promptSequence[0]!);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [events, setEvents] = useState<AnswerEvent[]>([]);
  const [feedback, setFeedback] = useState<ChordAnswerFeedback | null>(null);
  const [recognitionStep, setRecognitionStep] = useState<ChordRecognitionStep>("root");
  const [selectedRootName, setSelectedRootName] = useState<string | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<ChordQuality | null>(null);
  const [selectedInversion, setSelectedInversion] = useState<number | null>(null);
  const [isPromptHintVisible, setIsPromptHintVisible] = useState(false);
  const [rootFeedback, setRootFeedback] = useState<ChordRootFeedback | null>(null);
  const [syncCountInBeat, setSyncCountInBeat] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [activeEventIndex, setActiveEventIndex] = useState(0);
  const [scoreFeedbackByQuestion, setScoreFeedbackByQuestion] = useState<
    ChordScoreEventFeedback[][]
  >([]);
  const syncEnabled = config.task !== "recognize" && config.metronomeSyncEnabled;
  const {
    getAudioTime: getMetronomeAudioTime,
    performanceTimeToAudioTime,
    preferences: metronomePreferences,
    scheduleAtAudioTime,
    setSyncLocked: setMetronomeSyncLocked,
    start: startMetronome,
    stop: stopMetronome,
    subscribeBeat: subscribeMetronomeBeat,
  } = metronomeController;
  const metronomePreferencesRef = useRef(metronomePreferences);
  metronomePreferencesRef.current = metronomePreferences;

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
  const promptSequenceRef = useRef(promptSequence);
  const activeQuestionIndexRef = useRef(0);
  const scoreFeedbackRef = useRef<ChordScoreEventFeedback[][]>([]);
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
  const syncMissTimerRef = useRef<number | null>(null);
  const syncStartSequenceRef = useRef<number | null>(null);
  const syncSessionRef = useRef(false);
  const promptStartAudioTimeRef = useRef<number | null>(null);
  const syncTempoAnchorsRef = useRef<PracticeTempoAnchor[]>([]);
  const syncScheduleRevisionRef = useRef(0);
  const promptNeedsSyncAnchorRef = useRef(false);
  const activeEventIndexRef = useRef(0);
  const blockTimingGradeRef = useRef<PracticeTimingGrade | null>(null);
  const advanceTimerRef = useRef<number | null>(null);
  const advanceTimerStartedAtRef = useRef(0);
  const advanceRemainingMsRef = useRef(ANSWER_FEEDBACK_MS);
  const onFinishRef = useRef(onFinish);
  const onPauseChangeRef = useRef(onPauseChange);
  const onMetronomeSyncToggleChangeRef = useRef(onMetronomeSyncToggleChange);
  const onMetronomeSyncPauseChangeRef = useRef(onMetronomeSyncPauseChange);

  promptRef.current = prompt;
  currentDataSetIdRef.current = dataSetId;
  onFinishRef.current = onFinish;
  onPauseChangeRef.current = onPauseChange;
  onMetronomeSyncToggleChangeRef.current = onMetronomeSyncToggleChange;
  onMetronomeSyncPauseChangeRef.current = onMetronomeSyncPauseChange;

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
      if (syncMissTimerRef.current !== null) window.clearTimeout(syncMissTimerRef.current);
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
      if (syncSessionRef.current) {
        syncSessionRef.current = false;
        stopMetronome();
        setMetronomeSyncLocked(false);
      }
      setSyncCountInBeat(null);
      onPauseChangeRef.current(false);
      onFinishRef.current({
        completed,
        elapsedMs: measureElapsed(),
        events: [...eventsRef.current],
      });
    },
    [measureElapsed, setMetronomeSyncLocked, stopMetronome]
  );

  useEffect(
    () => () => {
      if (blockTimerRef.current !== null) window.clearTimeout(blockTimerRef.current);
      if (syncMissTimerRef.current !== null) window.clearTimeout(syncMissTimerRef.current);
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
      if (syncSessionRef.current) {
        syncSessionRef.current = false;
        stopMetronome();
        setMetronomeSyncLocked(false);
      }
    },
    [setMetronomeSyncLocked, stopMetronome]
  );

  useEffect(() => {
    if (!rootFeedback) return undefined;
    const timer = window.setTimeout(() => setRootFeedback(null), 800);
    return () => window.clearTimeout(timer);
  }, [rootFeedback]);

  const beginNextQuestion = useCallback((): void => {
    const nextIndex = activeQuestionIndexRef.current + 1;
    let sequence = promptSequenceRef.current;
    const shouldAppendBatch = nextIndex >= sequence.length || sequence.length - nextIndex <= 8;
    const remainingFixedCount =
      config.lengthMode === "fixed-count"
        ? Math.max(0, config.fixedCount - sequence.length)
        : Infinity;
    const batchCount = Math.min(CHORD_SCORE_BATCH_SIZE, remainingFixedCount);
    if (shouldAppendBatch && batchCount > 0) {
      sequence = [
        ...sequence,
        ...Array.from({ length: batchCount }, () => generateChordPrompt(config)),
      ];
      promptSequenceRef.current = sequence;
      setPromptSequence(sequence);
    }
    const next = sequence[nextIndex]!;
    activeQuestionIndexRef.current = nextIndex;
    setActiveQuestionIndex(nextIndex);
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
    activeEventIndexRef.current = 0;
    setActiveEventIndex(0);
    if (syncMissTimerRef.current !== null) {
      window.clearTimeout(syncMissTimerRef.current);
      syncMissTimerRef.current = null;
    }
    promptStartAudioTimeRef.current = null;
    syncTempoAnchorsRef.current = [];
    syncScheduleRevisionRef.current += 1;
    promptNeedsSyncAnchorRef.current = syncEnabled;
    blockTimingGradeRef.current = null;
    enteredMidiNotesRef.current = [];
    advanceRemainingMsRef.current = ANSWER_FEEDBACK_MS;
    pendingBlockNotesRef.current.clear();
    questionResolvedRef.current = false;
    questionWrongAttemptsRef.current = 0;
    promptStartedAtRef.current = Date.now();
  }, [config, syncEnabled]);

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

  const setScoreEventResult = useCallback(
    (index: number, result: ChordScoreEventFeedback): void => {
      const questionIndex = activeQuestionIndexRef.current;
      const next = scoreFeedbackRef.current.map((eventsForQuestion) => [...eventsForQuestion]);
      const questionFeedback = [...(next[questionIndex] ?? [])];
      questionFeedback[index] = result;
      next[questionIndex] = questionFeedback;
      scoreFeedbackRef.current = next;
      setScoreFeedbackByQuestion(next);
    },
    []
  );

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
      if (blockTimerRef.current !== null) {
        window.clearTimeout(blockTimerRef.current);
        blockTimerRef.current = null;
      }
      if (syncMissTimerRef.current !== null) {
        window.clearTimeout(syncMissTimerRef.current);
        syncMissTimerRef.current = null;
      }
      pendingBlockNotesRef.current.clear();
      const currentPrompt = promptRef.current;
      const feedbackForQuestion = scoreFeedbackRef.current[activeQuestionIndexRef.current] ?? [];
      const unresolvedEventIndex = Math.min(
        activeEventIndexRef.current,
        Math.max(0, currentPrompt.noteEvents.length - 1)
      );
      if (!correct && !feedbackForQuestion[unresolvedEventIndex]) {
        setScoreEventResult(unresolvedEventIndex, missed ? "missed" : "wrong");
      }
      const chordData: ChordTrainingAnswerEventData = {
        task: config.task,
        keyId: config.keyId,
        chordId: currentPrompt.chord.id,
        chordName: currentPrompt.chord.name,
        degree: currentPrompt.chord.degree,
        quality: currentPrompt.chord.quality,
        inversion: currentPrompt.inversion,
        ...(currentPrompt.noteEvents.length === 1
          ? { noteDuration: currentPrompt.noteEvents[0]!.duration }
          : {}),
        targetMidiNotes: getChordPromptMidiNotes(currentPrompt),
        noteEvents: currentPrompt.noteEvents.map(({ notes, duration }) => ({
          midiNotes: notes.map(({ midi }) => midi),
          duration,
        })),
        ...(currentPrompt.arpeggioPatternId
          ? { arpeggioPatternId: currentPrompt.arpeggioPatternId }
          : {}),
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

      if (correct || config.task !== "recognize") {
        advanceRemainingMsRef.current = ANSWER_FEEDBACK_MS;
        scheduleAdvance();
      }
    },
    [config, scheduleAdvance, setScoreEventResult]
  );

  const appendSyncTempoAnchor = useCallback(
    (audioTime: number, bpm: number): number | undefined => {
      const anchors = syncTempoAnchorsRef.current;
      const previous = anchors.at(-1);
      if (!previous || !Number.isFinite(audioTime) || !Number.isFinite(bpm) || bpm <= 0) {
        return undefined;
      }

      const beat = getPracticeBeatAtAudioTime(audioTime, anchors, previous.bpm);
      if (beat === undefined) return undefined;
      const isSameAnchorTime = Math.abs(audioTime - previous.audioTime) <= 0.0001;
      if (!isSameAnchorTime && (audioTime < previous.audioTime || beat <= previous.beat)) {
        return undefined;
      }

      const anchor: PracticeTempoAnchor = { audioTime, beat, bpm };
      if (isSameAnchorTime) anchors[anchors.length - 1] = anchor;
      else anchors.push(anchor);
      return beat;
    },
    []
  );

  const getSyncedEventAudioTime = useCallback((eventIndex: number): number | undefined => {
    const beatOffset = chordEventBeatOffset(promptRef.current, eventIndex);
    return getPracticeAudioTimeAtBeat(
      beatOffset,
      syncTempoAnchorsRef.current,
      metronomePreferencesRef.current.bpm
    );
  }, []);

  const scheduleSyncedEventHighlight = useCallback(
    (eventIndex: number): void => {
      const audioTime = getSyncedEventAudioTime(eventIndex);
      if (audioTime === undefined) return;
      const revision = ++syncScheduleRevisionRef.current;
      const currentPrompt = promptRef.current;
      scheduleAtAudioTime(() => {
        if (
          syncScheduleRevisionRef.current === revision &&
          promptRef.current === currentPrompt &&
          activeEventIndexRef.current === eventIndex &&
          !questionResolvedRef.current
        ) {
          setActiveEventIndex(eventIndex);
        }
      }, audioTime);
    },
    [getSyncedEventAudioTime, scheduleAtAudioTime]
  );

  const armSyncMissTimer = useCallback(
    (eventIndex: number): void => {
      if (syncMissTimerRef.current !== null) window.clearTimeout(syncMissTimerRef.current);
      const currentPrompt = promptRef.current;
      const anchor = promptStartAudioTimeRef.current;
      if (!syncEnabled || anchor === null || pendingBlockNotesRef.current.size > 0) {
        return;
      }
      const bpm = metronomePreferencesRef.current.bpm;
      const expectedAudioTime = getSyncedEventAudioTime(eventIndex);
      if (expectedAudioTime === undefined) return;
      const deadlineAudioTime = expectedAudioTime + (60 / bpm) * SYNC_MAX_OFFSET_BEATS;
      const delayMs = Math.max(0, (deadlineAudioTime - getMetronomeAudioTime()) * 1000);
      syncMissTimerRef.current = window.setTimeout(() => {
        syncMissTimerRef.current = null;
        if (
          questionResolvedRef.current ||
          isPausedRef.current ||
          isFinishedRef.current ||
          promptRef.current !== currentPrompt ||
          activeEventIndexRef.current !== eventIndex
        ) {
          return;
        }
        setScoreEventResult(eventIndex, "missed");
        resolveQuestion({ correct: false, entered: enteredMidiNotesRef.current, missed: true });
      }, delayMs);
    },
    [
      getMetronomeAudioTime,
      getSyncedEventAudioTime,
      resolveQuestion,
      setScoreEventResult,
      syncEnabled,
    ]
  );

  const setPromptSyncAnchor = useCallback(
    (audioTime: number, bpm: number): void => {
      promptStartAudioTimeRef.current = audioTime;
      promptNeedsSyncAnchorRef.current = false;
      syncTempoAnchorsRef.current = [{ audioTime, beat: 0, bpm }];
      activeEventIndexRef.current = 0;
      arpeggioIndexRef.current = 0;
      setActiveEventIndex(0);
      const nextFeedback = scoreFeedbackRef.current.map((eventsForQuestion) => [
        ...eventsForQuestion,
      ]);
      nextFeedback[activeQuestionIndexRef.current] = [];
      scoreFeedbackRef.current = nextFeedback;
      setScoreFeedbackByQuestion(nextFeedback);
      syncScheduleRevisionRef.current += 1;
      scheduleSyncedEventHighlight(0);
      armSyncMissTimer(0);
    },
    [armSyncMissTimer, scheduleSyncedEventHighlight]
  );

  const getSyncedTimingGrade = useCallback(
    (inputTimestamp: number, currentPrompt: ChordPrompt): PracticeTimingGrade | null => {
      const anchor = promptStartAudioTimeRef.current;
      const index = activeEventIndexRef.current;
      if (!syncEnabled || anchor === null || !currentPrompt.noteEvents[index]) return null;
      const bpm = metronomePreferencesRef.current.bpm;
      const expectedAudioTime = getSyncedEventAudioTime(index);
      if (expectedAudioTime === undefined) return null;
      const inputAudioTime = performanceTimeToAudioTime(inputTimestamp);
      const deltaMs = (inputAudioTime - expectedAudioTime) * 1000;
      const grade = getPracticeTimingGrade(
        deltaMs,
        getPracticeTimingWindowMs(
          bpm,
          chordDurationInBeats(currentPrompt.noteEvents[index]!.duration)
        ),
        getPracticeBeatDurationMs(bpm) * SYNC_MAX_OFFSET_BEATS
      );
      return grade ?? null;
    },
    [getSyncedEventAudioTime, performanceTimeToAudioTime, syncEnabled]
  );

  const acceptSyncedEvent = useCallback(
    (eventIndex: number, grade: PracticeTimingGrade): void => {
      if (syncMissTimerRef.current !== null) {
        window.clearTimeout(syncMissTimerRef.current);
        syncMissTimerRef.current = null;
      }
      setScoreEventResult(eventIndex, grade === "on-time" ? "correct" : grade);
      const nextIndex = eventIndex + 1;
      activeEventIndexRef.current = nextIndex;
      arpeggioIndexRef.current = nextIndex;
      if (nextIndex >= promptRef.current.noteEvents.length) {
        resolveQuestion({ correct: true, entered: enteredMidiNotesRef.current });
      } else {
        scheduleSyncedEventHighlight(nextIndex);
        armSyncMissTimer(nextIndex);
      }
    },
    [armSyncMissTimer, resolveQuestion, scheduleSyncedEventHighlight, setScoreEventResult]
  );

  useEffect(() => {
    if (!syncEnabled) {
      setSyncCountInBeat(null);
      setSyncError(null);
      return undefined;
    }
    if (isPaused || isFinishedRef.current) return undefined;

    let cancelled = false;
    syncSessionRef.current = true;
    syncStartSequenceRef.current = null;
    promptStartAudioTimeRef.current = null;
    promptNeedsSyncAnchorRef.current = true;
    setSyncCountInBeat(4);
    setSyncError(null);
    setMetronomeSyncLocked(true);
    stopMetronome();
    const unsubscribe = subscribeMetronomeBeat((beat) => {
      if (!syncSessionRef.current || cancelled || isPausedRef.current || isFinishedRef.current) {
        return;
      }
      if (syncStartSequenceRef.current === null) {
        syncStartSequenceRef.current = beat.sequence;
        setSyncCountInBeat(4);
        return;
      }
      const countInElapsed = beat.sequence - syncStartSequenceRef.current;
      if (countInElapsed < 4) {
        setSyncCountInBeat(Math.max(1, 4 - countInElapsed));
        return;
      }
      if (countInElapsed === 4) setSyncCountInBeat(null);
      if (promptNeedsSyncAnchorRef.current) {
        setPromptSyncAnchor(beat.audioTime, beat.bpm);
        return;
      }
      if (appendSyncTempoAnchor(beat.audioTime, beat.bpm) === undefined) return;
      if (pendingBlockNotesRef.current.size === 0) {
        const eventIndex = activeEventIndexRef.current;
        scheduleSyncedEventHighlight(eventIndex);
        armSyncMissTimer(eventIndex);
      }
    });

    void startMetronome({ initialBeatIndex: 0 }).then((started) => {
      if (cancelled || started) return;
      syncSessionRef.current = false;
      setMetronomeSyncLocked(false);
      setSyncCountInBeat(null);
      setSyncError("木鱼节拍器无法启动，请重试。");
    });

    return () => {
      cancelled = true;
      unsubscribe();
      if (syncMissTimerRef.current !== null) {
        window.clearTimeout(syncMissTimerRef.current);
        syncMissTimerRef.current = null;
      }
      syncSessionRef.current = false;
      stopMetronome();
      setMetronomeSyncLocked(false);
      setSyncCountInBeat(null);
      syncScheduleRevisionRef.current += 1;
    };
  }, [
    appendSyncTempoAnchor,
    armSyncMissTimer,
    isPaused,
    scheduleSyncedEventHighlight,
    setMetronomeSyncLocked,
    startMetronome,
    stopMetronome,
    subscribeMetronomeBeat,
    syncEnabled,
    setPromptSyncAnchor,
  ]);

  useEffect(() => {
    if (!syncEnabled || !syncSessionRef.current || promptStartAudioTimeRef.current === null) {
      return;
    }
    if (appendSyncTempoAnchor(getMetronomeAudioTime(), metronomePreferences.bpm) === undefined) {
      return;
    }
    const eventIndex = activeEventIndexRef.current;
    scheduleSyncedEventHighlight(eventIndex);
    armSyncMissTimer(eventIndex);
  }, [
    appendSyncTempoAnchor,
    armSyncMissTimer,
    getMetronomeAudioTime,
    metronomePreferences.bpm,
    scheduleSyncedEventHighlight,
    syncEnabled,
  ]);

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
      if (syncEnabled) {
        const currentPrompt = promptRef.current;
        const eventIndex = activeEventIndexRef.current;
        const expectedEvent = currentPrompt.noteEvents[eventIndex];
        if (!expectedEvent || promptStartAudioTimeRef.current === null) return;
        const timingGrade = getSyncedTimingGrade(
          typeof event.note.timestamp === "number" ? event.note.timestamp : performance.now(),
          currentPrompt
        );
        if (!timingGrade) return;

        const nextEntered = [...enteredMidiNotesRef.current, note];
        enteredMidiNotesRef.current = nextEntered;
        if (expectedEvent.notes.length > 1) {
          if (pendingBlockNotesRef.current.size === 0) {
            blockTimingGradeRef.current = timingGrade;
            if (syncMissTimerRef.current !== null) {
              window.clearTimeout(syncMissTimerRef.current);
              syncMissTimerRef.current = null;
            }
          }
          pendingBlockNotesRef.current.add(note);
          if (blockTimerRef.current === null) {
            blockTimerRef.current = window.setTimeout(() => {
              blockTimerRef.current = null;
              const enteredBlock = [...pendingBlockNotesRef.current];
              pendingBlockNotesRef.current.clear();
              const isBlockCorrect = chordNotesMatch(
                expectedEvent.notes.map(({ midi }) => midi),
                enteredBlock
              );
              const firstTimingGrade = blockTimingGradeRef.current ?? timingGrade;
              blockTimingGradeRef.current = null;
              if (!isBlockCorrect) {
                setScoreEventResult(eventIndex, "wrong");
                resolveQuestion({ correct: false, entered: enteredMidiNotesRef.current });
                return;
              }
              acceptSyncedEvent(eventIndex, firstTimingGrade);
            }, CHORD_INPUT_WINDOW_MS);
          }
          return;
        }

        if (expectedEvent.notes[0]?.midi !== note) {
          setScoreEventResult(eventIndex, "wrong");
          resolveQuestion({ correct: false, entered: nextEntered });
          return;
        }
        acceptSyncedEvent(eventIndex, timingGrade);
        return;
      }

      if (config.task === "block") {
        pendingBlockNotesRef.current.add(note);
        if (blockTimerRef.current === null) {
          blockTimerRef.current = window.setTimeout(() => {
            blockTimerRef.current = null;
            const entered = [...pendingBlockNotesRef.current];
            const correct = chordNotesMatch(getChordPromptMidiNotes(promptRef.current), entered);
            setScoreEventResult(0, correct ? "correct" : "wrong");
            resolveQuestion({
              correct,
              entered,
            });
          }, CHORD_INPUT_WINDOW_MS);
        }
        return;
      }

      const currentPrompt = promptRef.current;
      const expectedEvent = currentPrompt.noteEvents[arpeggioIndexRef.current];
      if (!expectedEvent) return;
      const nextEntered = [...enteredMidiNotesRef.current, note];
      enteredMidiNotesRef.current = nextEntered;

      if (expectedEvent.notes.length > 1) {
        pendingBlockNotesRef.current.add(note);
        if (blockTimerRef.current === null) {
          blockTimerRef.current = window.setTimeout(() => {
            blockTimerRef.current = null;
            const enteredBlock = [...pendingBlockNotesRef.current];
            pendingBlockNotesRef.current.clear();
            const isBlockCorrect = chordNotesMatch(
              expectedEvent.notes.map(({ midi }) => midi),
              enteredBlock
            );
            if (!isBlockCorrect) {
              setScoreEventResult(arpeggioIndexRef.current, "wrong");
              resolveQuestion({ correct: false, entered: enteredMidiNotesRef.current });
              return;
            }
            setScoreEventResult(arpeggioIndexRef.current, "correct");
            const nextIndex = arpeggioIndexRef.current + 1;
            arpeggioIndexRef.current = nextIndex;
            activeEventIndexRef.current = nextIndex;
            setActiveEventIndex(nextIndex);
            if (nextIndex === currentPrompt.noteEvents.length) {
              resolveQuestion({ correct: true, entered: enteredMidiNotesRef.current });
            }
          }, CHORD_INPUT_WINDOW_MS);
        }
        return;
      }

      if (expectedEvent.notes[0]?.midi !== note) {
        setScoreEventResult(arpeggioIndexRef.current, "wrong");
        resolveQuestion({ correct: false, entered: nextEntered });
        return;
      }
      setScoreEventResult(arpeggioIndexRef.current, "correct");
      const nextIndex = arpeggioIndexRef.current + 1;
      arpeggioIndexRef.current = nextIndex;
      activeEventIndexRef.current = nextIndex;
      setActiveEventIndex(nextIndex);
      if (nextIndex === currentPrompt.noteEvents.length) {
        resolveQuestion({ correct: true, entered: nextEntered });
      }
    });
    return () => unsubscribe();
  }, [
    acceptSyncedEvent,
    config.task,
    getSyncedTimingGrade,
    isPaused,
    midi,
    resolveQuestion,
    setScoreEventResult,
    syncEnabled,
  ]);

  const togglePause = useCallback((): void => {
    if (isFinishedRef.current) return;
    if (isPausedRef.current) {
      startedAtRef.current = performance.now();
      isPausedRef.current = false;
      setIsPaused(false);
      onPauseChangeRef.current(false);
      if (feedback?.correct || (config.task !== "recognize" && questionResolvedRef.current)) {
        scheduleAdvance();
      }
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
    if (syncMissTimerRef.current !== null) {
      window.clearTimeout(syncMissTimerRef.current);
      syncMissTimerRef.current = null;
    }
    if (syncEnabled) {
      promptStartAudioTimeRef.current = null;
      syncTempoAnchorsRef.current = [];
      syncScheduleRevisionRef.current += 1;
      promptNeedsSyncAnchorRef.current = true;
      stopMetronome();
      setMetronomeSyncLocked(false);
    }
    arpeggioIndexRef.current = 0;
    if (blockTimerRef.current !== null) {
      window.clearTimeout(blockTimerRef.current);
      blockTimerRef.current = null;
    }
    enteredMidiNotesRef.current = [];
    setIsPaused(true);
    onPauseChangeRef.current(true);
  }, [
    feedback?.correct,
    config.task,
    measureElapsed,
    scheduleAdvance,
    setMetronomeSyncLocked,
    stopMetronome,
    syncEnabled,
  ]);

  useEffect(() => {
    if (!syncEnabled) {
      onMetronomeSyncToggleChangeRef.current?.(undefined);
      onMetronomeSyncPauseChangeRef.current?.(undefined);
      return undefined;
    }
    const toggleSynchronizedPractice = (): void => togglePause();
    const pauseSynchronizedPractice = (): void => {
      if (!isPausedRef.current) togglePause();
    };
    onMetronomeSyncToggleChangeRef.current?.(toggleSynchronizedPractice);
    onMetronomeSyncPauseChangeRef.current?.(pauseSynchronizedPractice);
    return () => {
      onMetronomeSyncToggleChangeRef.current?.(undefined);
      onMetronomeSyncPauseChangeRef.current?.(undefined);
    };
  }, [syncEnabled, togglePause]);

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
    <PracticeSessionFrame
      aria-label="和弦训练练习"
      className={`chord-training-run${config.task !== "recognize" ? " is-score-performance-run" : ""}`}
    >
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
        progressInline
        title={<span id="chord-training-run-title">和弦训练</span>}
        utilityChildren={
          config.task !== "recognize" ? (
            <MidiInputControl
              ariaLabel="和弦训练 MIDI 输入设备"
              className={!midi.isConnected ? "needs-attention" : undefined}
              midi={midi}
            />
          ) : null
        }
      >
        <PracticeFullscreenToggle />
      </PracticeSessionHeader>

      {config.task !== "recognize" ? (
        <div className="practice-metronome-sync-status chord-training-sync-status" role="status">
          {syncEnabled && syncCountInBeat !== null ? (
            <strong>准备拍 {syncCountInBeat}</strong>
          ) : null}
          <strong>{metronomePreferences.bpm} BPM</strong>
          <span className="practice-metronome-sync-legend" aria-label="谱面颜色说明">
            <span className="is-root">蓝色：根音</span>
            <span className="is-error">红色：错音或漏拍</span>
            {syncEnabled ? <span className="is-warning">黄色：时机偏早或偏晚</span> : null}
          </span>
          {syncError ? <span className="chord-training-sync-error">{syncError}</span> : null}
        </div>
      ) : null}

      <div
        className={
          config.task === "recognize"
            ? "chord-training-prompt-panel"
            : "chord-training-prompt-panel is-score-performance"
        }
      >
        {config.task === "recognize" ? (
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
        ) : null}
        {config.task === "recognize" ? (
          <ChordStaffPrompt
            activeEventIndex={activeEventIndex}
            eventFeedback={scoreFeedbackByQuestion[activeQuestionIndex] ?? []}
            highlightRoot={config.highlightRoot}
            prompt={prompt}
          />
        ) : (
          <ChordStaffPage
            activeEventIndex={activeEventIndex}
            activeQuestionIndex={activeQuestionIndex}
            eventFeedbackByQuestion={scoreFeedbackByQuestion}
            highlightRoot={config.highlightRoot}
            prompts={promptSequence}
          />
        )}

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
        ) : null}

        {config.task === "recognize" && feedback ? (
          <div
            aria-live="polite"
            className={`chord-training-feedback${feedback ? (feedback.correct ? " is-correct" : " is-wrong") : ""}`}
          >
            <strong>{feedback.correct ? "正确" : `正确答案：${feedback.expectedName}`}</strong>
          </div>
        ) : null}
        {config.task === "recognize" && !feedback?.correct ? (
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
                recognitionAnswer: {
                  ...(selectedRootName ? { rootName: selectedRootName } : {}),
                  ...(selectedQuality ? { quality: selectedQuality } : {}),
                  ...(selectedInversion !== null ? { inversion: selectedInversion } : {}),
                },
              });
            }}
            type="button"
          >
            <SkipForward aria-hidden="true" size={16} />
            {feedback || rootFeedback ? "下一题" : "跳过本题"}
          </button>
        ) : null}
      </div>

      {isPaused ? <PauseOverlay onResume={togglePause} showKeyboardShortcuts={false} /> : null}
    </PracticeSessionFrame>
  );
}
