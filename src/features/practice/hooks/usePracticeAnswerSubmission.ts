import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PracticeAnswerInput } from "../../../domain/answerInput";
import { getTargetMidiNoteNumber, isPracticeAnswerCorrect } from "../../../domain/answerInput";
import type { Staff } from "../../../domain/types";
import {
  getPracticeAudioTimeAtBeat,
  getPracticeBeatDurationMs,
  getPracticeTimingGrade,
  getPracticeTimingWindowMs,
  type PracticeTempoAnchor,
  type PracticeTimingGrade,
} from "../logic/practiceMetronomeSync";
import { getDuetTargetMidis } from "../logic/duetPractice";
import {
  combineDuetPairHint,
  getDuetFeedbackStaff,
  getDuetPairHint,
  getDuetWrongHint,
} from "../logic/practiceViewHelpers";
import type {
  PracticePromptRuntime,
  PracticeStaffPageRuntime,
} from "./usePracticeSessionLifecycle";
import type { PendingDuetHandPair } from "./usePracticeDuetHints";

export const DUET_HAND_SIMULTANEITY_WINDOW_MS = 150;
export const DUET_HAND_SIMULTANEITY_TIMER_GRACE_MS = 25;

export interface PracticeSyncTimingFeedback {
  noteIndex: number;
  staff: Staff;
  midi?: number;
  result: "matched" | "missed" | "offbeat";
}

export interface PracticeSyncOnset {
  index: number;
  currentBeat: number;
  nextBeat: number;
  gapBeats: number;
}

interface Options {
  armDuetHandPairTimeout: (pending: PendingDuetHandPair) => void;
  acceptedDuetHandPairPromptRef: MutableRefObject<PracticePromptRuntime | null>;
  answerInputLockedRef: MutableRefObject<boolean>;
  freeRowPlaybackActiveRef: MutableRefObject<number | null>;
  freeTrackedNoteVisibilityRef: MutableRefObject<boolean>;
  firstSyncInputByOnsetRef: MutableRefObject<
    Map<number, { answer: PracticeAnswerInput; timingGrade?: PracticeTimingGrade }>
  >;
  getCurrentSyncOnset: () => PracticeSyncOnset | undefined;
  getSyncOnsetAtIndex: (index: number) => PracticeSyncOnset | undefined;
  isBlindPractice: boolean;
  isDuetPractice: boolean;
  isMetronomeSyncActive: boolean;
  isPausedRef: MutableRefObject<boolean>;
  isPreReadingPractice: boolean;
  isStaffPagePractice: boolean;
  metronomeBpm: number;
  pendingDuetHandPairRef: MutableRefObject<PendingDuetHandPair | null>;
  pendingSyncAnswersRef: MutableRefObject<
    Array<{ targetIndex: number; answer: PracticeAnswerInput }>
  >;
  performanceTimeToAudioTime: (performanceTimeMs: number) => number;
  preReadingScoreWindow: { phase: string };
  promptRef: MutableRefObject<PracticePromptRuntime | null>;
  queueDuetWrongHint: (prompt: PracticePromptRuntime, staff: Staff | null) => void;
  resetIncompleteDuetHandPair: (prompt: PracticePromptRuntime) => void;
  shouldSynchronizeMetronome: boolean;
  showDuetHint: (prompt: PracticePromptRuntime, key: string, message: string) => void;
  staffPageFirstNoteOffset: number;
  staffPageRef: MutableRefObject<PracticeStaffPageRuntime | null>;
  submitAnswer: (answer: PracticeAnswerInput) => void;
  setSyncTimingFeedback: Dispatch<SetStateAction<PracticeSyncTimingFeedback[]>>;
  syncTempoAnchorsRef: MutableRefObject<PracticeTempoAnchor[]>;
}

