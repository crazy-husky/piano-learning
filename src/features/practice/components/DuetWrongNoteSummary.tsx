import { useEffect, useMemo, useRef } from "react";
import { Accidental, Formatter, GhostNote, StaveNote, Voice } from "vexflow";
import { getTargetMidiNoteNumber } from "../../../domain/answerInput";
import { findNoteById } from "../../../domain/notes";
import type {
  ReviewRecord,
  Staff,
  TargetNote,
  TargetNoteId,
  WrongAnswer,
} from "../../../domain/types";
import { useNightMode, getPageThemeColor } from "../../../shared/appearance/pageAppearance";
import {
  createStaffRenderSurface,
  drawGrandStaff,
  getFixedStaffFrame,
  getGrandStaffAnchors,
} from "../../../shared/staff/staffGeometry";

type NoteTone = "danger" | "success" | "neutral";

interface ScoreNote {
  accidental: "sharp" | "flat" | undefined;
  count: number;
  midi: number;
  noteName: string;
  octave: number;
  staff: Staff;
  tone: NoteTone;
}

interface ScoreColumn {
  errorCount: number;
  key: string;
  notes: ScoreNote[];
  occurrenceCount: number;
}

interface DuetWrongNoteGroups {
  simultaneous: ScoreColumn[];
  singles: ScoreColumn[];
  totalOccurrences: number;
  unknown: Map<string, number>;
}

const MIDI_PITCHES = [
  { accidental: undefined, letter: "C" },
  { accidental: "sharp", letter: "C" },
  { accidental: undefined, letter: "D" },
  { accidental: "sharp", letter: "D" },
  { accidental: undefined, letter: "E" },
  { accidental: undefined, letter: "F" },
  { accidental: "sharp", letter: "F" },
  { accidental: undefined, letter: "G" },
  { accidental: "sharp", letter: "G" },
  { accidental: undefined, letter: "A" },
  { accidental: "sharp", letter: "A" },
  { accidental: undefined, letter: "B" },
] as const;

function isMidiPitch(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 0 && value <= 127;
}

function noteFromMidi(midi: number, staff: Staff, tone: NoteTone, count: number): ScoreNote {
  const pitch = MIDI_PITCHES[((midi % 12) + 12) % 12] ?? MIDI_PITCHES[0];
  return {
    accidental: pitch.accidental,
    count,
    midi,
    noteName: pitch.letter,
    octave: Math.floor(midi / 12) - 1,
    staff,
    tone,
  };
}

function noteFromTarget(target: TargetNote, tone: NoteTone, count: number): ScoreNote {
  return {
    accidental: target.accidental,
    count,
    midi: getTargetMidiNoteNumber(target),
    noteName: target.noteName,
    octave: target.octave,
    staff: target.staff,
    tone,
  };
}

function formatScoreNote(note: ScoreNote): string {
  const accidental = note.accidental === "sharp" ? "♯" : note.accidental === "flat" ? "♭" : "";
  return `${note.noteName}${accidental}${note.octave}`;
}

function targetIdsForReview(review: ReviewRecord): TargetNoteId[] {
  const performanceTargets = review.duetPerformance?.targets;
  if (performanceTargets?.length) return performanceTargets.map((target) => target.targetNoteId);
  if (review.duetTargetNoteIds?.length) return review.duetTargetNoteIds;
  return [review.targetNoteId];
}

function missedTargetIdsForReview(review: ReviewRecord): Set<TargetNoteId> {
  const performanceTargets = review.duetPerformance?.targets;
  if (performanceTargets?.length) {
    return new Set(
      performanceTargets
        .filter(
          (target) =>
            !target.completed && (review.wasMissed === true || target.missedOnset === true)
        )
        .map((target) => target.targetNoteId)
    );
  }
  if (!review.wasMissed) return new Set();
  return new Set(
    targetIdsForReview(review).filter(
      (targetId) => !(review.duetCompletedTargetNoteIds ?? []).includes(targetId)
    )
  );
}

