import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import type { AnswerAttempt, PianoKeyName, StaffGameChallengeMode } from "../../../domain/types";
import { STAFF_GAME_SONGS } from "../data/staffGameSongs";
import {
  drawNextNote,
  takeNextLearningTestNote,
  drawNextWrongNoteReviewNote,
  gameNoteFromMidi,
  randomBubbleCenterX,
  type StaffGameNotePoolScope,
  type StaffGameNoteSchedulingStrategy,
  type StaffGamePitch,
} from "../logic/staffGameRules";
import type { StaffGameSoundName } from "./useStaffGameAudio";

const MIN_LEVEL_TARGET_RESPONSE_WINDOW_MS = 2_000;

export interface StaffGameTarget {
  midi: number;
  name: PianoKeyName;
  octave: number;
  token: number;
  centerX: number;
  spawnAt: number;
}

export interface StaffGameRoundNoteOutcome {
  token: number;
  midi: number;
  note: string;
  firstInputCorrect: boolean | null;
  missed: boolean;
  resolved?: boolean;
  wasInterrupted?: boolean;
  /** Wall-clock time of the most recent wrong input or bubble expiry. */
  errorAt?: number;
  /** Positive milliseconds from fade-in completion to the first input, when that input is correct. */
  responseMs?: number;
  /** Time to the first correct input, kept separate from the first-try scoring field. */
  proficiencyResponseMs?: number;
  correctConfidence?: number;
  correctClipping?: boolean;
  attempts?: AnswerAttempt[];
}

export interface StaffGameLevelRoundMetrics {
  generatedBubbleCount: number;
  resolvedQuestionCount: number;
  targetQuestionCount: number;
  firstTryCorrectCount: number;
  correctBubbleCount: number;
  responseTotalMs: number;
  responseSampleCount: number;
  firstInputByToken: Map<number, StaffGameRoundNoteOutcome>;
  pendingLateInputMidi: number | null;
  lateInputShield: { targetToken: number; midi: number } | null;
}

type StaffGameMode = "levels" | "songs";
type StaffGamePhase = "ready" | "running" | "paused" | "summary";
type StaffGameInputMode = "physical" | "virtual" | "midi";
type StaffGameRoundPurpose = "level" | "wrong-note-review";

interface StaffGameRoundClockOptions {
  phase: StaffGamePhase;
  inputMode: StaffGameInputMode;
  gameDurationMs: number;
  activeBubbleDurationMs: number;
  levelRef: MutableRefObject<number>;
  phaseRef: MutableRefObject<StaffGamePhase>;
  gameModeRef: MutableRefObject<StaffGameMode>;
  challengeModeRef: MutableRefObject<StaffGameChallengeMode>;
  roundPurposeRef: MutableRefObject<StaffGameRoundPurpose>;
  selectedSongIdRef: MutableRefObject<string>;
  songTargetIndexRef: MutableRefObject<number>;
  songWrongTargetTokenRef: MutableRefObject<number | null>;
  noteBagRef: MutableRefObject<StaffGamePitch[]>;
  notePoolScopeRef: MutableRefObject<StaffGameNotePoolScope>;
  noteSchedulingStrategyRef: MutableRefObject<StaffGameNoteSchedulingStrategy>;
  recentNoteMidisRef: MutableRefObject<number[]>;
  targetTokenRef: MutableRefObject<number>;
  roundMetricsRef: MutableRefObject<StaffGameLevelRoundMetrics>;
  wrongNoteReviewDurationMsRef: MutableRefObject<number>;
  elapsedBeforeRunRef: MutableRefObject<number>;
  runSegmentStartedAtRef: MutableRefObject<number>;
  targetRef: MutableRefObject<StaffGameTarget | null>;
  targetPoppedRef: MutableRefObject<boolean>;
  nextTargetTimeoutRef: MutableRefObject<number | null>;
  waitingForNextTargetRef: MutableRefObject<boolean>;
  playfieldRef: RefObject<HTMLDivElement | null>;
  getPromptSuppressionWindow: () => {
    endAtMs: number;
    midiNotes: ReadonlySet<number>;
  } | null;
  setTarget: Dispatch<SetStateAction<StaffGameTarget | null>>;
  setTargetPopped: Dispatch<SetStateAction<boolean>>;
  setTargetWrong: Dispatch<SetStateAction<boolean>>;
  setElapsedMs: Dispatch<SetStateAction<number>>;
  setSongNotesCompleted: Dispatch<SetStateAction<number>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  finishRound: () => void;
  setWrongNoteReviewTimedOut: Dispatch<SetStateAction<boolean>>;
  resetComboDisplay: () => void;
  triggerMascotReaction: (action: "cheer" | "sad") => void;
  playGameSound: (sound: StaffGameSoundName) => void;
  noteLabel: (note: StaffGameTarget) => string;
}

