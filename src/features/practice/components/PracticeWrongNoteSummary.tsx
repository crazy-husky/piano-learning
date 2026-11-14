import { useEffect, useRef } from "react";
import { Accidental, Formatter, StaveNote, Voice } from "vexflow";
import type { ReviewRecord, Staff } from "../../../domain/types";
import { getTargetMidiNoteNumber } from "../../../domain/answerInput";
import { findNoteById } from "../../../domain/notes";
import { getPageThemeColor } from "../../../shared/appearance/pageAppearance";
import { createStaffRenderSurface, drawSingleStaff } from "../../../shared/staff/staffGeometry";

interface WrongPitch {
  midi: number;
  staff: Staff;
  count: number;
}

const MIDI_PITCHES = [
  { accidental: "", letter: "C" },
  { accidental: "♯", letter: "C" },
  { accidental: "", letter: "D" },
  { accidental: "♯", letter: "D" },
  { accidental: "", letter: "E" },
  { accidental: "", letter: "F" },
  { accidental: "♯", letter: "F" },
  { accidental: "", letter: "G" },
  { accidental: "♯", letter: "G" },
  { accidental: "", letter: "A" },
  { accidental: "♯", letter: "A" },
  { accidental: "", letter: "B" },
] as const;

function collectWrongPitches(reviews: readonly ReviewRecord[]): {
  notes: WrongPitch[];
  unknown: Map<string, number>;
  totalOccurrences: number;
} {
  const counts = new Map<string, WrongPitch>();
  const unknown = new Map<string, number>();
  let totalOccurrences = 0;

  const addPitch = (midi: number, staffOverride?: Staff): void => {
    const staff: Staff = staffOverride ?? (midi >= 60 ? "treble" : "bass");
    const key = `${staff}:${midi}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { midi, staff, count: 1 });
    totalOccurrences += 1;
  };

  for (const review of reviews) {
    for (const wrongAnswer of review.wrongAnswers) {
      const midi = wrongAnswer.midiNoteNumber;
      if (midi === undefined || !Number.isInteger(midi) || midi < 0 || midi > 127) {
        const noteName = wrongAnswer.noteName;
        unknown.set(noteName, (unknown.get(noteName) ?? 0) + 1);
        totalOccurrences += 1;
        continue;
      }
      const targetStaff = wrongAnswer.duetTargetNoteId
        ? (review.duetPerformance?.targets.find(
            (target) => target.targetNoteId === wrongAnswer.duetTargetNoteId
          )?.staff ?? findNoteById(wrongAnswer.duetTargetNoteId)?.staff)
        : findNoteById(review.targetNoteId)?.staff;
      addPitch(midi, targetStaff);
    }

    const performanceTargets = review.duetPerformance?.targets;
    const missedTargetIds = performanceTargets?.length
      ? performanceTargets
          .filter(
            (target) =>
              !target.completed && (review.wasMissed === true || target.missedOnset === true)
          )
          .map((target) => target.targetNoteId)
      : review.wasMissed
        ? (review.duetTargetNoteIds?.length
            ? review.duetTargetNoteIds
            : [review.targetNoteId]
          ).filter((targetId) => !(review.duetCompletedTargetNoteIds ?? []).includes(targetId))
        : [];
    for (const targetId of missedTargetIds) {
      const target = findNoteById(targetId);
      if (target) addPitch(getTargetMidiNoteNumber(target), target.staff);
    }
  }

  return {
    notes: [...counts.values()].sort(
      (left, right) => left.midi - right.midi || left.staff.localeCompare(right.staff)
    ),
    unknown,
    totalOccurrences,
  };
}

function WrongNoteStaff({
  notes,
  staff,
}: {
  notes: readonly WrongPitch[];
  staff: Staff;
}): JSX.Element {
  const staffFrameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const pitchesLabel = notes
    .map((note) => {
      const pitch = MIDI_PITCHES[((note.midi % 12) + 12) % 12] ?? MIDI_PITCHES[0];
      const count = note.count > 1 ? ` ×${note.count}` : "";
      return `${pitch.letter}${pitch.accidental}${Math.floor(note.midi / 12) - 1}${count}`;
    })
    .join("、");

  useEffect(() => {
    const staffFrame = staffFrameRef.current;
    const rendererTarget = rendererTargetRef.current;
    if (!staffFrame || !rendererTarget) return undefined;

    let renderFrame = 0;
    const render = (): void => {
      const measuredWidth = Math.floor(staffFrame.clientWidth);
      if (measuredWidth <= 0) return;

      const width = Math.max(measuredWidth, 180 + notes.length * 68);
      rendererTarget.replaceChildren();
      const surface = createStaffRenderSurface(rendererTarget, width, 240);
      const { context, svg } = surface;
      const stave = drawSingleStaff(context, { x: 12, staveWidth: width - 24 }, staff, 74, {
        showRightBarline: false,
      }).staff;
      const danger = getPageThemeColor("--danger", "#c84c3d");
      const notationStaff = getPageThemeColor("--notation-staff", "#766b5f");
      const tickables = notes.map((note) => {
        const pitch = MIDI_PITCHES[((note.midi % 12) + 12) % 12] ?? MIDI_PITCHES[0];
        const octave = Math.floor(note.midi / 12) - 1;
        const tickable = new StaveNote({
          clef: staff,
          duration: "q",
          keys: [`${pitch.letter.toLowerCase()}${pitch.accidental ? "#" : ""}/${octave}`],
        });
        tickable.setStyle({ fillStyle: danger, strokeStyle: danger });
        tickable.setKeyStyle(0, { fillStyle: danger, strokeStyle: danger });
        tickable.setLedgerLineStyle({ fillStyle: notationStaff, strokeStyle: notationStaff });
        if (pitch.accidental) tickable.addModifier(new Accidental("#"), 0);
        return tickable;
      });
      const voice = new Voice({
        beatValue: 4,
        numBeats: Math.max(1, tickables.length),
      }).addTickables(tickables);
      new Formatter().joinVoices([voice]).formatToStave([voice], stave, { context, stave });
      voice.draw(context, stave);

      const countLabels = tickables.flatMap((tickable, index) => {
        const noteHead = tickable.noteHeads[0];
        const noteY = tickable.getYs()[0];
        const note = notes[index];
        if (
          !noteHead ||
          typeof noteY !== "number" ||
          !Number.isFinite(noteY) ||
          !note ||
          note.count <= 1
        ) {
          return [];
        }
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("class", "practice-wrong-note-count");
        label.setAttribute("text-anchor", "start");
        label.setAttribute("x", (noteHead.getAbsoluteX() + noteHead.getWidth() + 5).toFixed(2));
        label.setAttribute("y", (noteY + 4).toFixed(2));
        label.setAttribute("fill", "var(--danger)");
        label.setAttribute("stroke", "none");
        label.style.fill = "var(--danger)";
        label.style.stroke = "none";
        label.textContent = `×${note.count}`;
        return [label];
      });
      countLabels.forEach((label) => svg.appendChild(label));

      const noteYs = tickables.flatMap((tickable) =>
        tickable.getYs().filter((y) => Number.isFinite(y))
      );
      const minimumY = Math.min(stave.getYForLine(0) - 24, ...noteYs.map((y) => y - 28));
      const maximumY = Math.max(stave.getYForLine(4) + 24, ...noteYs.map((y) => y + 24));
      const height = Math.max(1, Math.ceil(maximumY - minimumY));
      svg.setAttribute("viewBox", `0 ${minimumY} ${width} ${height}`);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", pitchesLabel);
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
  }, [notes, pitchesLabel, staff]);

  return (
    <section className="practice-wrong-note-staff-section">
      <h3>{staff === "bass" ? "低音谱 · 左手" : "高音谱 · 右手"}</h3>
      <div className="practice-wrong-note-staff-scroll">
        <div className="practice-wrong-note-staff" ref={staffFrameRef}>
          <div className="practice-wrong-note-staff-renderer" ref={rendererTargetRef} />
        </div>
      </div>
    </section>
  );
}

export function PracticeWrongNoteSummary({
  reviews,
}: {
  reviews: readonly ReviewRecord[];
}): JSX.Element {
  const { notes, totalOccurrences, unknown } = collectWrongPitches(reviews);
  const bassNotes = notes.filter((note) => note.staff === "bass");
  const trebleNotes = notes.filter((note) => note.staff === "treble");

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
          {trebleNotes.length > 0 ? <WrongNoteStaff notes={trebleNotes} staff="treble" /> : null}
          {bassNotes.length > 0 ? <WrongNoteStaff notes={bassNotes} staff="bass" /> : null}
          {unknown.size > 0 ? (
            <p className="practice-wrong-note-unknown">
              这些错音没有八度信息，暂时无法定位到谱面：
              {[...unknown.entries()]
                .map(([noteName, count]) => noteName + " ×" + count)
                .join("、")}
            </p>
          ) : null}
        </div>
      )}
    </details>
  );
}
