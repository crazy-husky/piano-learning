import { describe, expect, it } from "vitest";
import { getNotesForGroups } from "../../../domain/notes";
import { getTargetMidiNoteNumber } from "../../../domain/answerInput";
import type { DuetPracticeLevel } from "../../../domain/types";
import {
  createDuetPracticePage,
  DUET_PRACTICE_CURRICULUM_VERSION,
  normalizeDuetPracticeLevel,
} from "./duetPractice";
import { getQuarterNoteBeats } from "./staffPageNotation";
import { chunkStaffPageGroupsByMeasure, DUET_DESKTOP_STAFF_PAGE_NOTE_COUNT } from "./staffPageFlow";

const pool = getNotesForGroups(["C3-B3", "C4-B4"], false);
const levels: DuetPracticeLevel[] = [
  "level-1",
  "level-2",
  "level-3",
  "level-4",
  "level-5",
  "level-6",
];

function getStaffInterval(
  page: ReturnType<typeof createDuetPracticePage>,
  index: number,
  staff: "treble" | "bass"
): { start: number; end: number } | undefined {
  const notes = page.events[index]![staff === "treble" ? "high" : "low"];
  if (notes.length === 0) return undefined;
  const duration =
    page.rhythm.staffNoteDurations?.[index]?.[staff] ?? page.rhythm.durations[index]!;
  const start = page.rhythm.onsets[index]!;
  return { start, end: start + getQuarterNoteBeats(duration) };
}

function hasStaffRestInMeasure(
  page: ReturnType<typeof createDuetPracticePage>,
  measure: number,
  staff: "treble" | "bass"
): boolean {
  const intervals = page.rhythm.measures.flatMap((candidate, index) => {
    if (candidate !== measure) return [];
    const interval = getStaffInterval(page, index, staff);
    return interval
      ? [{ start: interval.start % 4, end: (interval.start % 4) + (interval.end - interval.start) }]
      : [];
  });
  let cursor = 0;
  for (const interval of intervals.sort((left, right) => left.start - right.start)) {
    if (interval.start > cursor + 0.001) return true;
    cursor = Math.max(cursor, interval.end);
  }
  return cursor < 4 - 0.001;
}

function assertBreathAndNoteCap(page: ReturnType<typeof createDuetPracticePage>): void {
  const measures = [...new Set(page.rhythm.measures)];
  measures.forEach((measure) => {
    const indices = page.rhythm.measures.flatMap((candidate, index) =>
      candidate === measure ? [index] : []
    );
    const noteCount = indices.reduce(
      (total, index) => total + page.events[index]!.high.length + page.events[index]!.low.length,
      0
    );
    expect(noteCount).toBeLessThanOrEqual(12);

    const hasLongNote = indices.some((index) =>
      (["treble", "bass"] as const).some((staff) => {
        const interval = getStaffInterval(page, index, staff);
        return interval !== undefined && interval.end - interval.start >= 2;
      })
    );
    const hasRest =
      hasStaffRestInMeasure(page, measure, "treble") ||
      hasStaffRestInMeasure(page, measure, "bass");
    const fullySynchronizedMeasure = indices.every(
      (index) => page.events[index]!.high.length > 0 && page.events[index]!.low.length > 0
    );
    expect(hasLongNote || hasRest || fullySynchronizedMeasure).toBe(true);
  });
}

