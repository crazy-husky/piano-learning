import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import type { PracticeAnswerInput } from "../../../domain/answerInput";
import { STAFF_GAME_SONGS } from "../data/staffGameSongs";
import {
  BUBBLE_FADE_IN_MS,
  COMBO_BONUS_MAX_STEPS,
  ERROR_FLASH_DURATION_MS,
  LATE_PREVIOUS_INPUT_WINDOW_MS,
  PITCH_NAMES,
  RUSH_MODE_COMBO_THRESHOLD,
  RUSH_SCORE_MULTIPLIER,
  gameDifficultyPreset,
  starsForAccuracy,
  staffGameReactionMs,
  type GameDifficulty,
  type StaffGameNotePoolScope,
} from "../logic/staffGameRules";
import { appendStaffGameMicrophoneDebugEvent } from "../logic/staffGameMicrophoneDebug";
import type {
  StaffGameLevelRoundMetrics,
  StaffGameRoundNoteOutcome,
  StaffGameTarget,
} from "./useStaffGameRoundClock";
import type { StaffGameSoundName } from "./useStaffGameAudio";

export interface StaffGameComboIndicator {
  token: number;
  count: number;
  durationMs: number;
  isFadingOut?: boolean;
}

export interface StaffGameRushScoreFlight {
  token: number;
  points: number;
  left: number;
  top: number;
  deltaX: number;
  deltaY: number;
  ready: boolean;
}

export interface StaffGameWrongAnswerRecord {
  token: number;
  expectedNote: string;
  recognizedNote: string;
  midi: number;
  confidence?: number;
  clipping?: boolean;
}

interface StaffGameModeAudioSettings {
  soundEffectsEnabled: boolean;
}

interface StaffGameScoringSettings {
  inputMode: "physical" | "virtual" | "midi";
  difficulty: GameDifficulty;
  notePoolScope: StaffGameNotePoolScope;
  audioByMode: Record<"levels" | "songs", StaffGameModeAudioSettings>;
}

type StaffGameMode = "levels" | "songs";
type StaffGamePhase = "ready" | "running" | "paused" | "summary";

interface StaffGameBubbleBurst {
  token: number;
  x: number;
  y: number;
}