function closestTargetIdForWrongAnswer(
  answer: WrongAnswer,
  targetIds: readonly TargetNoteId[]
): TargetNoteId | undefined {
  const explicitTarget = answer.duetTargetNoteId
    ? targetIds.find((targetId) => targetId === answer.duetTargetNoteId)
    : undefined;
  if (explicitTarget) return explicitTarget;
  if (isMidiPitch(answer.midiNoteNumber)) {
    return targetIds.reduce<TargetNoteId | undefined>((closestId, targetId) => {
      const target = findNoteById(targetId);
      if (!target) return closestId;
      if (!closestId) return targetId;
      const closestTarget = findNoteById(closestId);
      if (!closestTarget) return targetId;
      return Math.abs(getTargetMidiNoteNumber(target) - answer.midiNoteNumber!) <
        Math.abs(getTargetMidiNoteNumber(closestTarget) - answer.midiNoteNumber!)
        ? targetId
        : closestId;
    }, undefined);
  }
  return targetIds.length === 1 ? targetIds[0] : undefined;
}

function targetIdForWrongAnswer(
  answer: WrongAnswer,
  targetIds: readonly TargetNoteId[]
): TargetNoteId | undefined {
  return closestTargetIdForWrongAnswer(answer, targetIds);
}

function addSingleNote(counts: Map<string, ScoreColumn>, note: ScoreNote, errorCount = 1): void {
  const key = `${note.staff}:${note.midi}`;
  const existing = counts.get(key);
  if (existing) {
    existing.occurrenceCount += errorCount;
    existing.errorCount += errorCount;
    existing.notes[0]!.count = existing.occurrenceCount;
    return;
  }
  counts.set(key, {
    errorCount,
    key,
    notes: [{ ...note, count: errorCount }],
    occurrenceCount: errorCount,
  });
}

function getTargetFirstTryResult(
  review: ReviewRecord,
  targetId: TargetNoteId,
  wrongAnswers: readonly WrongAnswer[],
  missed: boolean
): { attempted: boolean; failed: boolean; firstTryCorrect: boolean | undefined; missed: boolean } {
  const performanceTarget = review.duetPerformance?.targets.find(
    (target) => target.targetNoteId === targetId
  );
  const firstTryCorrect = performanceTarget?.firstTryCorrect;
  const attempted = performanceTarget?.attempted ?? (wrongAnswers.length > 0 || missed);
  const failed = wrongAnswers.length > 0 || missed || (attempted && firstTryCorrect === false);
  return { attempted, failed, firstTryCorrect, missed };
}