describe("createDuetPracticePage", () => {
  it("generates complete four-beat templates for all six levels", () => {
    levels.forEach((level) => {
      const page = createDuetPracticePage(pool, level, 8);
      expect(page.events.length).toBeGreaterThanOrEqual(8);
      expect(page.notes).toHaveLength(page.events.length);
      expect(page.noteGroups).toHaveLength(page.events.length);
      expect(page.rhythm.onsets).toHaveLength(page.events.length);
      expect(page.rhythm.durations).toHaveLength(page.events.length);
      expect(page.rhythm.staffNoteDurations).toHaveLength(page.events.length);
      expect(page.rhythm.endBeat % 4).toBe(0);
    });
  });

  it("Level 1 alternates single notes by hand without overlapping note durations", () => {
    const page = createDuetPracticePage(pool, "level-1", 24);

    expect(page.events.every((event) => event.high.length + event.low.length === 1)).toBe(true);
    expect(
      page.rhythm.durations.every((duration) => ["whole", "half", "quarter"].includes(duration))
    ).toBe(true);

    const trebleIntervals = page.events.flatMap((_, index) => {
      const interval = getStaffInterval(page, index, "treble");
      return interval ? [interval] : [];
    });
    const bassIntervals = page.events.flatMap((_, index) => {
      const interval = getStaffInterval(page, index, "bass");
      return interval ? [interval] : [];
    });
    trebleIntervals.forEach((treble) =>
      bassIntervals.forEach((bass) =>
        expect(treble.end <= bass.start || bass.end <= treble.start).toBe(true)
      )
    );
  });

  it("balances each Level 1 hand's note bags and avoids repeats across bag boundaries", () => {
    const page = createDuetPracticePage(pool, "level-1", 700, {
      seed: "balanced-note-bags",
    });
    const notesByStaff = {
      treble: page.events.flatMap((event) => event.high.map((note) => note.noteName)),
      bass: page.events.flatMap((event) => event.low.map((note) => note.noteName)),
    };
    const availableNotes = ["C", "D", "E", "F", "G", "A", "B"].sort();

    (Object.values(notesByStaff) as (typeof availableNotes)[]).forEach((notes) => {
      for (
        let start = 0;
        start + availableNotes.length <= notes.length;
        start += availableNotes.length
      ) {
        const bag = notes.slice(start, start + availableNotes.length).sort();
        expect(bag).toEqual(availableNotes);
        if (start > 0) expect(notes[start - 1]).not.toBe(notes[start]);
      }
    });
  });

  it("varies Level 1 starting hands and weights quarter notes above half rests", () => {
    const page = createDuetPracticePage(pool, "level-1", 64, { seed: "rhythm-variety-session" });
    const measures = [...new Set(page.rhythm.measures)];
    const measureDurations = measures.map((measure) =>
      page.rhythm.measures.flatMap((candidate, index) =>
        candidate === measure ? [page.rhythm.durations[index]!] : []
      )
    );
    const firstStaffByMeasure = measures.map((measure) => {
      const firstIndex = page.rhythm.measures.findIndex((candidate) => candidate === measure);
      return page.events[firstIndex]!.high.length > 0 ? "treble" : "bass";
    });
    const halfRestMeasureCount = measures.filter((measure) =>
      (["treble", "bass"] as const).some((staff) => {
        const intervals = page.rhythm.measures.flatMap((candidate, index) => {
          if (candidate !== measure) return [];
          const interval = getStaffInterval(page, index, staff);
          return interval
            ? [
                {
                  start: interval.start % 4,
                  end: (interval.start % 4) + (interval.end - interval.start),
                },
              ]
            : [];
        });
        let cursor = 0;
        const rests: number[] = [];
        intervals
          .sort((left, right) => left.start - right.start)
          .forEach((interval) => {
            if (interval.start > cursor) rests.push(interval.start - cursor);
            cursor = Math.max(cursor, interval.end);
          });
        if (cursor < 4) rests.push(4 - cursor);
        return rests.some((duration) => Math.abs(duration - 2) < 0.001);
      })
    ).length;

    expect(new Set(measureDurations.map((durations) => durations.join(","))).size).toBeGreaterThan(
      1
    );
    expect(new Set(firstStaffByMeasure)).toEqual(new Set(["treble", "bass"]));
    expect(halfRestMeasureCount).toBeGreaterThan(0);
    expect(halfRestMeasureCount).toBeLessThan(measures.length / 2);

    const rows = chunkStaffPageGroupsByMeasure(
      page.events,
      page.rhythm.measures,
      DUET_DESKTOP_STAFF_PAGE_NOTE_COUNT
    );
    const firstTwoRowDurations = rows.rowStartIndices
      .slice(0, 2)
      .map((startIndex, rowIndex) =>
        page.rhythm.durations.slice(startIndex, startIndex + rows.rows[rowIndex]!.length)
      );
    expect(firstTwoRowDurations[0]).not.toEqual(firstTwoRowDurations[1]);
  });

  it("Level 2 follows the 70/30 one-or-two bass-note distribution without adjacent doubles", () => {
    const measureCount = 1_000;
    const page = createDuetPracticePage(pool, "level-2", measureCount * 4, {
      measureCount,
      seed: "level-two-sync-distribution",
    });
    const synchronizedCounts = getSynchronizedCountsByMeasure(page);
    const oneSyncMeasures = synchronizedCounts.filter((count) => count === 1).length;

    expect(synchronizedCounts).toHaveLength(measureCount);
    expect(page.events.every((event) => event.high.length === 1)).toBe(true);
    expect(oneSyncMeasures).toBeGreaterThanOrEqual(660);
    expect(oneSyncMeasures).toBeLessThanOrEqual(740);
    [...new Set(page.rhythm.measures)].forEach((measure) => {
      const lowBeats = page.rhythm.measures.flatMap((candidate, index) =>
        candidate === measure && page.events[index]!.low.length > 0
          ? [page.rhythm.onsets[index]! % 4]
          : []
      );
      if (lowBeats.length === 2) {
        expect(lowBeats[1]! - lowBeats[0]!).toBeGreaterThan(1);
      }
    });
  });

  it("Level 3 follows the 20/50/20/10 one-to-four sync distribution", () => {
    const measureCount = 1_000;
    const page = createDuetPracticePage(pool, "level-3", measureCount * 4, {
      measureCount,
      seed: "level-three-sync-distribution",
    });
    const synchronizedCounts = getSynchronizedCountsByMeasure(page);
    const distribution = [1, 2, 3, 4].map(
      (count) => synchronizedCounts.filter((actual) => actual === count).length
    );

    expect(synchronizedCounts).toHaveLength(measureCount);
    expect(page.events.every((event) => event.high.length === 1)).toBe(true);
    expect(distribution[0]).toBeGreaterThanOrEqual(160);
    expect(distribution[0]).toBeLessThanOrEqual(240);
    expect(distribution[1]).toBeGreaterThanOrEqual(430);
    expect(distribution[1]).toBeLessThanOrEqual(570);
    expect(distribution[2]).toBeGreaterThanOrEqual(160);
    expect(distribution[2]).toBeLessThanOrEqual(240);
    expect(distribution[3]).toBeGreaterThanOrEqual(50);
    expect(distribution[3]).toBeLessThanOrEqual(150);
  });

  it("Level 4 uses a left-hand block triad under a right-hand melody", () => {
    const page = createDuetPracticePage(pool, "level-4", 4);

    expect(page.events[0]!.high).toHaveLength(1);
    expect(page.events[0]!.low).toHaveLength(3);
    expect(page.rhythm.staffNoteDurations?.[0]?.bass).toBe("whole");
    expect(page.noteGroups[0]!.filter((note) => note.staff === "bass")).toHaveLength(3);
  });

  it("Level 5 keeps a left-hand chord sounding under an even eighth-note melody", () => {
    const page = createDuetPracticePage(pool, "level-5", 8);
    const trebleMidis = page.events.map((event) => getTargetMidiNoteNumber(event.high[0]!));

    expect(page.rhythm.onsets).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(page.events[0]!.low).toHaveLength(3);
    expect(page.events.slice(1).every((event) => event.low.length === 0)).toBe(true);
    expect(page.rhythm.staffNoteDurations?.[0]?.bass).toBe("whole");
    expect(
      trebleMidis.every(
        (midi, index) => index === 0 || Math.abs(midi - trebleMidis[index - 1]!) <= 2
      )
    ).toBe(true);
    expect(groupNoteCount(page, 0, 8)).toBe(11);
  });

  it("Level 6 combines a right-hand melody with a left-hand broken triad", () => {
    const page = createDuetPracticePage(pool, "level-6", 7);

    expect(page.events.filter((event) => event.low.length > 0)).toHaveLength(4);
    expect(page.events.filter((event) => event.high.length > 0)).toHaveLength(7);
    expect(page.events.at(-1)!.high).toHaveLength(1);
    expect(page.rhythm.onsets.at(-1)).toBe(3);
    expect(hasStaffRestInMeasure(page, 0, "treble")).toBe(true);
  });

  it("adds dotted rhythm only in the fourth measure of each phrase", () => {
    const page = createDuetPracticePage(pool, "level-5", 64, { allowDottedRhythms: true });
    const dottedMeasures = new Set(
      page.rhythm.measures.filter((_, index) => page.rhythm.durations[index]!.startsWith("dotted"))
    );

    expect([...dottedMeasures]).toEqual([3, 7]);
  });

  it("keeps every measure breathable and within the twelve-note cap", () => {
    levels.forEach((level) => {
      [false, true].forEach((allowDottedRhythms) => {
        const page = createDuetPracticePage(pool, level, 32, { allowDottedRhythms });
        assertBreathAndNoteCap(page);
      });
    });
  });

  it("continues Level 1 hand alternation when a new staff-page buffer starts mid-phrase", () => {
    const whole = createDuetPracticePage(pool, "level-1", 20);
    const appended = createDuetPracticePage(pool, "level-1", 6, {
      startBeat: whole.rhythm.endBeat,
    });
    const previousLastStaff = whole.events.at(-1)!.high.length > 0 ? "treble" : "bass";
    const nextFirstStaff = appended.events[0]!.high.length > 0 ? "treble" : "bass";

    expect(nextFirstStaff).not.toBe(previousLastStaff);
  });
});