interface StaffGameScoringOptions {
  phaseRef: MutableRefObject<StaffGamePhase>;
  targetRef: MutableRefObject<StaffGameTarget | null>;
  targetPoppedRef: MutableRefObject<boolean>;
  targetWrong: boolean;
  roundMetricsRef: MutableRefObject<StaffGameLevelRoundMetrics>;
  settingsRef: MutableRefObject<StaffGameScoringSettings>;
  gameModeRef: MutableRefObject<StaffGameMode>;
  roundPurposeRef: MutableRefObject<"level" | "wrong-note-review">;
  selectedSongIdRef: MutableRefObject<string>;
  songTargetIndexRef: MutableRefObject<number>;
  songFirstTryHitsRef: MutableRefObject<number>;
  songWrongTargetTokenRef: MutableRefObject<number | null>;
  scoreRef: MutableRefObject<number>;
  displayedScoreRef: MutableRefObject<number>;
  scoreAnimationTargetRef: MutableRefObject<number>;
  scoreAnimationTimerRef: MutableRefObject<number | null>;
  rushScoreFlightsRef: MutableRefObject<StaffGameRushScoreFlight[]>;
  rushScoreFlightTokenRef: MutableRefObject<number>;
  maxComboRef: MutableRefObject<number>;
  comboRef: MutableRefObject<number>;
  comboIndicatorRef: MutableRefObject<StaffGameComboIndicator | null>;
  comboIndicatorFadeTimeoutRef: MutableRefObject<number | null>;
  wrongAnswerRecordsRef: MutableRefObject<StaffGameWrongAnswerRecord[]>;
  errorFlashTimeoutRef: MutableRefObject<number | null>;
  roundFinishedRef: MutableRefObject<boolean>;
  elapsedBeforeRunRef: MutableRefObject<number>;
  runSegmentStartedAtRef: MutableRefObject<number>;
  spawnTargetRef: MutableRefObject<(atGameMs: number) => void>;
  wrongClearTimeoutRef: MutableRefObject<number | null>;
  burstTimeoutRef: MutableRefObject<number | null>;
  nextTargetTimeoutRef: MutableRefObject<number | null>;
  waitingForNextTargetRef: MutableRefObject<boolean>;
  playfieldRef: RefObject<HTMLDivElement | null>;
  sceneRef: RefObject<HTMLDivElement | null>;
  targetElementRef: RefObject<HTMLDivElement | null>;
  setPhase: Dispatch<SetStateAction<StaffGamePhase>>;
  setTarget: Dispatch<SetStateAction<StaffGameTarget | null>>;
  setTargetPopped: Dispatch<SetStateAction<boolean>>;
  setTargetWrong: Dispatch<SetStateAction<boolean>>;
  setBubbleBurst: Dispatch<SetStateAction<StaffGameBubbleBurst | null>>;
  setComboIndicator: Dispatch<SetStateAction<StaffGameComboIndicator | null>>;
  setCombo: Dispatch<SetStateAction<number>>;
  setMaxCombo: Dispatch<SetStateAction<number>>;
  setScore: Dispatch<SetStateAction<number>>;
  setDisplayedScoreImmediately: (score: number) => void;
  setRushScoreFlights: Dispatch<SetStateAction<StaffGameRushScoreFlight[]>>;
  setEarnedStars: Dispatch<SetStateAction<number>>;
  setSummaryAccuracy: Dispatch<SetStateAction<number>>;
  setSummaryWrongAnswerRecords: Dispatch<SetStateAction<StaffGameWrongAnswerRecord[]>>;
  setSummaryIsWrongNoteReview: Dispatch<SetStateAction<boolean>>;
  onRoundNoteOutcomes: (
    outcomes: StaffGameRoundNoteOutcome[],
    wrongAnswerRecords: StaffGameWrongAnswerRecord[]
  ) => void;
  setFeedback: Dispatch<SetStateAction<string>>;
  setSongNotesCompleted: Dispatch<SetStateAction<number>>;
  setSongFirstTryHits: Dispatch<SetStateAction<number>>;
  setErrorFlashActive: Dispatch<SetStateAction<boolean>>;
  resetComboDisplay: () => void;
  restartComboTimer: () => void;
  queueRushScore: (points: number) => void;
  flushScorePresentation: (score: number) => void;
  persistRoundResult: (stars: number) => void;
  persistSongResult: (stars: number, accuracy: number) => void;
  microphoneStop: () => void;
  onSessionActiveChange: (active: boolean) => void;
  triggerMascotReaction: (action: "cheer" | "sad") => void;
  triggerHitHaptic: () => void;
  playComboFeedback: (comboCount: number) => void;
  playGameSound: (sound: StaffGameSoundName) => void;
  noteLabel: (note: StaffGameTarget) => string;
}

