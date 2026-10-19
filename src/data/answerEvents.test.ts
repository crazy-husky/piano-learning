import { describe, expect, it } from "vitest";
import { boundedAnswerEvent, MAX_ANSWER_EVENT_ATTEMPTS } from "./answerEvents";
import type { AnswerEvent } from "../domain/types";

const event: AnswerEvent = {
  id: "event-1",
  dataSetId: "dataset-1",
  sessionId: "session-1",
  eventIndex: 0,
  occurredAt: "2026-10-19T10:00:00.000Z",
  mode: "free-practice",
  inputMode: "microphone",
  deviceInfo: "iPad",
  inputGain: 15,
  attempts: Array.from({ length: MAX_ANSWER_EVENT_ATTEMPTS + 4 }, (_, index) => ({
    midi: 60 + index,
    atMs: index * 100,
    isCorrect: index === MAX_ANSWER_EVENT_ATTEMPTS + 3,
  })),
  isCorrectFirstTry: false,
  isCorrectFinal: true,
  wrongAttempts: MAX_ANSWER_EVENT_ATTEMPTS + 3,
  isExtraNote: false,
  isMissed: false,
};

describe("boundedAnswerEvent", () => {
  it("caps stored attempts and materializes the clipping flag", () => {
    const bounded = boundedAnswerEvent(event);

    expect(bounded.attempts).toHaveLength(MAX_ANSWER_EVENT_ATTEMPTS);
    expect(bounded.attempts.every((attempt) => typeof attempt.clipping === "boolean")).toBe(true);
    expect(bounded.attempts.at(-1)?.midi).toBe(60 + MAX_ANSWER_EVENT_ATTEMPTS - 1);
  });

  it("preserves a measured clipping value", () => {
    const bounded = boundedAnswerEvent({
      ...event,
      attempts: [{ midi: 61, atMs: 80, isCorrect: false, clipping: true }],
    });

    expect(bounded.attempts[0].clipping).toBe(true);
  });
});
