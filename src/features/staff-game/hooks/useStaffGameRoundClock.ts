import { useCallback, useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { PianoKeyName } from "../../../domain/types";
import { STAFF_GAME_SONGS } from "../data/staffGameSongs";
import {
  drawNextNote,
  gameNoteFromMidi,
  randomBubbleCenterX,
  type StaffGamePitch,
} from "../logic/staffGameRules";
import type { StaffGameSoundName } from "./useStaffGameAudio";

export interface StaffGameTarget {
  midi: number;
  name: PianoKeyName;
  octave: number;
  token: number;
  centerX: number;
}

type StaffGameMode = "levels" | "songs";
type StaffGamePhase = "ready" | "running" | "paused" | "summary";

interface StaffGameRoundClockOptions {
  phase: StaffGamePhase;
  gameDurationMs: number;
  activeBubbleDurationMs: number;
  levelRef: MutableRefObject<number>;
  phaseRef: MutableRefObject<StaffGamePhase>;
  gameModeRef: MutableRefObject<StaffGameMode>;
  selectedSongIdRef: MutableRefObject<string>;
  songTargetIndexRef: MutableRefObject<number>;
  songWrongTargetTokenRef: MutableRefObject<number | null>;
  noteBagRef: MutableRefObject<StaffGamePitch[]>;
  recentNoteMidisRef: MutableRefObject<number[]>;
  targetTokenRef: MutableRefObject<number>;
  targetSpawnGameMsRef: MutableRefObject<number>;
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
  gameDurationMs,
  activeBubbleDurationMs,
  levelRef,
  phaseRef,
  gameModeRef,
  selectedSongIdRef,
  songTargetIndexRef,
  songWrongTargetTokenRef,
  noteBagRef,
  recentNoteMidisRef,
  targetTokenRef,
  targetSpawnGameMsRef,
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
  const spawnTarget = useCallback((atGameMs: number): void => {
    if (phaseRef.current !== "running") return;
    const drawnNote = gameModeRef.current === "songs"
      ? (() => {
        const song = STAFF_GAME_SONGS.find((item) => item.id === selectedSongIdRef.current);
        const midi = song?.noteMidis[songTargetIndexRef.current];
        return midi === undefined ? null : gameNoteFromMidi(midi);
      })()
      : drawNextNote(levelRef.current, noteBagRef.current, recentNoteMidisRef.current);
    if (!drawnNote) return;
    targetTokenRef.current += 1;
    const next = {
      ...drawnNote,
      token: targetTokenRef.current,
      centerX: randomBubbleCenterX(playfieldRef.current),
    };
    if (gameModeRef.current === "levels") {
      recentNoteMidisRef.current = [...recentNoteMidisRef.current, next.midi].slice(-3);
    }
    targetSpawnGameMsRef.current = atGameMs;
    targetRef.current = next;
    targetPoppedRef.current = false;
    setTarget(next);
    setTargetPopped(false);
    setTargetWrong(false);
  }, []);

  useEffect(() => {
    if (phase !== "running") return undefined;
    let frame = 0;
    let lastUiUpdateAt = 0;
    const tick = (now: number): void => {
      const gameTime = elapsedBeforeRunRef.current + now - runSegmentStartedAtRef.current;
      if (now - lastUiUpdateAt >= 100) {
        lastUiUpdateAt = now;
        setElapsedMs(gameModeRef.current === "songs" ? gameTime : Math.min(gameDurationMs, gameTime));
      }
      if (gameModeRef.current === "levels" && gameTime >= gameDurationMs) {
        setElapsedMs(gameDurationMs);
        finishRound();
        return;
      }
      if (targetRef.current && !targetPoppedRef.current && gameTime - targetSpawnGameMsRef.current >= activeBubbleDurationMs) {
        const missedTarget = targetRef.current;
        targetRef.current = null;
        setTarget(null);
        if (missedTarget) triggerMascotReaction("sad");
        playGameSound("noteMissed");
        resetComboDisplay();
        const isSongMode = gameModeRef.current === "songs";
        const activeSong = isSongMode ? STAFF_GAME_SONGS.find((item) => item.id === selectedSongIdRef.current) : undefined;
        if (isSongMode && activeSong && missedTarget) {
          songTargetIndexRef.current += 1;
          setSongNotesCompleted(songTargetIndexRef.current);
          songWrongTargetTokenRef.current = null;
          setFeedback(`漏掉 ${noteLabel(missedTarget)} · 继续下一音`);
        } else {
          setFeedback("气泡飘走了，连击中断");
        }
        if (nextTargetTimeoutRef.current !== null) window.clearTimeout(nextTargetTimeoutRef.current);
        nextTargetTimeoutRef.current = window.setTimeout(() => {
          nextTargetTimeoutRef.current = null;
          if (phaseRef.current !== "running") {
            waitingForNextTargetRef.current = true;
            return;
          }
          if (isSongMode && activeSong && songTargetIndexRef.current >= activeSong.noteMidis.length) {
            finishRound();
            return;
          }
          const nextGameTime = elapsedBeforeRunRef.current + (performance.now() - runSegmentStartedAtRef.current);
          spawnTarget(nextGameTime);
        }, 180);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [activeBubbleDurationMs, finishRound, gameDurationMs, phase, playGameSound, resetComboDisplay, spawnTarget, triggerMascotReaction]);

  const startRunSegment = useCallback((): void => {
    runSegmentStartedAtRef.current = performance.now();
  }, []);

  const pauseRunSegment = useCallback((): number => {
    const pausedAt = performance.now();
    const elapsedAtPause = elapsedBeforeRunRef.current + pausedAt - runSegmentStartedAtRef.current;
    elapsedBeforeRunRef.current = gameModeRef.current === "songs" ? elapsedAtPause : Math.min(gameDurationMs, elapsedAtPause);
    return elapsedBeforeRunRef.current;
  }, [gameDurationMs]);

  return { pauseRunSegment, spawnTarget, startRunSegment };
}
