import { describe, expect, it } from "vitest";
import type {
  AnswerEvent,
  DuetPracticeLevel,
  PracticeSessionRecord,
  StaffRecallRunRecord,
} from "../../domain/types";
import { evaluateLearningProgress } from "./learningProgress";

function makeEvent(overrides: Partial<AnswerEvent> = {}): AnswerEvent {
  return {
    id: "event-1",
    dataSetId: "set-a",
    sessionId: "session-1",
    eventIndex: 0,
    occurredAt: "2026-11-01T00:00:00.000Z",
    mode: "free-practice",
    inputMode: "midi",
    deviceInfo: "Mac",
    attempts: [],
    isCorrectFirstTry: true,
    isCorrectFinal: true,
    wrongAttempts: 0,
    isExtraNote: false,
    isMissed: false,
    responseTimeMs: 1000,
    ...overrides,
  };
}

function makeRecallRun(id: string): StaffRecallRunRecord {
  return {
    id,
    schemaVersion: 1,
    answerSetKey: "same-range",
    targetNoteIds: ["C4", "D4"],
    columnOrder: ["C", "D", "E", "F", "G", "A", "B"],
    columnActiveMs: { C: 1, D: 1, E: 1, F: 1, G: 1, A: 1, B: 1 },
    startedAt: "2026-11-01T00:00:00.000Z",
    endedAt: "2026-11-01T00:01:00.000Z",
  };
}

describe("evaluateLearningProgress", () => {
  it("uses completed same-range recall runs for Level 1", () => {
    const progress = evaluateLearningProgress({
      answerEvents: [],
      staffRecallRuns: [makeRecallRun("run-1"), makeRecallRun("run-2")],
      practiceSessions: [],
    });

    expect(progress[1].status).toBe("mastered");
  });

  it("applies the Level 2 accuracy and reaction-time graduation boundary", () => {
    const events = Array.from({ length: 20 }, (_, index) =>
      makeEvent({
        id: `event-${index}`,
        eventIndex: index,
        isCorrectFirstTry: index < 18,
        wrongAttempts: index < 18 ? 0 : 1,
        responseTimeMs: 1200,
      })
    );
    const progress = evaluateLearningProgress({
      answerEvents: events,
      staffRecallRuns: [],
      practiceSessions: [],
    });

    expect(progress[2].status).toBe("mastered");
    expect(progress[2].detail).toContain("90%");
  });

  it("does not graduate Level 2 when reaction-time samples are missing", () => {
    const events = Array.from({ length: 20 }, (_, index) =>
      makeEvent({ id: `event-${index}`, eventIndex: index, responseTimeMs: undefined })
    );
    const progress = evaluateLearningProgress({
      answerEvents: events,
      staffRecallRuns: [],
      practiceSessions: [],
    });

    expect(progress[2].status).toBe("in-progress");
  });

  it("requires both Level 3 directions to meet the standard", () => {
    const events = [
      ...Array.from({ length: 20 }, (_, index) =>
        makeEvent({ id: `staff-${index}`, mode: "staff-to-name", isCorrectFirstTry: index < 18 })
      ),
      ...Array.from({ length: 19 }, (_, index) =>
        makeEvent({ id: `key-${index}`, mode: "name-to-key" })
      ),
    ];
    const progress = evaluateLearningProgress({
      answerEvents: events,
      staffRecallRuns: [],
      practiceSessions: [],
    });

    expect(progress[3].status).toBe("in-progress");
  });

  it("tracks pre-reading buffers and all six duet levels separately", () => {
    const buffers = [1, 2] as const;
    const preReadingEvents = buffers.flatMap((buffer) =>
      Array.from({ length: 20 }, (_, index) =>
        makeEvent({
          id: `pre-${buffer}-${index}`,
          sessionId: `pre-session-${buffer}`,
          mode: "pre-reading",
          isCorrectFirstTry: index < 17,
        })
      )
    );
    const duetLevels: readonly DuetPracticeLevel[] = [
      "level-1",
      "level-2",
      "level-3",
      "level-4",
      "level-5",
      "level-6",
    ];
    const duetEvents = duetLevels.flatMap((duetLevel) =>
      Array.from({ length: 10 }, (_, index) =>
        makeEvent({
          id: `${duetLevel}-${index}`,
          mode: "free-practice",
          duetLevel,
          duetTargetNoteIds: ["C4", "C3"],
          isCorrectFirstTry: index < 8,
        })
      )
    );
    const sessions = buffers.map(
      (buffer) =>
        ({
          id: `pre-session-${buffer}`,
          schemaVersion: 5,
          startSnapshot: { practiceConfig: { preReadingBufferSize: buffer } },
        }) as PracticeSessionRecord
    );
    const progress = evaluateLearningProgress({
      answerEvents: [...preReadingEvents, ...duetEvents],
      staffRecallRuns: [],
      practiceSessions: sessions,
    });

    expect(progress[5].status).toBe("mastered");
    expect(progress[6].status).toBe("mastered");
  });
});
