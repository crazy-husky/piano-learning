import type {
  AnswerEvent,
  AnswerInputMode,
  ReviewRecord,
  StaffGameProficiencySample,
} from "../domain/types";
import {
  parsePracticeMicrophonePreferences,
  practiceMicrophoneDebugParametersForSensitivityLevel,
  PRACTICE_MICROPHONE_PREFERENCES_KEY,
} from "../features/vocal-pitch/logic/practiceMicrophonePreferences";

export const MAX_ANSWER_EVENT_ATTEMPTS = 10;

export function boundedAnswerEvent(event: AnswerEvent): AnswerEvent {
  const lateAttempts = event.attempts
    .filter((attempt) => attempt.isLateForPrevious)
    .slice(0, MAX_ANSWER_EVENT_ATTEMPTS);
  const regularAttempts = event.attempts
    .filter((attempt) => !attempt.isLateForPrevious)
    .slice(0, MAX_ANSWER_EVENT_ATTEMPTS - lateAttempts.length);
  const attempts = [...regularAttempts, ...lateAttempts].sort(
    (left, right) => left.atMs - right.atMs
  );
  return {
    ...event,
    attempts: attempts.map((attempt) => ({
      ...attempt,
      clipping: attempt.clipping ?? false,
    })),
  };
}

export function answerDeviceInfo(): AnswerEvent["deviceInfo"] {
  if (typeof navigator === "undefined") return "other";
  const platform = navigator.platform ?? "";
  const userAgent = navigator.userAgent ?? "";
  if (/iPhone|iPod/i.test(`${platform} ${userAgent}`)) return "iPhone";
  if (
    /iPad/i.test(`${platform} ${userAgent}`) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1)
  ) {
    return "iPad";
  }
  if (/Mac/i.test(`${platform} ${userAgent}`)) return "Mac";
  return "other";
}

export function answerInputMode(value: string | undefined): AnswerInputMode {
  if (value === "microphone") return "microphone";
  if (value === "midi" || value === "exact-pitch") return "midi";
  if (value === "screen-keyboard" || value === "virtual-keyboard") return "virtual-keyboard";
  return "computer-keyboard";
}

export function currentMicrophoneContext(): Pick<
  AnswerEvent,
  "inputGain" | "sensitivityLevel" | "microphoneAlgorithm"
> {
  try {
    const stored = parsePracticeMicrophonePreferences(
      JSON.parse(localStorage.getItem(PRACTICE_MICROPHONE_PREFERENCES_KEY) ?? "null")
    );
    const result: Pick<AnswerEvent, "inputGain" | "sensitivityLevel" | "microphoneAlgorithm"> = {};
    const parameters = stored.debugMode
      ? stored.debugParameters
      : practiceMicrophoneDebugParametersForSensitivityLevel(
          stored.algorithm,
          stored.sensitivityLevel
        );
    result.inputGain = parameters.analysisGain;
    result.sensitivityLevel = stored.sensitivityLevel;
    result.microphoneAlgorithm = stored.algorithm;
    return result;
  } catch {
    return {};
  }
}

export function answerEventToReview(event: AnswerEvent): ReviewRecord | null {
  if (!event.targetNoteId || !event.targetGroupId || !event.targetNoteName || !event.targetOctave) {
    return null;
  }
  const startedAt =
    event.promptStartedAt ??
    new Date(
      Date.parse(event.occurredAt) - Math.max(0, event.activeMs ?? event.rawResponseTimeMs ?? 0)
    ).toISOString();
  const wrongAnswers = event.attempts
    .filter((attempt) => !attempt.isCorrect && !attempt.isLateForPrevious)
    .map((attempt) => ({
      noteName: attempt.noteName ?? event.targetNoteName!,
      atActiveMs: attempt.atMs,
      midiNoteNumber: attempt.midi,
      confidence: attempt.confidence,
      clipping: attempt.clipping,
      inputMode: attempt.inputMode,
    }));
  return {
    id: event.id,
    schemaVersion: 1,
    sessionId: event.sessionId,
    targetNoteId: event.targetNoteId as ReviewRecord["targetNoteId"],
    groupId: event.targetGroupId,
    noteName: event.targetNoteName,
    octave: event.targetOctave,
    startedAt,
    endedAt: event.promptEndedAt ?? event.occurredAt,
    answeredAt: event.isCorrectFinal ? event.occurredAt : undefined,
    answeredCorrectly: event.isCorrectFinal === true,
    interrupted: event.wasInterrupted ?? false,
    activeMs: event.activeMs ?? event.rawResponseTimeMs ?? 0,
    wrongAnswers,
    replayCount: 0,
    focusLosses: [],
  };
}

export function answerEventToStaffGameProficiencySample(
  event: AnswerEvent
): StaffGameProficiencySample | null {
  if (event.mode !== "staff-game" && event.mode !== "song") return null;
  if (event.targetMidi === undefined) return null;
  const pitchClass = ((event.targetMidi % 12) + 12) % 12;
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return {
    id: event.id,
    dataSetId: event.dataSetId,
    runId: event.sessionId,
    date: event.occurredAt.slice(0, 10),
    startedAt:
      event.promptStartedAt ??
      new Date(Date.parse(event.occurredAt) - (event.rawResponseTimeMs ?? 0)).toISOString(),
    endedAt: event.occurredAt,
    midi: event.targetMidi,
    note: `${names[pitchClass]}${Math.floor(event.targetMidi / 12) - 1}`,
    inputMode: event.inputMode as StaffGameProficiencySample["inputMode"],
    sensitivityLevel: event.sensitivityLevel ?? 3,
    microphoneAlgorithm: event.microphoneAlgorithm,
    rawResponseTimeMs: event.rawResponseTimeMs ?? null,
    estimatedSystemDelayMs: event.estimatedSystemDelayMs ?? 0,
    playerResponseTimeMs: event.responseTimeMs ?? null,
    firstInputCorrect: event.isCorrectFirstTry,
    missed: event.isMissed,
    inputGain: event.inputGain,
    deviceInfo: event.deviceInfo,
    mode: event.mode,
    levelId: event.levelId,
    songId: event.songId,
  };
}