export function useStaffGameScoring({
  phaseRef,
  targetRef,
  targetPoppedRef,
  targetWrong,
  roundMetricsRef,
  settingsRef,
  gameModeRef,
  roundPurposeRef,
  selectedSongIdRef,
  songTargetIndexRef,
  songFirstTryHitsRef,
  songWrongTargetTokenRef,
  scoreRef,
  displayedScoreRef,
  scoreAnimationTargetRef,
  scoreAnimationTimerRef,
  rushScoreFlightsRef,
  rushScoreFlightTokenRef,
  maxComboRef,
  comboRef,
  comboIndicatorRef,
  comboIndicatorFadeTimeoutRef,
  wrongAnswerRecordsRef,
  errorFlashTimeoutRef,
  roundFinishedRef,
  elapsedBeforeRunRef,
  runSegmentStartedAtRef,
  spawnTargetRef,
  wrongClearTimeoutRef,
  burstTimeoutRef,
  nextTargetTimeoutRef,
  waitingForNextTargetRef,
  playfieldRef,
  sceneRef,
  targetElementRef,
  setPhase,
  setTarget,
  setTargetPopped,
  setTargetWrong,
  setBubbleBurst,
  setComboIndicator,
  setCombo,
  setMaxCombo,
  setScore,
  setDisplayedScoreImmediately,
  setRushScoreFlights,
  setEarnedStars,
  setSummaryAccuracy,
  setSummaryWrongAnswerRecords,
  setSummaryIsWrongNoteReview,
  onRoundNoteOutcomes,
  setFeedback,
  setSongNotesCompleted,
  setSongFirstTryHits,
  setErrorFlashActive,
  resetComboDisplay,
  restartComboTimer,
  queueRushScore,
  flushScorePresentation,
  persistRoundResult,
  persistSongResult,
  microphoneStop,
  onSessionActiveChange,
  triggerMascotReaction,
  triggerHitHaptic,
  playComboFeedback,
  playGameSound,
  noteLabel,
}: StaffGameScoringOptions) {
  const finishRound = useCallback((): void => {
    if (roundFinishedRef.current) return;
    roundFinishedRef.current = true;
    flushScorePresentation(scoreRef.current);
    if (errorFlashTimeoutRef.current !== null) window.clearTimeout(errorFlashTimeoutRef.current);
    errorFlashTimeoutRef.current = null;
    setErrorFlashActive(false);
    const isSongMode = gameModeRef.current === "songs";
    const isWrongNoteReview = !isSongMode && roundPurposeRef.current === "wrong-note-review";
    const activeSong = isSongMode
      ? STAFF_GAME_SONGS.find((item) => item.id === selectedSongIdRef.current)
      : undefined;
    const generatedNoteCount = activeSong
      ? activeSong.noteMidis.length
      : roundMetricsRef.current.generatedBubbleCount;
    const firstTryCorrectCount = activeSong
      ? songFirstTryHitsRef.current
      : roundMetricsRef.current.firstTryCorrectCount;
    const accuracy = generatedNoteCount > 0 ? (firstTryCorrectCount * 100) / generatedNoteCount : 0;
    const finalStars =
      isWrongNoteReview || generatedNoteCount === 0
        ? 0
        : starsForAccuracy(firstTryCorrectCount, generatedNoteCount);
    if (
      finalStars > 0 &&
      settingsRef.current.audioByMode[gameModeRef.current].soundEffectsEnabled
    ) {
      playGameSound("levelClear");
    }
    setEarnedStars(finalStars);
    setSummaryAccuracy(accuracy);
    setSummaryWrongAnswerRecords([...wrongAnswerRecordsRef.current]);
    setSummaryIsWrongNoteReview(isWrongNoteReview);
    onRoundNoteOutcomes(
      [...roundMetricsRef.current.firstInputByToken.values()],
      [...wrongAnswerRecordsRef.current]
    );
    resetComboDisplay();
    targetRef.current = null;
    setTarget(null);
    setBubbleBurst(null);
    if (burstTimeoutRef.current !== null) window.clearTimeout(burstTimeoutRef.current);
    burstTimeoutRef.current = null;
    if (nextTargetTimeoutRef.current !== null) window.clearTimeout(nextTargetTimeoutRef.current);
    waitingForNextTargetRef.current = false;
    phaseRef.current = "summary";
    setPhase("summary");
    setFeedback(isSongMode ? "歌曲演奏完成" : "本局结束 · 可重试或进入下一关");
    if (isSongMode) persistSongResult(finalStars, accuracy);
    else if (!isWrongNoteReview) persistRoundResult(finalStars);
    microphoneStop();
    onSessionActiveChange(false);
  }, [
    burstTimeoutRef,
    errorFlashTimeoutRef,
    flushScorePresentation,
    gameModeRef,
    roundMetricsRef,
    microphoneStop,
    nextTargetTimeoutRef,
    onSessionActiveChange,
    phaseRef,
    onRoundNoteOutcomes,
    persistRoundResult,
    persistSongResult,
    playGameSound,
    resetComboDisplay,
    roundFinishedRef,
    scoreRef,
    selectedSongIdRef,
    setBubbleBurst,
    setEarnedStars,
    setErrorFlashActive,
    setFeedback,
    setPhase,
    setSummaryAccuracy,
    setSummaryIsWrongNoteReview,
    setSummaryWrongAnswerRecords,
    setTarget,
    settingsRef,
    songFirstTryHitsRef,
    targetRef,
    waitingForNextTargetRef,
    wrongAnswerRecordsRef,
    roundPurposeRef,
  ]);

  const handleRecognizedAnswer = useCallback(
    (answer: PracticeAnswerInput): void => {
      if (phaseRef.current !== "running" || !targetRef.current) return;
      if (
        settingsRef.current.inputMode === "virtual" &&
        answer.source !== "screen-keyboard" &&
        answer.source !== "computer-keyboard"
      )
        return;
      if (settingsRef.current.inputMode === "physical" && answer.source !== "microphone") return;
      if (settingsRef.current.inputMode === "midi" && answer.source !== "midi") return;
      const currentTarget = targetRef.current;
      const midi = answer.midiNoteNumber;
      if (midi === undefined) return;
      const isCorrect =
        settingsRef.current.inputMode === "virtual"
          ? ((midi % 12) + 12) % 12 === ((currentTarget.midi % 12) + 12) % 12
          : midi === currentTarget.midi;
      const gameNowAtInput =
        elapsedBeforeRunRef.current + (performance.now() - runSegmentStartedAtRef.current);
      const lateInputShield = roundMetricsRef.current.lateInputShield;
      const matchesLateInputShield =
        lateInputShield !== null &&
        (settingsRef.current.inputMode === "virtual"
          ? ((midi % 12) + 12) % 12 === ((lateInputShield.midi % 12) + 12) % 12
          : lateInputShield.midi === midi);
      const currentTargetReadyAt = currentTarget.spawnAt + BUBBLE_FADE_IN_MS;
      const isLateForPrevious =
        lateInputShield?.targetToken === currentTarget.token &&
        matchesLateInputShield &&
        gameNowAtInput >= currentTargetReadyAt &&
        gameNowAtInput - currentTargetReadyAt <= LATE_PREVIOUS_INPUT_WINDOW_MS;
      const targetOutcomeAtInput = roundMetricsRef.current.firstInputByToken.get(
        currentTarget.token
      );
      targetOutcomeAtInput?.attempts?.push({
        midi,
        noteName: answer.noteName,
        atMs: Math.max(0, gameNowAtInput - currentTarget.spawnAt),
        confidence: answer.confidence,
        inputMode:
          settingsRef.current.inputMode === "physical"
            ? "microphone"
            : settingsRef.current.inputMode === "midi"
              ? "midi"
              : "virtual-keyboard",
        isCorrect: isLateForPrevious ? false : isCorrect,
        ...(isLateForPrevious ? { isLateForPrevious: true } : {}),
        clipping: answer.clipping ?? false,
      });
      if (isLateForPrevious) return;
      if (answer.source === "microphone") {
        appendStaffGameMicrophoneDebugEvent("answer", {
          answer: {
            midi,
            note: `${answer.noteName}${answer.octave ?? ""}`,
            octave: answer.octave ?? null,
          },
          isCorrect,
          phase: phaseRef.current,
          target: {
            midi: currentTarget.midi,
            note: noteLabel(currentTarget),
            token: currentTarget.token,
          },
        });
      }
      if (isCorrect && targetPoppedRef.current) return;
      const firstInput = roundMetricsRef.current.firstInputByToken.get(currentTarget.token);
      if (firstInput && !isCorrect) firstInput.errorAt = Date.now();
      if (firstInput && firstInput.firstInputCorrect === null) {
        firstInput.firstInputCorrect = isCorrect;
        if (isCorrect) roundMetricsRef.current.firstTryCorrectCount += 1;
      }
      if (isCorrect) {
        triggerHitHaptic();
        const isSongMode = gameModeRef.current === "songs";
        const metrics = roundMetricsRef.current;
        const gameNow =
          elapsedBeforeRunRef.current + (performance.now() - runSegmentStartedAtRef.current);
        const reactionMs = staffGameReactionMs(gameNow, currentTarget.spawnAt);
        const targetOutcome = metrics.firstInputByToken.get(currentTarget.token);
        if (targetOutcome && targetOutcome.proficiencyResponseMs === undefined && reactionMs >= 0) {
          // Measure from the bubble's fully visible point, not the start of its entrance.
          targetOutcome.proficiencyResponseMs = Math.max(0, reactionMs - BUBBLE_FADE_IN_MS);
        }
        if (targetOutcome) {
          targetOutcome.correctConfidence = answer.confidence;
          targetOutcome.correctClipping = answer.clipping;
        }
        const activeSong = isSongMode
          ? STAFF_GAME_SONGS.find((item) => item.id === selectedSongIdRef.current)
          : undefined;
        if (isSongMode && activeSong) {
          if (songWrongTargetTokenRef.current !== currentTarget.token) {
            songFirstTryHitsRef.current += 1;
            setSongFirstTryHits(songFirstTryHitsRef.current);
          }
          songWrongTargetTokenRef.current = null;
          songTargetIndexRef.current += 1;
          setSongNotesCompleted(songTargetIndexRef.current);
        }
        if (!isSongMode) {
          metrics.correctBubbleCount += 1;
          if (reactionMs > 0) {
            metrics.responseTotalMs += reactionMs;
            metrics.responseSampleCount += 1;
            if (firstInput?.firstInputCorrect === true) firstInput.responseMs = reactionMs;
          }
        }
        triggerMascotReaction("cheer");
        playGameSound("bubblePop");
        targetPoppedRef.current = true;
        targetRef.current = null;
        setTargetPopped(true);
        const fieldBounds = playfieldRef.current?.getBoundingClientRect();
        const bubbleBounds = targetElementRef.current?.getBoundingClientRect();
        if (fieldBounds && bubbleBounds) {
          setBubbleBurst({
            token: currentTarget.token,
            x: bubbleBounds.left + bubbleBounds.width / 2 - fieldBounds.left,
            y: bubbleBounds.top + bubbleBounds.height / 2 - fieldBounds.top,
          });
        }
        const nextCombo = comboRef.current + 1;
        if (comboIndicatorFadeTimeoutRef.current !== null) {
          window.clearTimeout(comboIndicatorFadeTimeoutRef.current);
          comboIndicatorFadeTimeoutRef.current = null;
        }
        const nextComboIndicator: StaffGameComboIndicator = {
          token: currentTarget.token,
          count: nextCombo,
          durationMs: gameDifficultyPreset(settingsRef.current.difficulty).comboWindowMs,
        };
        comboIndicatorRef.current = nextComboIndicator;
        setComboIndicator(nextComboIndicator);
        restartComboTimer();
        if (fieldBounds && bubbleBounds) {
          if (burstTimeoutRef.current !== null) window.clearTimeout(burstTimeoutRef.current);
          burstTimeoutRef.current = window.setTimeout(() => {
            setBubbleBurst(null);
            burstTimeoutRef.current = null;
          }, 760);
        }
        playComboFeedback(nextCombo);
        comboRef.current = nextCombo;
        maxComboRef.current = Math.max(maxComboRef.current, nextCombo);
        const scorePreset = gameDifficultyPreset(settingsRef.current.difficulty);
        const basePoints =
          scorePreset.correctPoints +
          Math.min(COMBO_BONUS_MAX_STEPS, nextCombo - 1) * scorePreset.comboBonusPoints;
        const rushModeActive = nextCombo >= RUSH_MODE_COMBO_THRESHOLD;
        const points = basePoints * (rushModeActive ? RUSH_SCORE_MULTIPLIER : 1);
        scoreRef.current += points;
        const totalScore = scoreRef.current;
        setCombo(nextCombo);
        setMaxCombo(maxComboRef.current);
        setScore(totalScore);
        if (rushModeActive) {
          const sceneBounds = sceneRef.current?.getBoundingClientRect();
          if (sceneBounds && bubbleBounds) {
            rushScoreFlightTokenRef.current += 1;
            const flight: StaffGameRushScoreFlight = {
              token: rushScoreFlightTokenRef.current,
              points,
              left: bubbleBounds.left + bubbleBounds.width / 2 - sceneBounds.left,
              top: bubbleBounds.bottom - sceneBounds.top + 42,
              deltaX: 0,
              deltaY: 0,
              ready: false,
            };
            const nextFlights = [...rushScoreFlightsRef.current, flight];
            rushScoreFlightsRef.current = nextFlights;
            setRushScoreFlights(nextFlights);
          } else {
            queueRushScore(points);
          }
        } else if (
          rushScoreFlightsRef.current.length > 0 ||
          scoreAnimationTimerRef.current !== null ||
          scoreAnimationTargetRef.current > displayedScoreRef.current
        ) {
          queueRushScore(points);
        } else {
          setDisplayedScoreImmediately(totalScore);
        }
        setFeedback(`+${points} · ${noteLabel(currentTarget)}`);
        const generatedNoteCount = activeSong
          ? activeSong.noteMidis.length
          : roundMetricsRef.current.generatedBubbleCount;
        const firstTryCorrectCount = activeSong
          ? songFirstTryHitsRef.current
          : roundMetricsRef.current.firstTryCorrectCount;
        const nextStars =
          roundPurposeRef.current === "wrong-note-review" || generatedNoteCount === 0
            ? 0
            : starsForAccuracy(firstTryCorrectCount, generatedNoteCount);
        setEarnedStars(nextStars);
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
          const gameNow =
            elapsedBeforeRunRef.current + (performance.now() - runSegmentStartedAtRef.current);
          spawnTargetRef.current(gameNow);
        }, 350);
        return;
      }

      if (targetWrong) return;
      const heardPitch = PITCH_NAMES[((midi % 12) + 12) % 12];
      if (!wrongAnswerRecordsRef.current.some((record) => record.token === currentTarget.token)) {
        wrongAnswerRecordsRef.current.push({
          token: currentTarget.token,
          expectedNote: noteLabel(currentTarget),
          recognizedNote: `${heardPitch}${Math.floor(midi / 12) - 1}`,
          midi,
          confidence: answer.confidence,
          clipping: answer.clipping,
        });
      }
      triggerMascotReaction("sad");
      if (
        gameModeRef.current === "songs" &&
        songWrongTargetTokenRef.current !== currentTarget.token
      ) {
        songWrongTargetTokenRef.current = currentTarget.token;
      }
      resetComboDisplay();
      setTargetWrong(true);
      if (settingsRef.current.inputMode !== "physical") playGameSound("noteMissed");
      setFeedback(`听到 ${heardPitch}${answer.octave ?? ""}，再试一次`);
      if (wrongClearTimeoutRef.current !== null) window.clearTimeout(wrongClearTimeoutRef.current);
      wrongClearTimeoutRef.current = window.setTimeout(() => setTargetWrong(false), 460);
      if (errorFlashTimeoutRef.current === null) {
        setErrorFlashActive(true);
        errorFlashTimeoutRef.current = window.setTimeout(() => {
          errorFlashTimeoutRef.current = null;
          setErrorFlashActive(false);
        }, ERROR_FLASH_DURATION_MS);
      }
    },
    [
      burstTimeoutRef,
      comboIndicatorFadeTimeoutRef,
      comboIndicatorRef,
      comboRef,
      displayedScoreRef,
      elapsedBeforeRunRef,
      errorFlashTimeoutRef,
      finishRound,
      gameModeRef,
      maxComboRef,
      nextTargetTimeoutRef,
      noteLabel,
      phaseRef,
      playComboFeedback,
      playGameSound,
      playfieldRef,
      queueRushScore,
      resetComboDisplay,
      restartComboTimer,
      roundMetricsRef,
      runSegmentStartedAtRef,
      roundPurposeRef,
      rushScoreFlightTokenRef,
      rushScoreFlightsRef,
      sceneRef,
      scoreAnimationTargetRef,
      scoreAnimationTimerRef,
      scoreRef,
      selectedSongIdRef,
      setBubbleBurst,
      setCombo,
      setComboIndicator,
      setEarnedStars,
      setErrorFlashActive,
      setFeedback,
      setMaxCombo,
      setDisplayedScoreImmediately,
      setRushScoreFlights,
      setScore,
      setSongFirstTryHits,
      setSongNotesCompleted,
      setTargetPopped,
      setTargetWrong,
      settingsRef,
      songFirstTryHitsRef,
      songTargetIndexRef,
      songWrongTargetTokenRef,
      spawnTargetRef,
      targetElementRef,
      targetPoppedRef,
      targetRef,
      targetWrong,
      triggerMascotReaction,
      triggerHitHaptic,
      waitingForNextTargetRef,
      wrongClearTimeoutRef,
      wrongAnswerRecordsRef,
    ]
  );

  return { finishRound, handleRecognizedAnswer };
}