describe("duet curriculum migration", () => {
  it("preserves Level 1 and 2 in the new curriculum version", () => {
    expect(normalizeDuetPracticeLevel("level-1", DUET_PRACTICE_CURRICULUM_VERSION)).toBe("level-1");
    expect(normalizeDuetPracticeLevel("level-2", DUET_PRACTICE_CURRICULUM_VERSION)).toBe("level-2");
    expect(normalizeDuetPracticeLevel("level-6", DUET_PRACTICE_CURRICULUM_VERSION)).toBe("level-6");
  });

  it("maps the previous curriculum to equivalent content in the new level order", () => {
    expect(normalizeDuetPracticeLevel("level-3")).toBe("level-5");
    expect(normalizeDuetPracticeLevel("level-4")).toBe("level-6");
    expect(normalizeDuetPracticeLevel("level-5")).toBe("level-4");
    expect(normalizeDuetPracticeLevel("sync")).toBe("level-2");
    expect(normalizeDuetPracticeLevel("parallel")).toBe("level-3");
    expect(normalizeDuetPracticeLevel("independent")).toBe("level-4");
  });
});

function groupNoteCount(
  page: ReturnType<typeof createDuetPracticePage>,
  start: number,
  end: number
): number {
  return page.events
    .slice(start, end)
    .reduce((count, event) => count + event.high.length + event.low.length, 0);
}

function getSynchronizedCountsByMeasure(page: ReturnType<typeof createDuetPracticePage>): number[] {
  return [...new Set(page.rhythm.measures)].map((measure) =>
    page.rhythm.measures.reduce(
      (count, candidate, index) =>
        candidate === measure &&
        page.events[index]!.high.length > 0 &&
        page.events[index]!.low.length > 0
          ? count + 1
          : count,
      0
    )
  );
}