function collectDuetWrongNoteGroups(reviews: readonly ReviewRecord[]): DuetWrongNoteGroups {
  const singles = new Map<string, ScoreColumn>();
  const simultaneous = new Map<string, ScoreColumn>();
  const unknown = new Map<string, number>();
  let totalOccurrences = 0;

  for (const review of reviews) {
    const targetIds = targetIdsForReview(review);
    const targetNotes = targetIds
      .map((targetId) => findNoteById(targetId))
      .filter((target): target is TargetNote => target !== undefined);
    const missedTargetIds = missedTargetIdsForReview(review);
    const wrongAnswersByTarget = new Map<TargetNoteId, WrongAnswer[]>();
    for (const wrongAnswer of review.wrongAnswers) {
      totalOccurrences += 1;
      const targetId = targetIdForWrongAnswer(wrongAnswer, targetIds);
      if (!targetId) {
        const unknownName = wrongAnswer.pianoKeyName ?? wrongAnswer.noteName;
        unknown.set(unknownName, (unknown.get(unknownName) ?? 0) + 1);
        continue;
      }
      const answers = wrongAnswersByTarget.get(targetId) ?? [];
      answers.push(wrongAnswer);
      wrongAnswersByTarget.set(targetId, answers);
      if (!isMidiPitch(wrongAnswer.midiNoteNumber)) {
        const unknownName = wrongAnswer.pianoKeyName ?? wrongAnswer.noteName;
        unknown.set(unknownName, (unknown.get(unknownName) ?? 0) + 1);
      }
    }

    const failedTargets = new Map<TargetNoteId, ReturnType<typeof getTargetFirstTryResult>>();
    for (const target of targetNotes) {
      const wrongAnswers = wrongAnswersByTarget.get(target.id) ?? [];
      const result = getTargetFirstTryResult(
        review,
        target.id,
        wrongAnswers,
        missedTargetIds.has(target.id)
      );
      failedTargets.set(target.id, result);
      if (result.missed) totalOccurrences += 1;

      if (targetIds.length === 1) {
        for (const wrongAnswer of wrongAnswers) {
          if (isMidiPitch(wrongAnswer.midiNoteNumber)) {
            addSingleNote(
              singles,
              noteFromMidi(wrongAnswer.midiNoteNumber, target.staff, "danger", 1)
            );
          }
        }
        if (result.missed) {
          addSingleNote(singles, noteFromTarget(target, "danger", 1));
        } else if (result.failed && review.wrongAnswers.length === 0) {
          totalOccurrences += 1;
          addSingleNote(singles, noteFromTarget(target, "danger", 1));
        }
      }
    }

    if (targetIds.length === 1) {
      continue;
    }

    const groupNotes = targetNotes.map((target) => {
      const wrongAnswers = wrongAnswersByTarget.get(target.id) ?? [];
      const result = failedTargets.get(target.id);
      const hasMiss = missedTargetIds.has(target.id);
      if (wrongAnswers.length > 0) {
        const firstWrongPitch = wrongAnswers.find((answer) => isMidiPitch(answer.midiNoteNumber));
        if (firstWrongPitch && isMidiPitch(firstWrongPitch.midiNoteNumber)) {
          return noteFromMidi(firstWrongPitch.midiNoteNumber, target.staff, "danger", 1);
        }
        return noteFromTarget(target, "danger", 1);
      }
      if (result?.failed || hasMiss) return noteFromTarget(target, "danger", 1);
      if (
        result?.firstTryCorrect === true ||
        review.duetCompletedTargetNoteIds?.includes(target.id) ||
        (review.duetPerformance === undefined && review.answeredCorrectly)
      ) {
        return noteFromTarget(target, "success", 1);
      }
      return noteFromTarget(target, "neutral", 1);
    });
    const groupErrorCount = [...failedTargets.entries()].reduce((sum, [targetId, result]) => {
      const wrongAnswerCount = wrongAnswersByTarget.get(targetId)?.length ?? 0;
      const fallbackFailure = Number(
        result.failed &&
          wrongAnswerCount === 0 &&
          !result.missed &&
          review.wrongAnswers.length === 0
      );
      return sum + wrongAnswerCount + Number(result.missed) + fallbackFailure;
    }, 0);
    const resolvedGroupErrorCount =
      groupErrorCount === 0 && review.wrongAnswers.length > 0
        ? review.wrongAnswers.length
        : groupErrorCount;
    totalOccurrences += [...failedTargets.entries()].reduce((sum, [targetId, result]) => {
      const wrongAnswerCount = wrongAnswersByTarget.get(targetId)?.length ?? 0;
      return (
        sum +
        Number(
          result.failed &&
            wrongAnswerCount === 0 &&
            !result.missed &&
            review.wrongAnswers.length === 0
        )
      );
    }, 0);

    if (resolvedGroupErrorCount === 0 || groupNotes.length === 0) continue;
    const orderedNotes = groupNotes.sort((left, right) => {
      if (left.staff !== right.staff) return left.staff === "treble" ? -1 : 1;
      return left.midi - right.midi;
    });
    const key = orderedNotes
      .map((note) => `${note.staff}:${note.midi}:${note.tone}:${note.accidental ?? "natural"}`)
      .join("|");
    const existing = simultaneous.get(key);
    if (existing) {
      existing.occurrenceCount += 1;
      existing.errorCount += resolvedGroupErrorCount;
      existing.notes.forEach((note) => {
        note.count = existing.occurrenceCount;
      });
    } else {
      simultaneous.set(key, {
        errorCount: resolvedGroupErrorCount,
        key,
        notes: orderedNotes.map((note) => ({ ...note, count: 1 })),
        occurrenceCount: 1,
      });
    }
  }

  return {
    simultaneous: [...simultaneous.values()].sort(
      (left, right) =>
        right.errorCount - left.errorCount || right.occurrenceCount - left.occurrenceCount
    ),
    singles: [...singles.values()].sort(
      (left, right) => right.errorCount - left.errorCount || left.key.localeCompare(right.key)
    ),
    totalOccurrences,
    unknown,
  };
}

