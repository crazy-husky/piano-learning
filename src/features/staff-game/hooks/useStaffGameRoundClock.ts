import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import type { PianoKeyName } from "../../../domain/types";
import { STAFF_GAME_SONGS } from "../data/staffGameSongs";
import {
  drawNextNote,
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
}

export interface StaffGameLevelRoundMetrics {
  generatedBubbleCount: number;
  firstTryCorrectCount: number;
  correctBubbleCount: number;
  responseTotalMs: number;
  responseSampleCount: number;
  firstInputByToken: Map<number, StaffGameRoundNoteOutcome>;
}

type StaffGameMode = "levels" | "songs";
type StaffGamePhase = "ready" | "running" | "paused" | "summary";
type StaffGameInputMode = "physical" | "virtual" | "midi";

interface StaffGameRoundClockOptions {
  phase: StaffGamePhase;
  inputMode: StaffGameInputMode;
  gameDurationMs: number;
  activeBubbleDurationMs: number;
  levelRef: MutableRefObject<number>;
  phaseRef: MutableRefObject<StaffGamePhase>;
  gameModeRef: MutableRefObject<StaffGameMode>;
  selectedSongIdRef: MutableRefObject<string>;
  songTargetIndexRef: MutableRefObject<number>;
  songWrongTargetTokenRef: MutableRefObject<number | null>;
  noteBagRef: MutableRefObject<StaffGamePitch[]>;
  notePoolScopeRef: MutableRefObject<StaffGameNotePoolScope>;
  noteSchedulingStrategyRef: MutableRefObject<StaffGameNoteSchedulingStrategy>;
  weakNoteWeightsRef: MutableRefObject<Map<number, number>>;
  wrongNotePracticeWeightsRef: MutableRefObject<Map<number, number> | null>;
  recentNoteMidisRef: MutableRefObject<number[]>;
  targetTokenRef: MutableRefObject<number>;
  roundMetricsRef: MutableRefObject<StaffGameLevelRoundMetrics>;
  elapsedBeforeRunRef: MutableRefObject<number>;
  runSegmentStartedAtRef: MutableRefObject<number>;
  targetRef: MutableRefObject<StaffGameTarget | null>;
  targetPoppedRef: MutableRefObject<boolean>;
  nextTargetTimeoutRef: MutableRefObject<number | null>;
  waitingForNextTargetRef: MutableRefObject<boolean>;
  playfieldRef: RefObject<HTMLDivElement | null>;
  setTarget: Dispatch<SetStateAction<StaffGameTarget | null>>;
  setTargetPopped: Dispatch<SetStateAction<boolean>>;
  setTargetWrong: Dispatch<SetStateAction<boolean>>;
  setElapsedMs: Dispatch<SetStateAction<number>>;
  setSongNotesCompleted: Dispatch<SetStateAction<number>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  finishRound: () => void;
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
  selectedSongIdRef,
  songTargetIndexRef,
  songWrongTargetTokenRef,
  noteBagRef,
  notePoolScopeRef,
  noteSchedulingStrategyRef,
  weakNoteWeightsRef,
  wrongNotePracticeWeightsRef,
  recentNoteMidisRef,
  targetTokenRef,
  roundMetricsRef,
  elapsedBeforeRunRef,
  runSegmentStartedAtRef,
  targetRef,
  targetPoppedRef,
  nextTargetTimeoutRef,
  waitingForNextTargetRef,
  playfieldRef,
  setTarget,
  setTargetPopped,
  setTargetWrong,
  setElapsedMs,
  setSongNotesCompleted,
  setFeedback,
  finishRound,
  resetComboDisplay,
  triggerMascotReaction,
  playGameSound,
  noteLabel,
}: StaffGameRoundClockOptions) {
  const spawnTarget = useCallback(
    (atGameMs: number): void => {
      if (phaseRef.current !== "running") return;
      // Do not introduce a new target when the timer cannot leave a fair response window.
      if (
        gameModeRef.current === "levels" &&
        gameDurationMs - atGameMs < MIN_LEVEL_TARGET_RESPONSE_WINDOW_MS
      ) {
        return;
      }
      const drawnNote =
        gameModeRef.current === "songs"
          ? (() => {
              const song = STAFF_GAME_SONGS.find((item) => item.id === selectedSongIdRef.current);
              const midi = song?.noteMidis[songTargetIndexRef.current];
              return midi === undefined ? null : gameNoteFromMidi(midi);
            })()
          : drawNextNote(
              levelRef.current,
              noteBagRef.current,
              recentNoteMidisRef.current,
              notePoolScopeRef.current,
              noteSchedulingStrategyRef.current,
              weakNoteWeightsRef.current,
              wrongNotePracticeWeightsRef.current ?? undefined
            );
      if (!drawnNote) return;
      targetTokenRef.current += 1;
      const next = {
        ...drawnNote,
        token: targetTokenRef.current,
        centerX: randomBubbleCenterX(playfieldRef.current),
        spawnAt: atGameMs,
      };
      roundMetricsRef.current.firstInputByToken.set(next.token, {
        token: next.token,
        midi: next.midi,
        note: noteLabel(next),
        firstInputCorrect: null,
        missed: false,
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
      levelRef,
      noteBagRef,
      phaseRef,
      playfieldRef,
      notePoolScopeRef,
      noteSchedulingStrategyRef,
      noteLabel,
      weakNoteWeightsRef,
      wrongNotePracticeWeightsRef,
      recentNoteMidisRef,
      roundMetricsRef,
      selectedSongIdRef,
      setTarget,
      setTargetPopped,
      setTargetWrong,
      songTargetIndexRef,
      targetPoppedRef,
      targetRef,
      targetTokenRef,
    ]
  );

  useEffect(() => {
    if (phase !== "running") return undefined;
    let frame = 0;
    let lastUiUpdateAt = 0;
    const tick = (now: number): void => {
      const gameTime = elapsedBeforeRunRef.current + now - runSegmentStartedAtRef.current;
      if (now - lastUiUpdateAt >= 100) {
        lastUiUpdateAt = now;
        setElapsedMs(
          gameModeRef.current === "songs" ? gameTime : Math.min(gameDurationMs, gameTime)
        );
      }
      if (gameModeRef.current === "levels" && gameTime >= gameDurationMs) {
        setElapsedMs(gameDurationMs);
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
          const outcome = roundMetricsRef.current.firstInputByToken.get(missedTarget.token);
          if (outcome) outcome.missed = true;
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
    inputMode,
    nextTargetTimeoutRef,
    noteLabel,
    phase,
    phaseRef,
    playGameSound,
    resetComboDisplay,
    roundMetricsRef,
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
  ]);

  const startRunSegment = useCallback((): void => {
    runSegmentStartedAtRef.current = performance.now();
  }, [runSegmentStartedAtRef]);

  const pauseRunSegment = useCallback((): number => {
    const pausedAt = performance.now();
    const elapsedAtPause = elapsedBeforeRunRef.current + pausedAt - runSegmentStartedAtRef.current;
    elapsedBeforeRunRef.current =
      gameModeRef.current === "songs" ? elapsedAtPause : Math.min(gameDurationMs, elapsedAtPause);
    return elapsedBeforeRunRef.current;
  }, [elapsedBeforeRunRef, gameDurationMs, gameModeRef, runSegmentStartedAtRef]);

  return { pauseRunSegment, spawnTarget, startRunSegment };
}