export function useStaffGameRoundClock({
  phase,
  inputMode,
  gameDurationMs,
  activeBubbleDurationMs,
  levelRef,
  phaseRef,
  gameModeRef,
  challengeModeRef,
  roundPurposeRef,
  selectedSongIdRef,
  songTargetIndexRef,
  songWrongTargetTokenRef,
  noteBagRef,
  notePoolScopeRef,
  noteSchedulingStrategyRef,
  recentNoteMidisRef,
  targetTokenRef,
  roundMetricsRef,
  wrongNoteReviewDurationMsRef,
  elapsedBeforeRunRef,
  runSegmentStartedAtRef,
  targetRef,
  targetPoppedRef,
  nextTargetTimeoutRef,
  waitingForNextTargetRef,
  playfieldRef,
  getPromptSuppressionWindow,
  setTarget,
  setTargetPopped,
  setTargetWrong,
  setElapsedMs,
  setSongNotesCompleted,
  setFeedback,
  finishRound,
  setWrongNoteReviewTimedOut,
  resetComboDisplay,
  triggerMascotReaction,
  playGameSound,
  noteLabel,
}: StaffGameRoundClockOptions) {
  const spawnTargetRef = useRef<(atGameMs: number) => void>(() => undefined);
  const spawnTarget = useCallback(
    (atGameMs: number): void => {
      if (phaseRef.current !== "running") return;
      // Do not introduce a new target when the timer cannot leave a fair response window.
      if (
        gameModeRef.current === "levels" &&
        roundPurposeRef.current !== "wrong-note-review" &&
        challengeModeRef.current === "arcade" &&
        gameDurationMs - atGameMs < MIN_LEVEL_TARGET_RESPONSE_WINDOW_MS
      ) {
        return;
      }
      const promptSuppressionWindow =
        inputMode === "physical" && gameModeRef.current === "levels"
          ? getPromptSuppressionWindow()
          : null;
      const temporarilyExcludedMidiNotes = promptSuppressionWindow?.midiNotes ?? new Set<number>();
      const drawnNote =
        gameModeRef.current === "songs"
          ? (() => {
              const song = STAFF_GAME_SONGS.find((item) => item.id === selectedSongIdRef.current);
              const midi = song?.noteMidis[songTargetIndexRef.current];
              return midi === undefined ? null : gameNoteFromMidi(midi);
            })()
          : roundPurposeRef.current === "wrong-note-review"
            ? drawNextWrongNoteReviewNote(
                noteBagRef.current,
                recentNoteMidisRef.current,
                temporarilyExcludedMidiNotes
              )
            : challengeModeRef.current === "learning"
              ? takeNextLearningTestNote(noteBagRef.current, temporarilyExcludedMidiNotes)
              : drawNextNote(
                  levelRef.current,
                  noteBagRef.current,
                  recentNoteMidisRef.current,
                  notePoolScopeRef.current,
                  noteSchedulingStrategyRef.current,
                  temporarilyExcludedMidiNotes
                );
      if (!drawnNote) {
        if (promptSuppressionWindow && noteBagRef.current.length > 0) {
          waitingForNextTargetRef.current = true;
          if (nextTargetTimeoutRef.current !== null) {
            window.clearTimeout(nextTargetTimeoutRef.current);
          }
          nextTargetTimeoutRef.current = window.setTimeout(
            () => {
              nextTargetTimeoutRef.current = null;
              if (phaseRef.current !== "running") {
                waitingForNextTargetRef.current = true;
                return;
              }
              waitingForNextTargetRef.current = false;
              const nextGameTime =
                elapsedBeforeRunRef.current + (performance.now() - runSegmentStartedAtRef.current);
              spawnTargetRef.current(nextGameTime);
            },
            Math.max(0, promptSuppressionWindow.endAtMs - performance.now()) + 16
          );
          return;
        }
        if (gameModeRef.current === "levels" && roundPurposeRef.current === "wrong-note-review") {
          finishRound();
        } else if (
          gameModeRef.current === "levels" &&
          roundPurposeRef.current === "level" &&
          challengeModeRef.current === "learning"
        ) {
          finishRound();
        }
        return;
      }
      targetTokenRef.current += 1;
      const next = {
        ...drawnNote,
        token: targetTokenRef.current,
        centerX: randomBubbleCenterX(playfieldRef.current),
        spawnAt: atGameMs,
      };
      const pendingLateInputMidi = roundMetricsRef.current.pendingLateInputMidi;
      roundMetricsRef.current.lateInputShield =
        pendingLateInputMidi === null
          ? null
          : { targetToken: next.token, midi: pendingLateInputMidi };
      roundMetricsRef.current.pendingLateInputMidi = null;
      roundMetricsRef.current.firstInputByToken.set(next.token, {
        token: next.token,
        midi: next.midi,
        note: noteLabel(next),
        firstInputCorrect: null,
        missed: false,
        attempts: [],
      });
      if (gameModeRef.current === "levels") {
        roundMetricsRef.current.generatedBubbleCount += 1;
        recentNoteMidisRef.current = [...recentNoteMidisRef.current, next.midi].slice(-3);
      }
      targetRef.current = next;
      targetPoppedRef.current = false;
      setTarget(next);
      setTargetPopped(false);
      setTargetWrong(false);
    },
    [
      gameDurationMs,
      gameModeRef,
      challengeModeRef,
      getPromptSuppressionWindow,
      inputMode,
      roundPurposeRef,
      levelRef,
      noteBagRef,
      phaseRef,
      playfieldRef,
      notePoolScopeRef,
      noteSchedulingStrategyRef,
      noteLabel,
      recentNoteMidisRef,
      roundMetricsRef,
      runSegmentStartedAtRef,
      elapsedBeforeRunRef,
      waitingForNextTargetRef,
      nextTargetTimeoutRef,
      selectedSongIdRef,
      setTarget,
      setTargetPopped,
      setTargetWrong,
      songTargetIndexRef,
      targetPoppedRef,
      targetRef,
      targetTokenRef,
      finishRound,
    ]
  );
  spawnTargetRef.current = spawnTarget;

  useEffect(() => {
    if (phase !== "running") return undefined;
    let frame = 0;
    let lastUiUpdateAt = 0;
    const tick = (now: number): void => {
      const gameTime = elapsedBeforeRunRef.current + now - runSegmentStartedAtRef.current;
      if (now - lastUiUpdateAt >= 100) {
        lastUiUpdateAt = now;
        setElapsedMs(
          gameModeRef.current === "songs" ||
            roundPurposeRef.current === "wrong-note-review" ||
            challengeModeRef.current === "learning"
            ? gameTime
            : Math.min(gameDurationMs, gameTime)
        );
      }
      if (
        gameModeRef.current === "levels" &&
        roundPurposeRef.current !== "wrong-note-review" &&
        challengeModeRef.current === "arcade" &&
        gameTime >= gameDurationMs
      ) {
        setElapsedMs(gameDurationMs);
        finishRound();
        return;
      }
      if (
        gameModeRef.current === "levels" &&
        roundPurposeRef.current === "wrong-note-review" &&
        wrongNoteReviewDurationMsRef.current > 0 &&
        gameTime >= wrongNoteReviewDurationMsRef.current
      ) {
        setElapsedMs(wrongNoteReviewDurationMsRef.current);
        setWrongNoteReviewTimedOut(true);
        const activeTarget = targetRef.current;
        if (activeTarget && !targetPoppedRef.current) {
          const outcome = roundMetricsRef.current.firstInputByToken.get(activeTarget.token);
          if (outcome && outcome.firstInputCorrect === null && !outcome.missed) {
            const attempts = outcome.attempts ?? [];
            if (attempts.length > 0 && attempts.every((attempt) => attempt.isLateForPrevious)) {
              outcome.wasInterrupted = true;
            } else {
              roundMetricsRef.current.firstInputByToken.delete(activeTarget.token);
            }
          }
        }
        finishRound();
        return;
      }
      if (
        targetRef.current &&
        !targetPoppedRef.current &&
        gameTime - targetRef.current.spawnAt >= activeBubbleDurationMs
      ) {
        const missedTarget = targetRef.current;
        targetRef.current = null;
        if (missedTarget) {
          roundMetricsRef.current.pendingLateInputMidi = missedTarget.midi;
          roundMetricsRef.current.lateInputShield = null;
          const outcome = roundMetricsRef.current.firstInputByToken.get(missedTarget.token);
          if (outcome) {
            outcome.missed = true;
            if (!outcome.resolved) {
              outcome.resolved = true;
              roundMetricsRef.current.resolvedQuestionCount += 1;
            }
            outcome.errorAt = Date.now();
          }
        }
        setTarget(null);
        if (missedTarget) triggerMascotReaction("sad");
        playGameSound(inputMode === "physical" ? "noteMissedUnpitched" : "noteMissed");
        resetComboDisplay();
        const isSongMode = gameModeRef.current === "songs";
        const activeSong = isSongMode
          ? STAFF_GAME_SONGS.find((item) => item.id === selectedSongIdRef.current)
          : undefined;
        if (isSongMode && activeSong && missedTarget) {
          songTargetIndexRef.current += 1;
          setSongNotesCompleted(songTargetIndexRef.current);
          songWrongTargetTokenRef.current = null;
          setFeedback(`漏掉 ${noteLabel(missedTarget)} · 继续下一音`);
        } else {
          setFeedback("气泡飘走了，连击中断");
        }
        if (nextTargetTimeoutRef.current !== null)
          window.clearTimeout(nextTargetTimeoutRef.current);
        nextTargetTimeoutRef.current = window.setTimeout(() => {
          nextTargetTimeoutRef.current = null;
          if (phaseRef.current !== "running") {
            waitingForNextTargetRef.current = true;
            return;
          }
          if (
            isSongMode &&
            activeSong &&
            songTargetIndexRef.current >= activeSong.noteMidis.length
          ) {
            finishRound();
            return;
          }
          const nextGameTime =
            elapsedBeforeRunRef.current + (performance.now() - runSegmentStartedAtRef.current);
          spawnTarget(nextGameTime);
        }, 180);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeBubbleDurationMs,
    elapsedBeforeRunRef,
    finishRound,
    gameDurationMs,
    gameModeRef,
    challengeModeRef,
    inputMode,
    nextTargetTimeoutRef,
    noteLabel,
    phase,
    phaseRef,
    playGameSound,
    roundPurposeRef,
    resetComboDisplay,
    roundMetricsRef,
    wrongNoteReviewDurationMsRef,
    runSegmentStartedAtRef,
    selectedSongIdRef,
    setElapsedMs,
    setFeedback,
    setSongNotesCompleted,
    setTarget,
    songTargetIndexRef,
    songWrongTargetTokenRef,
    spawnTarget,
    targetPoppedRef,
    targetRef,
    triggerMascotReaction,
    waitingForNextTargetRef,
    setWrongNoteReviewTimedOut,
  ]);

  const startRunSegment = useCallback((): void => {
    runSegmentStartedAtRef.current = performance.now();
  }, [runSegmentStartedAtRef]);

  const pauseRunSegment = useCallback((): number => {
    const pausedAt = performance.now();
    const elapsedAtPause = elapsedBeforeRunRef.current + pausedAt - runSegmentStartedAtRef.current;
    elapsedBeforeRunRef.current =
      gameModeRef.current === "songs" ||
      roundPurposeRef.current === "wrong-note-review" ||
      challengeModeRef.current === "learning"
        ? elapsedAtPause
        : Math.min(gameDurationMs, elapsedAtPause);
    return elapsedBeforeRunRef.current;
  }, [
    challengeModeRef,
    elapsedBeforeRunRef,
    gameDurationMs,
    gameModeRef,
    roundPurposeRef,
    runSegmentStartedAtRef,
  ]);

  return { pauseRunSegment, spawnTarget, startRunSegment };
}
