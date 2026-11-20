import { BarlineType, Formatter, Renderer, Stave, StaveConnector, StaveNote, Voice } from "vexflow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPageThemeColor, useNightMode } from "../../../shared/appearance/pageAppearance";
import {
  getChordMajorKey,
  getVexChordNoteKey,
  type ChordNoteDuration,
  type ChordPrompt,
} from "../logic/chordTraining";

type ChordScoreEventFeedback = "correct" | "early" | "late" | "wrong" | "missed";

const SCORE_ROW_BASE_HEIGHT = 190;
const SCORE_ROW_BOTTOM_PADDING = 20;
const SCORE_MARKER_TIP_OFFSET = 15;
const SCORE_MARKER_HEIGHT = 8;
const SCORE_MARKER_CLEARANCE = SCORE_MARKER_TIP_OFFSET + SCORE_MARKER_HEIGHT + 6;
const SCORE_CURSOR_WIDTH = 14;
const SCORE_STAFF_STEP_HEIGHT = 5;
const SCORE_VEXFLOW_STAVE_HEADROOM = 40; // VexFlow's default four spaces above the staff.
const SCORE_GRAND_STAFF_BOTTOM_OFFSET = 164; // 84px grand-staff gap plus the bass staff height.
const PHONE_MEASURE_COUNT = 1;
const TABLET_MEASURE_COUNT = 2;
const DESKTOP_MEASURE_COUNT = 3;
const WIDE_MEASURE_COUNT = 4;
const DURATION_BEATS: Record<ChordNoteDuration, number> = {
  "8": 0.5,
  q: 1,
  h: 2,
  w: 4,
};
const REST_DURATIONS: readonly { beats: number; duration: ChordNoteDuration }[] = [
  { beats: 4, duration: "w" },
  { beats: 2, duration: "h" },
  { beats: 1, duration: "q" },
  { beats: 0.5, duration: "8" },
];

function getMeasureCount(width: number): number {
  if (width < 560) return PHONE_MEASURE_COUNT;
  if (width < 900) return TABLET_MEASURE_COUNT;
  if (width < 1200) return DESKTOP_MEASURE_COUNT;
  return WIDE_MEASURE_COUNT;
}

function getChordStaffPromptLabel(questionCount: number, activeQuestionIndex: number): string {
  return `和弦弹奏连续谱面，已生成 ${questionCount} 组和弦，当前第 ${activeQuestionIndex + 1} 组。每组和弦为一道题。`;
}

function getChordStaffTopPadding(prompts: readonly ChordPrompt[]): number {
  const trebleTopDiatonicIndex = 5 * 7 + 3; // F5, the top line of the treble staff.
  const highestStepAboveTop = prompts.reduce((highestStep, prompt) => {
    if ((prompt.notes[0]?.midi ?? 60) < 60) return highestStep;
    return prompt.notes.reduce((promptHighestStep, note) => {
      const diatonicIndex = note.octave * 7 + "CDEFGAB".indexOf(note.letter);
      return Math.max(promptHighestStep, diatonicIndex - trebleTopDiatonicIndex);
    }, highestStep);
  }, 0);
  const spaceForMarker =
    SCORE_MARKER_CLEARANCE +
    highestStepAboveTop * SCORE_STAFF_STEP_HEIGHT -
    SCORE_VEXFLOW_STAVE_HEADROOM;
  return Math.max(0, spaceForMarker);
}

function getScoreRowLayouts(
  prompts: readonly ChordPrompt[],
  measuresPerRow: number
): Array<{ startIndex: number; topPadding: number; height: number }> {
  const layouts: Array<{ startIndex: number; topPadding: number; height: number }> = [];
  for (let startIndex = 0; startIndex < prompts.length; startIndex += measuresPerRow) {
    const rowPrompts = prompts.slice(startIndex, startIndex + measuresPerRow);
    const topPadding = getChordStaffTopPadding(rowPrompts);
    layouts.push({
      startIndex,
      topPadding,
      height: topPadding + SCORE_GRAND_STAFF_BOTTOM_OFFSET + SCORE_ROW_BOTTOM_PADDING,
    });
  }
  return layouts;
}

function findRowAtOffset(rowLayouts: readonly { height: number }[], scrollTop: number): number {
  let offset = 0;
  for (let rowIndex = 0; rowIndex < rowLayouts.length; rowIndex += 1) {
    offset += rowLayouts[rowIndex]!.height;
    if (offset > scrollTop) return rowIndex;
  }
  return Math.max(0, rowLayouts.length - 1);
}

