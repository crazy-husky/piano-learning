import { describe, expect, it } from "vitest";
import {
  buildMobileStaffPageView,
  chunkStaffPageGroupsByMeasure,
  getStaffPageRowIndex,
  getStaffPageRefillCount,
  MOBILE_STAFF_PAGE_NOTE_COUNT,
} from "./staffPageFlow";

describe("measure-aware staff-page rows", () => {
  it("moves a whole measure to the next row when it cannot fit", () => {
    const groups = Array.from({ length: 10 }, (_, index) => `event-${index}`);
    const result = chunkStaffPageGroupsByMeasure(groups, [0, 0, 0, 0, 1, 1, 1, 1, 2, 2], 6);

    expect(result).toEqual({
      rowStartIndices: [0, 4],
      rows: [groups.slice(0, 4), groups.slice(4)],
    });
    expect(getStaffPageRowIndex(result.rowStartIndices, 3)).toBe(0);
    expect(getStaffPageRowIndex(result.rowStartIndices, 4)).toBe(1);
  });

  it("keeps a measure intact even when that measure is wider than the row capacity", () => {
    const groups = Array.from({ length: 7 }, (_, index) => index);
    const result = chunkStaffPageGroupsByMeasure(groups, [0, 0, 0, 0, 0, 0, 1], 4);

    expect(result).toEqual({ rowStartIndices: [0, 6], rows: [groups.slice(0, 6), [6]] });
  });

  it("caps duet rows at three complete measures", () => {
    const groups = Array.from({ length: 16 }, (_, index) => `event-${index}`);
    const measures = groups.map((_, index) => Math.floor(index / 4));
    const result = chunkStaffPageGroupsByMeasure(groups, measures, 24, undefined, 3);

    expect(result.rowStartIndices).toEqual([0, 12]);
    expect(result.rows.map((row) => row.length)).toEqual([12, 4]);
    expect(
      result.rows.map((row) => [
        ...new Set(row.map((event) => Math.floor(Number(event.slice(6)) / 4))),
      ])
    ).toEqual([[0, 1, 2], [3]]);
  });
});

describe("rolling staff-page flow", () => {
  it("refills one row when eight visible notes remain", () => {
    expect(
      getStaffPageRefillCount({ completedSessionCount: 40, nextIndex: 40, plannedNoteCount: 48 })
    ).toBe(24);
  });

  it("does not refill before the eight-note threshold", () => {
    expect(
      getStaffPageRefillCount({ completedSessionCount: 39, nextIndex: 39, plannedNoteCount: 48 })
    ).toBe(0);
  });

  it("limits or skips the final refill for fixed-count sessions", () => {
    expect(
      getStaffPageRefillCount({
        completedSessionCount: 40,
        fixedSessionCount: 60,
        nextIndex: 40,
        plannedNoteCount: 48,
      })
    ).toBe(12);
    expect(
      getStaffPageRefillCount({
        completedSessionCount: 40,
        fixedSessionCount: 48,
        nextIndex: 40,
        plannedNoteCount: 48,
      })
    ).toBe(0);
  });
});

describe("mobile staff-page pagination", () => {
  it("shows one page of eight notes and advances at the page boundary", () => {
    const notes = Array.from({ length: 48 }, (_, index) => `note-${index}`);

    expect(MOBILE_STAFF_PAGE_NOTE_COUNT).toBe(8);
    expect(
      buildMobileStaffPageView({ notes, currentIndex: 7, firstNoteOffset: 0, completedCount: 7 })
    ).toMatchObject({
      currentPage: 1,
      noteIndexInPage: 7,
      notes: notes.slice(0, 8),
      totalPages: 6,
    });
    expect(
      buildMobileStaffPageView({ notes, currentIndex: 8, firstNoteOffset: 0, completedCount: 8 })
    ).toMatchObject({
      currentPage: 2,
      noteIndexInPage: 0,
      notes: notes.slice(8, 16),
      totalPages: 6,
    });
  });

  it("keeps page numbers stable after the rolling queue drops completed notes", () => {
    const notes = Array.from({ length: 48 }, (_, index) => `note-${index + 24}`);
    const view = buildMobileStaffPageView({
      notes,
      currentIndex: 16,
      firstNoteOffset: 24,
      completedCount: 16,
    });

    expect(view).toMatchObject({
      currentPage: 6,
      noteIndexInPage: 0,
      notes: notes.slice(16, 24),
      totalPages: 9,
    });
  });

  it("uses the configured count and supports a partial final page", () => {
    const notes = Array.from({ length: 17 }, (_, index) => `note-${index}`);
    const view = buildMobileStaffPageView({
      notes,
      currentIndex: 16,
      firstNoteOffset: 0,
      completedCount: 17,
      fixedSessionCount: 17,
    });

    expect(view).toMatchObject({
      completedCount: 1,
      currentPage: 3,
      noteIndexInPage: 0,
      notes: ["note-16"],
      totalPages: 3,
    });
  });

  it("grows the displayed total from generated notes in open-ended practice", () => {
    const view = buildMobileStaffPageView({
      notes: Array.from({ length: 72 }, (_, index) => index),
      currentIndex: 40,
      firstNoteOffset: 0,
      completedCount: 40,
    });

    expect(view).toMatchObject({ currentPage: 6, totalPages: 9 });
  });
});