function makeVexKey(note: ScoreNote): string {
  const accidental = note.accidental === "sharp" ? "#" : note.accidental === "flat" ? "b" : "";
  return `${note.noteName.toLowerCase()}${accidental}/${note.octave}`;
}

function noteToneColor(
  tone: NoteTone,
  colors: { danger: string; ink: string; success: string }
): string {
  if (tone === "danger") return colors.danger;
  if (tone === "success") return colors.success;
  return colors.ink;
}

function makeStaffTickable(
  notes: readonly ScoreNote[],
  staff: Staff,
  colors: { danger: string; ink: string; success: string }
): StaveNote | GhostNote {
  if (notes.length === 0) return new GhostNote("q");
  const tickable = new StaveNote({
    clef: staff,
    duration: "q",
    keys: notes.map(makeVexKey),
  });
  tickable.setLedgerLineStyle({ fillStyle: colors.ink, strokeStyle: colors.ink });
  notes.forEach((note, index) => {
    const color = noteToneColor(note.tone, colors);
    tickable.setKeyStyle(index, { fillStyle: color, strokeStyle: color });
    if (note.accidental) {
      tickable.addModifier(new Accidental(note.accidental === "sharp" ? "#" : "b"), index);
    }
  });
  return tickable;
}

function createCountLabel(
  note: ScoreNote,
  tickable: StaveNote,
  noteIndex: number,
  svg: SVGSVGElement,
  colors: { danger: string; ink: string; success: string }
): void {
  if (note.count <= 1) return;
  const noteHead = tickable.noteHeads[noteIndex];
  const noteY = tickable.getYs()[noteIndex];
  if (!noteHead || typeof noteY !== "number" || !Number.isFinite(noteY)) return;

  const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  const color = noteToneColor(note.tone, colors);
  label.setAttribute("class", "duet-wrong-note-count");
  label.setAttribute("text-anchor", "start");
  label.setAttribute("x", (noteHead.getAbsoluteX() + noteHead.getWidth() + 5).toFixed(2));
  label.setAttribute("y", (noteY + 4).toFixed(2));
  label.setAttribute("fill", color);
  label.setAttribute("stroke", "none");
  label.textContent = `×${note.count}`;
  svg.appendChild(label);
}