export function usePracticeAnswerSubmission(options: Options) {
  const {
    armDuetHandPairTimeout,
    acceptedDuetHandPairPromptRef,
    answerInputLockedRef,
    freeRowPlaybackActiveRef,
    freeTrackedNoteVisibilityRef,
    firstSyncInputByOnsetRef,
    getCurrentSyncOnset,
    getSyncOnsetAtIndex,
    isBlindPractice,
    isDuetPractice,
    isMetronomeSyncActive,
    isPausedRef,
    isPreReadingPractice,
    isStaffPagePractice,
    metronomeBpm,
    pendingDuetHandPairRef,
    pendingSyncAnswersRef,
    performanceTimeToAudioTime,
    preReadingScoreWindow,
    promptRef,
    queueDuetWrongHint,
    resetIncompleteDuetHandPair,
    shouldSynchronizeMetronome,
    showDuetHint,
    staffPageFirstNoteOffset,
    staffPageRef,
    submitAnswer,
    setSyncTimingFeedback,
    syncTempoAnchorsRef,
  } = options;

  return useCallback(
    (answer: PracticeAnswerInput): void => {
      if (isPausedRef.current) return;
      if (isStaffPagePractice && !freeTrackedNoteVisibilityRef.current) return;
      if (freeRowPlaybackActiveRef.current !== null) return;
      if (isPreReadingPractice && preReadingScoreWindow.phase !== "training") return;

      const currentPrompt = promptRef.current;
      const duetTargets = currentPrompt?.duetTargets;
      const isUnsynchronizedDuetPrompt =
        isDuetPractice && !shouldSynchronizeMetronome && duetTargets !== undefined;
      const isDuetTwoHandGroup =
        duetTargets !== undefined && duetTargets.high.length > 0 && duetTargets.low.length > 0;
      if (isUnsynchronizedDuetPrompt && currentPrompt && duetTargets) {
        const answerMidi = answer.midiNoteNumber;
        const targetMidis = getDuetTargetMidis(duetTargets);
        const matchedStaff: Staff | undefined = (["treble", "bass"] as const).find(
          (staff) =>
            targetMidis[staff].includes(answerMidi ?? Number.NaN) &&
            !currentPrompt.completedDuetMidis.includes(answerMidi ?? Number.NaN)
        );

        if (!matchedStaff) {
          queueDuetWrongHint(currentPrompt, getDuetFeedbackStaff(answerMidi, currentPrompt));
        } else if (isDuetTwoHandGroup && acceptedDuetHandPairPromptRef.current !== currentPrompt) {
          let pending = pendingDuetHandPairRef.current;
          if (pending && pending.prompt !== currentPrompt) {
            if (pending.timeoutId !== null) window.clearTimeout(pending.timeoutId);
            pendingDuetHandPairRef.current = null;
            pending = null;
          }

          const inputAtMs = Number.isFinite(answer.inputTimeMs)
            ? answer.inputTimeMs!
            : performance.now();
          if (pending) {
            const elapsedMs = Math.abs(inputAtMs - pending.firstInputAtMs);
            if (elapsedMs > DUET_HAND_SIMULTANEITY_WINDOW_MS) {
              const firstStaff = pending.firstStaff;
              const wrongStaves = [...pending.wrongStaves];
              const hasUnknownWrong = pending.hasUnknownWrong;
              if (pending.timeoutId !== null) window.clearTimeout(pending.timeoutId);
              resetIncompleteDuetHandPair(currentPrompt);
              pendingDuetHandPairRef.current = null;
              pending = null;
              acceptedDuetHandPairPromptRef.current = null;
              const hint = getDuetPairHint(
                firstStaff,
                matchedStaff !== firstStaff ? matchedStaff : undefined
              );
              const combinedHint = combineDuetPairHint(hint, wrongStaves, hasUnknownWrong);
              showDuetHint(currentPrompt, combinedHint.key, combinedHint.message);
              return;
            } else if (matchedStaff !== pending.firstStaff) {
              const wrongHint = getDuetWrongHint([...pending.wrongStaves], pending.hasUnknownWrong);
              if (pending.timeoutId !== null) window.clearTimeout(pending.timeoutId);
              pendingDuetHandPairRef.current = null;
              acceptedDuetHandPairPromptRef.current = currentPrompt;
              if (wrongHint) {
                showDuetHint(currentPrompt, wrongHint.key, wrongHint.message);
              }
            }
          }

          if (
            !pendingDuetHandPairRef.current &&
            acceptedDuetHandPairPromptRef.current !== currentPrompt
          ) {
            const nextPending: PendingDuetHandPair = {
              prompt: currentPrompt,
              firstStaff: matchedStaff,
              firstInputAtMs: inputAtMs,
              wrongStaves: new Set(),
              hasUnknownWrong: false,
              timeoutId: null,
            };
            pendingDuetHandPairRef.current = nextPending;
            armDuetHandPairTimeout(nextPending);
          }
        }
      }

      let answerWithTiming = answer;
      if (
        isMetronomeSyncActive &&
        (answer.source === "midi" || (isBlindPractice && answer.source === "microphone"))
      ) {
        // The final count-in callback establishes the first score-beat anchor.
        // Keep accepting input inside the half-beat early window while the count-in
        // numeral is still visible on screen.
        if (syncTempoAnchorsRef.current.length === 0) return;
        const prompt = promptRef.current;
        const page = staffPageRef.current;
        const answerMidi = answer.midiNoteNumber;
        const inputTime = performanceTimeToAudioTime(answer.inputTimeMs ?? performance.now());
        const onset = getCurrentSyncOnset();
        const currentTargets = prompt?.duetTargets
          ? [...prompt.duetTargets.high, ...prompt.duetTargets.low]
          : prompt
            ? [prompt.note]
            : [];
        const beatDurationMs = getPracticeBeatDurationMs(metronomeBpm);
        const timingCandidates: Array<{
          index: number;
          deltaMs: number;
          grade: PracticeTimingGrade;
          targets: Array<{ staff: Staff; midi: number }>;
          matchedTarget?: { staff: Staff; midi: number };
        }> = [];
        const maximumBeatOffsetMs = beatDurationMs * 0.5;
        if (page && answerMidi !== undefined) {
          for (let index = page.index; index < page.notes.length; index += 1) {
            const candidateOnset = getSyncOnsetAtIndex(index);
            if (!candidateOnset) continue;
            const expectedTime = getPracticeAudioTimeAtBeat(
              candidateOnset.currentBeat,
              syncTempoAnchorsRef.current,
              metronomeBpm
            );
            if (expectedTime === undefined) continue;
            const deltaMs = (inputTime - expectedTime) * 1000;
            if (deltaMs < -maximumBeatOffsetMs) break;
            const grade = getPracticeTimingGrade(
              deltaMs,
              getPracticeTimingWindowMs(metronomeBpm, candidateOnset.gapBeats),
              maximumBeatOffsetMs
            );
            if (!grade) continue;

            const rawTargets =
              index === page.index
                ? currentTargets
                : (page.noteGroups?.[index] ?? (page.notes[index] ? [page.notes[index]!] : []));
            const targets = rawTargets
              .map((target) => ({
                staff: target.staff,
                midi: getTargetMidiNoteNumber(target),
              }))
              .filter(
                (target) =>
                  index !== page.index ||
                  !prompt?.duetTargets ||
                  !prompt.completedDuetMidis.includes(target.midi)
              );
            timingCandidates.push({
              index,
              deltaMs,
              grade,
              targets,
              matchedTarget: targets.find((target) => target.midi === answerMidi),
            });
          }
        }

        const matchingCandidates = timingCandidates.filter((candidate) => candidate.matchedTarget);
        const preferredCandidates = matchingCandidates.length
          ? matchingCandidates
          : timingCandidates;
        const onTimeMatches = preferredCandidates.filter(
          (candidate) => candidate.matchedTarget && candidate.grade === "on-time"
        );
        const candidatePool = onTimeMatches.length ? onTimeMatches : preferredCandidates;
        const selectedCandidate = [...candidatePool].sort(
          (left, right) =>
            Math.abs(left.deltaMs) - Math.abs(right.deltaMs) || left.index - right.index
        )[0];

        if (selectedCandidate?.matchedTarget && page && selectedCandidate.index > page.index) {
          const targetIndex = selectedCandidate.index;
          const targetNoteIndex = staffPageFirstNoteOffset + targetIndex;
          const targetKey = targetNoteIndex;
          const priorFirstInput = firstSyncInputByOnsetRef.current.get(targetKey);
          const isFirstInput = priorFirstInput === undefined;
          let queuedAnswer = answer;
          if (isFirstInput && prompt?.duetTargets) {
            queuedAnswer = { ...answer, duetTimingGrade: selectedCandidate.grade };
          }
          if (isFirstInput) {
            firstSyncInputByOnsetRef.current.set(targetKey, {
              answer: queuedAnswer,
              timingGrade: selectedCandidate.grade,
            });
          }

          const target = selectedCandidate.matchedTarget;
          setSyncTimingFeedback((current) => {
            const next = current.filter(
              (entry) =>
                entry.noteIndex !== targetNoteIndex ||
                entry.staff !== target.staff ||
                (entry.midi !== undefined && entry.midi !== answerMidi)
            );
            if (!isFirstInput) return next;
            return [
              ...next,
              {
                noteIndex: targetNoteIndex,
                staff: target.staff,
                midi: answerMidi,
                result: selectedCandidate.grade === "on-time" ? "matched" : "offbeat",
              },
            ];
          });

          const isDuplicateQueuedInput = pendingSyncAnswersRef.current.some(
            (entry) =>
              entry.targetIndex === targetIndex &&
              entry.answer.midiNoteNumber === answerMidi &&
              entry.answer.inputTimeMs === answer.inputTimeMs
          );
          if (!isDuplicateQueuedInput) {
            pendingSyncAnswersRef.current.push({ targetIndex, answer: queuedAnswer });
          }
          return;
        }

        if (prompt && onset && !answerInputLockedRef.current) {
          const noteIndex = staffPageFirstNoteOffset + onset.index;
          const targetKey = noteIndex;
          const priorFirstInput = firstSyncInputByOnsetRef.current.get(targetKey);
          const belongsToCurrentOnset = selectedCandidate?.index === onset.index;
          const isReplayOfFirstInput = priorFirstInput?.answer === answer;
          const isFirstOnsetInput = priorFirstInput === undefined && belongsToCurrentOnset;
          const timingGrade = !belongsToCurrentOnset
            ? undefined
            : isFirstOnsetInput
              ? selectedCandidate?.grade
              : isReplayOfFirstInput
                ? priorFirstInput?.timingGrade
                : undefined;
          if (isFirstOnsetInput) {
            firstSyncInputByOnsetRef.current.set(targetKey, {
              answer,
              ...(timingGrade ? { timingGrade } : {}),
            });
          }

          const targetMidis = prompt.duetTargets
            ? getDuetTargetMidis(prompt.duetTargets)
            : undefined;
          let matchedStaff: Staff | undefined;
          if (targetMidis && answerMidi !== undefined) {
            for (const staff of ["treble", "bass"] as const) {
              if (
                targetMidis[staff].includes(answerMidi) &&
                !prompt.completedDuetMidis.includes(answerMidi)
              ) {
                matchedStaff = staff;
                break;
              }
            }
          }
          const answeredCorrectly = targetMidis
            ? matchedStaff !== undefined
            : isPracticeAnswerCorrect(answer, prompt.note, "exact-pitch");
          if (answeredCorrectly && selectedCandidate?.index !== onset.index) return;
          if (timingGrade && prompt.duetTargets) {
            answerWithTiming = { ...answer, duetTimingGrade: timingGrade };
          }
          if (!answeredCorrectly) {
            if (isFirstOnsetInput && timingGrade) {
              const staves = targetMidis
                ? (["treble", "bass"] as const).filter(
                    (staff) => !prompt.completedDuetStaves.includes(staff)
                  )
                : [prompt.note.staff];
              setSyncTimingFeedback((current) => {
                const next = current.filter(
                  (entry) =>
                    entry.noteIndex !== noteIndex ||
                    !staves.includes(entry.staff) ||
                    entry.midi !== undefined
                );
                return [
                  ...next,
                  ...staves.map((staff) => ({ noteIndex, staff, result: "missed" as const })),
                ];
              });
            }
          } else {
            const staff = matchedStaff ?? prompt.note.staff;
            setSyncTimingFeedback((current) => {
              const next = current.filter(
                (entry) =>
                  entry.noteIndex !== noteIndex ||
                  entry.staff !== staff ||
                  (entry.midi !== undefined && entry.midi !== answerMidi)
              );
              if (!timingGrade) return next;
              return [
                ...next,
                {
                  noteIndex,
                  staff,
                  midi: answerMidi,
                  result: timingGrade === "on-time" ? "matched" : "offbeat",
                },
              ];
            });
          }
        }
      }
      void submitAnswer(answerWithTiming);
    },
    [
      armDuetHandPairTimeout,
      acceptedDuetHandPairPromptRef,
      answerInputLockedRef,
      firstSyncInputByOnsetRef,
      freeRowPlaybackActiveRef,
      freeTrackedNoteVisibilityRef,
      getCurrentSyncOnset,
      getSyncOnsetAtIndex,
      isBlindPractice,
      isDuetPractice,
      isMetronomeSyncActive,
      isStaffPagePractice,
      isPreReadingPractice,
      isPausedRef,
      preReadingScoreWindow.phase,
      metronomeBpm,
      pendingDuetHandPairRef,
      pendingSyncAnswersRef,
      performanceTimeToAudioTime,
      promptRef,
      queueDuetWrongHint,
      resetIncompleteDuetHandPair,
      shouldSynchronizeMetronome,
      showDuetHint,
      staffPageFirstNoteOffset,
      staffPageRef,
      submitAnswer,
      setSyncTimingFeedback,
      syncTempoAnchorsRef,
    ]
  );
}