function getMeasureRests(prompt: ChordPrompt): ChordNoteDuration[] {
  const usedBeats = prompt.noteEvents.reduce(
    (total, event) => total + DURATION_BEATS[event.duration],
    0
  );
  let remainingBeats = Math.max(0, 4 - usedBeats);
  const rests: ChordNoteDuration[] = [];
  while (remainingBeats >= 0.5) {
    const rest = REST_DURATIONS.find(({ beats }) => beats <= remainingBeats);
    if (!rest) break;
    rests.push(rest.duration);
    remainingBeats -= rest.beats;
  }
  return rests;
}

export function ChordStaffPage({
  prompts,
  activeQuestionIndex,
  activeEventIndex,
  eventFeedbackByQuestion,
  highlightRoot = true,
}: {
  prompts: readonly ChordPrompt[];
  activeQuestionIndex: number;
  activeEventIndex: number;
  eventFeedbackByQuestion: readonly (readonly (ChordScoreEventFeedback | undefined)[])[];
  highlightRoot?: boolean;
}): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const [measureCount, setMeasureCount] = useState(DESKTOP_MEASURE_COUNT);
  const [renderedRows, setRenderedRows] = useState({ start: 0, end: 6 });
  const isNightMode = useNightMode();
  const rowLayouts = useMemo(
    () => getScoreRowLayouts(prompts, measureCount),
    [measureCount, prompts]
  );
  const rowOffsets = useMemo(
    () =>
      rowLayouts.reduce<number[]>(
        (offsets, row) => {
          offsets.push(offsets[offsets.length - 1]! + row.height);
          return offsets;
        },
        [0]
      ),
    [rowLayouts]
  );

  useEffect(() => {
    const frame = frameRef.current;
    const target = targetRef.current;
    if (!frame || !target || prompts.length === 0) return undefined;

    const render = (): void => {
      const width = Math.max(320, frame.clientWidth || 900);
      const detectedMeasureCount = getMeasureCount(width);
      if (measureCount !== detectedMeasureCount) {
        setMeasureCount(detectedMeasureCount);
        return;
      }
      target.innerHTML = "";
      const measuresPerRow = measureCount;
      const leftInset = width < 560 ? 76 : 94;
      const rightInset = 16;
      const measureWidth = (width - leftInset - rightInset) / measuresPerRow;
      const rowCount = rowLayouts.length;
      const firstRenderedRow = Math.min(renderedRows.start, Math.max(0, rowCount - 1));
      const lastRenderedRow = Math.min(rowCount, Math.max(firstRenderedRow + 1, renderedRows.end));
      const height = rowOffsets[lastRenderedRow]! - rowOffsets[firstRenderedRow]! + 20;
      const renderer = new Renderer(target, Renderer.Backends.SVG);
      renderer.resize(width, height);
      const context = renderer.getContext();
      const staffInk = getPageThemeColor("--notation-staff", "#766b5f");
      const ink = getPageThemeColor("--notation-ink", "#211c18");
      const rootInk = getPageThemeColor("--notation-root", "#1769aa");
      const activeInk = getPageThemeColor("--notation-active", "#256f67");
      const errorInk = getPageThemeColor("--notation-error", "#c84c3d");
      const correctInk = getPageThemeColor("--notation-correct", "#2f8f5f");
      const warningInk = getPageThemeColor("--warning", "#d88c24");
      context.setFillStyle(ink);
      context.setStrokeStyle(staffInk);

      for (let rowIndex = firstRenderedRow; rowIndex < lastRenderedRow; rowIndex += 1) {
        const rowStartIndex = rowLayouts[rowIndex]!.startIndex;
        const rowPrompts = prompts.slice(rowStartIndex, rowStartIndex + measuresPerRow);
        const rowLayout = rowLayouts[rowIndex]!;
        const rowTop = rowOffsets[rowIndex]! - rowOffsets[firstRenderedRow]!;
        const trebleY = rowTop + rowLayout.topPadding;
        const bassY = trebleY + 84;
        let rowTrebleTopLineY: number | undefined;
        let rowHighestTrebleNoteHeadY = Number.POSITIVE_INFINITY;
        let activeCursorX: number | undefined;
        let activeCursorBottomY: number | undefined;

        rowPrompts.forEach((prompt, measureIndex) => {
          const questionIndex = rowStartIndex + measureIndex;
          const x = leftInset + measureIndex * measureWidth;
          const isFirstMeasure = measureIndex === 0;
          const isActiveMeasure = questionIndex === activeQuestionIndex;
          const treble = new Stave(x, trebleY, measureWidth);
          const bass = new Stave(x, bassY, measureWidth);
          if (isFirstMeasure) {
            const keySignature = getChordMajorKey(prompt.chord.keyId).vexKey;
            treble.addClef("treble").addKeySignature(keySignature).addTimeSignature("4/4");
            bass.addClef("bass").addKeySignature(keySignature).addTimeSignature("4/4");
          } else {
            treble.setBegBarType(BarlineType.NONE);
            bass.setBegBarType(BarlineType.NONE);
          }
          treble.setEndBarType(BarlineType.SINGLE);
          bass.setEndBarType(BarlineType.SINGLE);

          if (isActiveMeasure) {
            context.setFillStyle(getPageThemeColor("--accent-soft", "#294741"));
            context.fillRect(
              x + 1,
              treble.getYForLine(0) - 8,
              measureWidth - 1,
              bass.getYForLine(4) - treble.getYForLine(0) + 16
            );
            context.setFillStyle(ink);
          }

          treble.setContext(context).draw();
          bass.setContext(context).draw();
          rowTrebleTopLineY = treble.getYForLine(0);
          if (isFirstMeasure) {
            new StaveConnector(treble, bass).setType("brace").setContext(context).draw();
          }

          const clef = (prompt.notes[0]?.midi ?? 60) < 60 ? "bass" : "treble";
          const targetStave = clef === "bass" ? bass : treble;
          const activeMeasureEventIndex = isActiveMeasure
            ? Math.min(activeEventIndex, prompt.noteEvents.length - 1)
            : -1;
          const scoreNotes = prompt.noteEvents.map(({ notes, duration }, eventIndex) => {
            const scoreNote = new StaveNote({
              clef,
              duration,
              keys: notes.map(getVexChordNoteKey),
            }).setStave(targetStave);
            const eventState = eventFeedbackByQuestion[questionIndex]?.[eventIndex];
            const eventInk =
              eventState === "wrong" || eventState === "missed"
                ? errorInk
                : eventState === "early" || eventState === "late"
                  ? warningInk
                  : eventState === "correct"
                    ? correctInk
                    : isActiveMeasure && eventIndex === activeMeasureEventIndex
                      ? activeInk
                      : undefined;
            scoreNote.setStyle({ fillStyle: eventInk ?? ink, strokeStyle: eventInk ?? ink });
            notes.forEach((note, noteIndex) => {
              const isRoot =
                highlightRoot &&
                `${note.letter}${note.accidental === 1 ? "♯" : note.accidental === -1 ? "♭" : ""}` ===
                  prompt.chord.rootName;
              const noteInk = eventInk ?? (isRoot ? rootInk : ink);
              scoreNote.setKeyStyle(noteIndex, { fillStyle: noteInk, strokeStyle: noteInk });
            });
            scoreNote.setLedgerLineStyle({ fillStyle: staffInk, strokeStyle: staffInk });
            return scoreNote;
          });
          const restNotes = getMeasureRests(prompt).map((duration) =>
            new StaveNote({
              clef,
              duration: `${duration}r`,
              keys: [clef === "treble" ? "b/4" : "d/3"],
            }).setStave(targetStave)
          );

          const voice = new Voice({ numBeats: 4, beatValue: 4 })
            .setMode(Voice.Mode.SOFT)
            .addTickables([...scoreNotes, ...restNotes]);
          const noteStartX = targetStave.getNoteStartX();
          const leadingSpace = Math.max(0, noteStartX - x);
          const noteAreaWidth = Math.max(40, measureWidth - leadingSpace - 10);
          new Formatter().joinVoices([voice]).format([voice], noteAreaWidth, { context });
          voice.draw(context, targetStave);

          if (clef === "treble") {
            scoreNotes.forEach((scoreNote) => {
              scoreNote
                .getYs()
                .filter(Number.isFinite)
                .forEach((noteHeadY) => {
                  rowHighestTrebleNoteHeadY = Math.min(rowHighestTrebleNoteHeadY, noteHeadY);
                });
            });
          }

          if (isActiveMeasure) {
            const activeNote = scoreNotes[activeMeasureEventIndex];
            activeCursorX = activeNote
              ? activeNote.getAbsoluteX() + activeNote.getWidth() / 2
              : x + leadingSpace;
            activeCursorBottomY = bass.getYForLine(4) + 4;
            const cursorTopY = treble.getYForLine(0) - 4;
            context.setFillStyle(
              getPageThemeColor("--notation-error-fill", "rgba(200, 76, 61, 0.32)")
            );
            context.fillRect(
              activeCursorX - SCORE_CURSOR_WIDTH / 2,
              cursorTopY,
              SCORE_CURSOR_WIDTH,
              activeCursorBottomY - cursorTopY
            );
            context.setFillStyle(ink);
          }
        });

        if (
          activeCursorX !== undefined &&
          activeCursorBottomY !== undefined &&
          rowTrebleTopLineY !== undefined
        ) {
          const anchorY = Math.min(rowHighestTrebleNoteHeadY, rowTrebleTopLineY);
          const tipY = anchorY - SCORE_MARKER_TIP_OFFSET;
          const baseY = tipY - SCORE_MARKER_HEIGHT;
          context.setFillStyle(getPageThemeColor("--danger", "#d84a50"));
          context.beginPath();
          context.moveTo(activeCursorX - 5, baseY);
          context.lineTo(activeCursorX + 5, baseY);
          context.lineTo(activeCursorX, tipY);
          context.closePath();
          context.fill();
          context.setStrokeStyle(staffInk);
          context.setFillStyle(ink);
        }
      }

      const svg = target.querySelector("svg");
      if (svg) {
        svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
        svg.style.width = "100%";
        svg.style.height = "auto";
      }
    };

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [
    activeEventIndex,
    activeQuestionIndex,
    eventFeedbackByQuestion,
    highlightRoot,
    isNightMode,
    renderedRows,
    prompts,
    measureCount,
    rowLayouts,
    rowOffsets,
  ]);

  const updateRenderedRows = useCallback((): void => {
    const frame = frameRef.current;
    if (!frame) return;
    const rowCount = rowLayouts.length;
    const visibleRows = Math.max(4, Math.ceil(frame.clientHeight / SCORE_ROW_BASE_HEIGHT) + 2);
    const start = Math.max(0, findRowAtOffset(rowLayouts, frame.scrollTop) - 1);
    const end = Math.min(rowCount, start + visibleRows);
    setRenderedRows((current) =>
      current.start === start && current.end === end ? current : { start, end }
    );
  }, [rowLayouts]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const activeRow = Math.floor(activeQuestionIndex / measureCount);
    if (activeRow < rowLayouts.length) {
      const rowTop = rowOffsets[activeRow]!;
      const rowBottom = rowOffsets[activeRow + 1] ?? rowTop + SCORE_ROW_BASE_HEIGHT;
      let targetScrollTop = frame.scrollTop;
      if (rowTop < frame.scrollTop) {
        targetScrollTop = Math.max(0, rowTop - 12);
      } else if (rowBottom > frame.scrollTop + frame.clientHeight) {
        targetScrollTop = Math.max(0, rowBottom - frame.clientHeight + 12);
      }

      if (targetScrollTop !== frame.scrollTop) {
        const visibleRows = Math.max(4, Math.ceil(frame.clientHeight / SCORE_ROW_BASE_HEIGHT) + 2);
        const start = Math.max(0, findRowAtOffset(rowLayouts, targetScrollTop) - 1);
        const end = Math.min(rowLayouts.length, start + visibleRows);
        setRenderedRows((current) =>
          current.start === start && current.end === end ? current : { start, end }
        );
        frame.scrollTo({ top: targetScrollTop, behavior: "smooth" });
        return;
      }
    }
    updateRenderedRows();
  }, [
    activeQuestionIndex,
    measureCount,
    prompts.length,
    rowLayouts,
    rowOffsets,
    updateRenderedRows,
  ]);

  const totalRows = rowLayouts.length;
  const visibleStart = Math.min(renderedRows.start, Math.max(0, totalRows - 1));
  const visibleEnd = Math.min(totalRows, Math.max(visibleStart + 1, renderedRows.end));
  const totalHeight = rowOffsets[totalRows]!;
  const visibleTop = rowOffsets[visibleStart]!;
  const visibleBottom = rowOffsets[visibleEnd]!;

  return (
    <div
      aria-label={getChordStaffPromptLabel(prompts.length, activeQuestionIndex)}
      className="chord-training-score-page"
      ref={frameRef}
      role="img"
      onScroll={updateRenderedRows}
    >
      <div aria-hidden="true" style={{ height: visibleTop }} />
      <div className="chord-training-score-renderer" ref={targetRef} />
      <div aria-hidden="true" style={{ height: totalHeight - visibleBottom }} />
    </div>
  );
}