function GrandStaffGroup({
  columns,
  label,
}: {
  columns: readonly ScoreColumn[];
  label: string;
}): JSX.Element {
  const staffFrameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const isNightMode = useNightMode();
  const ariaLabel = useMemo(
    () =>
      columns
        .flatMap((column) =>
          column.notes.map(
            (note) =>
              `${formatScoreNote(note)} ${note.tone === "success" ? "正确" : note.tone === "danger" ? "错误" : "未作答"}${note.count > 1 ? ` ×${note.count}` : ""}`
          )
        )
        .join("、"),
    [columns]
  );

  useEffect(() => {
    const staffFrame = staffFrameRef.current;
    const rendererTarget = rendererTargetRef.current;
    if (!staffFrame || !rendererTarget) return undefined;

    let renderFrame = 0;
    const render = (): void => {
      const measuredWidth = Math.floor(staffFrame.clientWidth);
      if (measuredWidth <= 0) return;

      const width = Math.max(measuredWidth, 190 + columns.length * 92);
      const height = 280;
      rendererTarget.replaceChildren();
      const surface = createStaffRenderSurface(rendererTarget, width, height);
      const { context, svg } = surface;
      const frame = getFixedStaffFrame(surface, 14);
      const anchors = getGrandStaffAnchors(surface.scale, 112, 96);
      const { bass, treble } = drawGrandStaff(context, frame, anchors, {
        brace: true,
        showRightConnector: true,
      });
      const colors = {
        danger: getPageThemeColor("--danger", "#c84c3d"),
        ink: getPageThemeColor("--notation-ink", "#211c18"),
        success: getPageThemeColor("--success", "#2f8f58"),
      };
      const trebleTickables = columns.map((column) =>
        makeStaffTickable(
          column.notes.filter((note) => note.staff === "treble"),
          "treble",
          colors
        )
      );
      const bassTickables = columns.map((column) =>
        makeStaffTickable(
          column.notes.filter((note) => note.staff === "bass"),
          "bass",
          colors
        )
      );
      const voiceOptions = { beatValue: 4, numBeats: Math.max(1, columns.length) };
      const trebleVoice = new Voice(voiceOptions).setStrict(false).addTickables(trebleTickables);
      const bassVoice = new Voice(voiceOptions).setStrict(false).addTickables(bassTickables);
      const noteStartX = frame.x + 84;
      treble.setNoteStartX(noteStartX);
      bass.setNoteStartX(noteStartX);
      treble.setWidth(Math.max(1, frame.staveWidth - 84));
      bass.setWidth(Math.max(1, frame.staveWidth - 84));
      new Formatter()
        .joinVoices([trebleVoice, bassVoice])
        .formatToStave([trebleVoice, bassVoice], treble, { context, stave: treble });
      trebleVoice.draw(context, treble);
      bassVoice.draw(context, bass);

      columns.forEach((column, columnIndex) => {
        const trebleTickable = trebleTickables[columnIndex];
        const bassTickable = bassTickables[columnIndex];
        if (trebleTickable instanceof StaveNote) {
          column.notes
            .filter((note) => note.staff === "treble")
            .forEach((note, noteIndex) =>
              createCountLabel(note, trebleTickable, noteIndex, svg, colors)
            );
        }
        if (bassTickable instanceof StaveNote) {
          column.notes
            .filter((note) => note.staff === "bass")
            .forEach((note, noteIndex) =>
              createCountLabel(note, bassTickable, noteIndex, svg, colors)
            );
        }
      });

      const noteYs = [...trebleTickables, ...bassTickables]
        .filter((tickable): tickable is StaveNote => tickable instanceof StaveNote)
        .flatMap((tickable) => tickable.getYs().filter((y) => Number.isFinite(y)));
      const minimumY = Math.min(treble.getYForLine(0) - 28, ...noteYs.map((y) => y - 26));
      const maximumY = Math.max(bass.getYForLine(4) + 28, ...noteYs.map((y) => y + 24));
      const renderedHeight = Math.max(1, Math.ceil(maximumY - minimumY));
      svg.setAttribute("viewBox", `0 ${minimumY} ${width} ${renderedHeight}`);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(renderedHeight));
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", ariaLabel);
      svg.setAttribute("focusable", "false");
    };
    const scheduleRender = (): void => {
      if (renderFrame !== 0) return;
      renderFrame = window.requestAnimationFrame(() => {
        renderFrame = 0;
        render();
      });
    };

    render();
    const observer = new ResizeObserver(scheduleRender);
    observer.observe(staffFrame);
    return () => {
      window.cancelAnimationFrame(renderFrame);
      observer.disconnect();
    };
  }, [ariaLabel, columns, isNightMode]);

  return (
    <section className="practice-wrong-note-staff-section duet-wrong-note-group">
      <h3>{label}</h3>
      <div className="practice-wrong-note-staff-scroll">
        <div className="practice-wrong-note-staff" ref={staffFrameRef}>
          <div className="practice-wrong-note-staff-renderer" ref={rendererTargetRef} />
        </div>
      </div>
    </section>
  );
}

export function DuetWrongNoteSummary({
  reviews,
}: {
  reviews: readonly ReviewRecord[];
}): JSX.Element {
  const { singles, simultaneous, totalOccurrences, unknown } = useMemo(
    () => collectDuetWrongNoteGroups(reviews),
    [reviews]
  );

  return (
    <details className="summary-section practice-wrong-note-summary">
      <summary className="practice-wrong-note-summary-heading">
        <span>错漏音汇总</span>
        <small>{totalOccurrences} 次</small>
      </summary>
      {totalOccurrences === 0 ? (
        <p className="practice-wrong-note-empty">本次没有错音或漏音。</p>
      ) : (
        <div className="practice-wrong-note-content">
          {singles.length > 0 ? <GrandStaffGroup columns={singles} label="单音" /> : null}
          {simultaneous.length > 0 ? (
            <GrandStaffGroup columns={simultaneous} label="双音合弹" />
          ) : null}
          {unknown.size > 0 ? (
            <p className="practice-wrong-note-unknown">
              这些错音没有八度信息，暂时无法定位到谱面：
              {[...unknown.entries()]
                .map(([noteName, count]) => `${noteName} ×${count}`)
                .join("、")}
            </p>
          ) : null}
        </div>
      )}
    </details>
  );
}
